import { normalizedName } from './domain/names.js'
import { ReadTier } from 'jazz-tools'
import { m } from './paraglide/messages.js'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Account, type Category, type Organization, type Tag } from './schema.js'
import { validateTransaction, type AppTransaction } from './domain/transaction.js'
import { appTransactionSchema } from './validation/transactions.js'
import { appAccountSchema } from './validation/accounts.js'
import { appCategorySchema } from './validation/categories.js'
import { appTagSchema } from './validation/tags.js'
import type { z } from 'zod'
import { appProfileSchema, profileAvatarValuesSchema } from './validation/identity.js'

type Db = ReturnType<typeof getDb>

export async function ensurePersonalWorkspace(db: Pick<Db, 'all' | 'transaction'>, userId: string) {
	const organizationId = await stableUuid(userId, 'personal-organization')
	const profileId = await stableUuid(userId, 'profile')
	const membershipId = await stableUuid(userId, 'personal-membership')
	const defaultCategories: {
		key: string
		name: string
		kind: Category['kind']
		isSystem: boolean
	}[] = [
		{
			key: 'uncategorized',
			name: m['defaults.categories.uncategorized'](),
			kind: 'expense',
			isSystem: true
		},
		{
			key: 'uncategorized',
			name: m['defaults.categories.uncategorized'](),
			kind: 'income',
			isSystem: true
		},
		{
			key: 'groceries',
			name: m['defaults.categories.groceries'](),
			kind: 'expense',
			isSystem: false
		},
		{ key: 'housing', name: m['defaults.categories.housing'](), kind: 'expense', isSystem: false },
		{
			key: 'transport',
			name: m['defaults.categories.transport'](),
			kind: 'expense',
			isSystem: false
		},
		{
			key: 'other expense',
			name: m['defaults.categories.other_expense'](),
			kind: 'expense',
			isSystem: false
		},
		{ key: 'salary', name: m['defaults.categories.salary'](), kind: 'income', isSystem: false },
		{
			key: 'other income',
			name: m['defaults.categories.other_income'](),
			kind: 'income',
			isSystem: false
		}
	]
	// Hydrate existing rows before opening a transaction: a cold transaction's
	// read snapshot can miss records arriving from sync and recreate protected rows.
	const readOptions = { tier: ReadTier.LocalFirstUnlessEmpty }
	const [profiles, ownedOrganizations] = await Promise.all([
		db.all(app.profiles.where({ userId }), readOptions),
		db.all(app.organizations.where({ ownerId: userId, kind: 'personal' }), readOptions)
	])
	const existingOrganization = ownedOrganizations[0]
	const activeProfileId = profiles[0]?.id ?? profileId
	const activeOrganizationId = existingOrganization?.id ?? organizationId
	const [memberships, categories] = await Promise.all([
		db.all(
			app.organizationMembers.where({ organizationId: activeOrganizationId, userId }),
			readOptions
		),
		db.all(app.categories.where({ organizationId: activeOrganizationId }), readOptions)
	])
	const categoriesWithIds = await Promise.all(
		// Keep identity independent of translated names and preserve existing seed IDs.
		defaultCategories.map(async ({ key, ...category }) => ({
			category,
			id: await stableUuid(activeOrganizationId, `category:${category.kind}:${key}`)
		}))
	)
	const missingCategories = categoriesWithIds.filter(
		({ category, id }) =>
			!categories.some(
				(existing) =>
					existing.id === id ||
					(existing.kind === category.kind && existing.name === category.name) ||
					(category.isSystem && existing.kind === category.kind && existing.isSystem)
			)
	)
	const membership = memberships[0]
	const profileLinkNeedsRepair = membership && membership.profileId !== activeProfileId
	if (
		existingOrganization &&
		profiles.length > 0 &&
		memberships.length > 0 &&
		!profileLinkNeedsRepair &&
		missingCategories.length === 0
	) {
		return existingOrganization
	}

	const result = await db.transaction((tx) => {
		if (profiles.length === 0) tx.insert(app.profiles, { userId }, { id: profileId })
		const organization: Organization =
			existingOrganization ??
			tx.insert(
				app.organizations,
				{
					name: m['defaults.workspace'](),
					kind: 'personal',
					defaultCurrency: 'USD',
					ownerId: userId
				},
				{ id: organizationId }
			)
		if (memberships.length === 0) {
			tx.insert(
				app.organizationMembers,
				{
					organizationId: organization.id,
					userId,
					profileId: activeProfileId,
					role: 'owner',
					accountAccessMode: 'all'
				},
				{ id: membershipId }
			)
		}
		if (profileLinkNeedsRepair) {
			tx.update(app.organizationMembers, membership.id, { profileId: activeProfileId })
		}
		for (const { category, id } of missingCategories) {
			tx.insert(app.categories, { organizationId: organization.id, ...category }, { id })
		}
		return organization
	})
	// Persist the bootstrap locally before another page can reopen the database.
	return result.wait({ tier: 'local' })
}

export async function stableUuid(namespaceId: string, name: string) {
	const namespaceHex = namespaceId.replaceAll('-', '')
	const namespaceBytes = Uint8Array.from(
		Array.from({ length: namespaceHex.length / 2 }, (_, index) =>
			Number.parseInt(namespaceHex.slice(index * 2, index * 2 + 2), 16)
		)
	)
	const nameBytes = new TextEncoder().encode(name)
	const input = new Uint8Array(namespaceBytes.length + nameBytes.length)
	input.set(namespaceBytes)
	input.set(nameBytes, namespaceBytes.length)
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
	digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50
	digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80
	const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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
