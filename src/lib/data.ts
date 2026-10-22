import { normalizedName } from './domain/names.js'
import type { getDb } from 'jazz-tools/svelte'
import {
	app,
	type Account,
	type Category,
	type Organization,
	type Tag,
	type TransactionRow
} from './schema.js'
import { validateTransaction, type AppTransaction } from './domain/transaction.js'
import { appTransactionSchema } from './validation/transactions.js'
import { appAccountSchema } from './validation/accounts.js'
import { appCategorySchema } from './validation/categories.js'
import { appTagSchema } from './validation/tags.js'
import type { z } from 'zod'
import { appProfileSchema, profileAvatarValuesSchema } from './validation/identity.js'

export { stableUuid } from './domain/stable-uuid.js'

type Db = ReturnType<typeof getDb>

export function saveProfileName(
	db: Pick<Db, 'update'>,
	profileId: string,
	userId: string,
	displayName: string | null | undefined
) {
	const profile = appProfileSchema.parse({ userId, displayName })
	return db
		.update(app.profiles, profileId, { displayName: profile.displayName ?? null })
		.wait({ tier: 'local' })
}

export function saveProfileAvatar(
	db: Pick<Db, 'update'>,
	profileId: string,
	userId: string,
	values: z.output<typeof profileAvatarValuesSchema>
) {
	const avatar = profileAvatarValuesSchema.parse(values)
	appProfileSchema.shape.userId.parse(userId)
	return db.update(app.profiles, profileId, avatar).wait({ tier: 'local' })
}

export function renameWorkspace(
	db: Pick<Db, 'update'>,
	workspaceId: Organization['id'],
	name: Organization['name']
) {
	return db.update(app.organizations, workspaceId, { name }).wait({ tier: 'local' })
}

export function createAccount(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Account['kind']
) {
	const account = appAccountSchema.parse({ organizationId, name, kind })
	return db.insert(app.accounts, account).wait({ tier: 'local' })
}

export function archiveAccount(db: Pick<Db, 'update'>, accountId: Account['id']) {
	return db.update(app.accounts, accountId, { archivedAt: new Date() }).wait({ tier: 'local' })
}

export async function createTransaction(db: Pick<Db, 'transaction'>, input: AppTransaction) {
	const parsed = appTransactionSchema.safeParse(input)
	if (!parsed.success) return { error: validateTransaction(input) ?? 'invalid-transaction' }
	const transaction = parsed.data
	const result = await db.transaction(async (tx) => {
		const transactionId = crypto.randomUUID()
		if ('paymentMethod' in transaction && transaction.paymentMethod === 'check') {
			const details = transaction.checkDetails
			tx.insert(
				app.checkDetails,
				{
					transactionId,
					organizationId: transaction.organizationId,
					accountId: transaction.accountId,
					checkNumber: details.checkNumber,
					checkDate: details.checkDate,
					...(details.payerName === undefined ? {} : { payerName: details.payerName }),
					...(details.bankName === undefined ? {} : { bankName: details.bankName }),
					...(details.memoOnCheck === undefined ? {} : { memoOnCheck: details.memoOnCheck })
				},
				{ id: transactionId }
			)
		}
		const row = tx.insert(
			app.transactions,
			{
				organizationId: transaction.organizationId,
				accountId: transaction.accountId,
				categoryId: transaction.categoryId,
				amountMinor: transaction.money.amountMinor,
				currency: transaction.money.currency,
				kind: transaction.kind,
				bookedOn: transaction.bookedOn,
				...(transaction.description ? { description: transaction.description } : {}),
				...(transaction.memo ? { memo: transaction.memo } : {}),
				source: transaction.source.source,
				...(transaction.source.source === 'simplefin'
					? { externalId: transaction.source.externalId }
					: {}),
				...('paymentMethod' in transaction ? { paymentMethod: transaction.paymentMethod } : {}),
				...('paymentMethod' in transaction && transaction.paymentMethod === 'check'
					? { checkDetailsId: transactionId }
					: {})
			},
			{ id: transactionId }
		)

		if (transaction.tags?.length) {
			const existingTags = await tx.all(
				app.tags.where({ organizationId: transaction.organizationId, kind: transaction.kind })
			)
			for (const name of transaction.tags) {
				const matches = existingTags.filter(
					(tag) =>
						tag.organizationId === transaction.organizationId &&
						tag.kind === transaction.kind &&
						normalizedName(tag.name) === normalizedName(name)
				)
				const active = matches.filter((tag) => !tag.archivedAt)
				if (active.length > 1) throw new Error('The selected tag name is ambiguous.')
				const tag =
					active[0] ??
					tx.insert(
						app.tags,
						appTagSchema.parse({
							organizationId: transaction.organizationId,
							kind: transaction.kind,
							name,
							categoryId: transaction.categoryId
						})
					)
				tx.insert(app.transactionTags, {
					organizationId: transaction.organizationId,
					transactionId: row.id,
					tagId: tag.id
				})
			}
		}
		return row
	})
	return { value: await result.wait({ tier: 'local' }) }
}

export async function updateTransaction(
	db: Pick<Db, 'transaction'>,
	transactionId: TransactionRow['id'],
	input: AppTransaction
) {
	const parsed = appTransactionSchema.safeParse(input)
	if (!parsed.success) return { error: validateTransaction(input) ?? 'invalid-transaction' }
	const transaction = parsed.data
	const result = await db.transaction(async (tx) => {
		const existingRows = await tx.all(app.transactions.where({ id: transactionId }))
		const existing = existingRows[0]
		if (!existing) throw new Error('The transaction is unavailable.')
		if (
			existing.organizationId !== transaction.organizationId ||
			existing.source !== 'manual' ||
			existing.kind !== transaction.kind ||
			(existing.paymentMethod === 'check' && existing.accountId !== transaction.accountId) ||
			('paymentMethod' in transaction && transaction.paymentMethod === 'check') !==
				(existing.paymentMethod === 'check')
		) {
			throw new Error('The transaction cannot be edited.')
		}
		tx.update(app.transactions, transactionId, {
			accountId: transaction.accountId,
			categoryId: transaction.categoryId,
			amountMinor: transaction.money.amountMinor,
			currency: transaction.money.currency,
			bookedOn: transaction.bookedOn,
			description: transaction.description ?? null,
			...(transaction.memo ? { memo: transaction.memo } : { memo: null }),
			...('paymentMethod' in transaction
				? { paymentMethod: transaction.paymentMethod }
				: { paymentMethod: null }),
			...('paymentMethod' in transaction && transaction.paymentMethod === 'check'
				? { checkDetailsId: existing.checkDetailsId }
				: { checkDetailsId: null })
		})
		const existingTags = await tx.all(app.transactionTags.where({ transactionId }))
		const tags = await tx.all(
			app.tags.where({ organizationId: transaction.organizationId, kind: transaction.kind })
		)
		const requestedNames = new Set((transaction.tags ?? []).map(normalizedName))
		const retainedNames = new Set<string>()
		for (const link of existingTags) {
			const tag = tags.find((tag) => tag.id === link.tagId)
			// Unresolved historical assignments cannot safely be interpreted as removals.
			if (!tag) continue
			const name = normalizedName(tag.name)
			if (requestedNames.has(name)) retainedNames.add(name)
			else tx.delete(app.transactionTags, link.id)
		}
		if ('paymentMethod' in transaction && transaction.paymentMethod === 'check') {
			const details = transaction.checkDetails
			const existingDetailsRows = await tx.all(app.checkDetails.where({ transactionId }))
			if (existingDetailsRows.length > 1) {
				throw new Error('The transaction has ambiguous check details.')
			}
			const existingDetails = existingDetailsRows[0]
			if (!existingDetails || existingDetails.id !== existing.checkDetailsId) {
				throw new Error('The transaction check details are unavailable.')
			}
			tx.update(app.checkDetails, existingDetails.id, {
				organizationId: transaction.organizationId,
				accountId: transaction.accountId,
				checkNumber: details.checkNumber,
				checkDate: details.checkDate
			})
		} else {
			const details = await tx.all(app.checkDetails.where({ transactionId }))
			if (details.length > 0) {
				throw new Error('Check details cannot be removed from an existing transaction.')
			}
		}
		if (transaction.tags?.length) {
			for (const name of transaction.tags) {
				if (retainedNames.has(normalizedName(name))) continue
				const matches = tags.filter(
					(tag) => !tag.archivedAt && normalizedName(tag.name) === normalizedName(name)
				)
				if (matches.length > 1) throw new Error('The selected tag name is ambiguous.')
				const tag =
					matches[0] ??
					tx.insert(
						app.tags,
						appTagSchema.parse({
							organizationId: transaction.organizationId,
							kind: transaction.kind,
							name,
							categoryId: transaction.categoryId
						})
					)
				tx.insert(app.transactionTags, {
					organizationId: transaction.organizationId,
					transactionId,
					tagId: tag.id
				})
			}
		}
		return transactionId
	})
	return { value: await result.wait({ tier: 'local' }) }
}

export function createCategory(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Category['kind']
) {
	const category = appCategorySchema.parse({ organizationId, name, kind })
	return db.insert(app.categories, category).wait({ tier: 'local' })
}

export function archiveCategory(db: Pick<Db, 'update'>, categoryId: Category['id']) {
	return db.update(app.categories, categoryId, { archivedAt: new Date() }).wait({ tier: 'local' })
}

export function createTag(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Category['kind'],
	categoryId: string | null
) {
	const tag = appTagSchema.parse({ organizationId, name, kind, categoryId })
	return db.insert(app.tags, tag).wait({ tier: 'local' })
}

export function archiveTag(db: Pick<Db, 'update'>, tagId: Tag['id']) {
	return db.update(app.tags, tagId, { archivedAt: new Date() }).wait({ tier: 'local' })
}
