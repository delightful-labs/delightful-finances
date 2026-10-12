import { getDb } from 'jazz-tools/svelte'
import { app, type Account, type Category, type Organization } from './schema.js'
import { validateTransaction, type AppTransaction } from './domain/transaction.js'

type Db = ReturnType<typeof getDb>

export async function ensurePersonalWorkspace(db: Db, userId: string) {
	const organizationId = await stableUuid(userId, 'personal-organization')
	const profileId = await stableUuid(userId, 'profile')
	const membershipId = await stableUuid(userId, 'personal-membership')
	const defaultCategories: { name: string; kind: Category['kind']; isSystem: boolean }[] = [
		{ name: 'Uncategorized', kind: 'expense', isSystem: true },
		{ name: 'Uncategorized', kind: 'income', isSystem: true },
		{ name: 'Groceries', kind: 'expense', isSystem: false },
		{ name: 'Housing', kind: 'expense', isSystem: false },
		{ name: 'Transport', kind: 'expense', isSystem: false },
		{ name: 'Other expense', kind: 'expense', isSystem: false },
		{ name: 'Salary', kind: 'income', isSystem: false },
		{ name: 'Other income', kind: 'income', isSystem: false }
	]
	const categoriesWithIds = await Promise.all(
		defaultCategories.map(async (category) => ({
			category,
			id: await stableUuid(
				organizationId,
				`category:${category.kind}:${category.name.toLowerCase()}`
			)
		}))
	)

	const result = await db.transaction(async (tx) => {
		const profiles = await tx.all(app.profiles.where({ userId }))
		if (profiles.length === 0) {
			tx.insert(app.profiles, { userId }, { id: profileId })
		}

		const ownedOrganizations = await tx.all(
			app.organizations.where({ ownerId: userId, kind: 'personal' })
		)
		const organization: Organization =
			ownedOrganizations[0] ??
			tx.insert(
				app.organizations,
				{
					name: 'Personal workspace',
					kind: 'personal',
					defaultCurrency: 'USD',
					ownerId: userId
				},
				{ id: organizationId }
			)

		const memberships = await tx.all(
			app.organizationMembers.where({ organizationId: organization.id, userId })
		)
		if (memberships.length === 0) {
			tx.insert(
				app.organizationMembers,
				{
					organizationId: organization.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				},
				{ id: membershipId }
			)
		}

		const categories = await tx.all(app.categories.where({ organizationId: organization.id }))
		for (const { category, id } of categoriesWithIds) {
			const exists = categories.some(
				(existing) => existing.kind === category.kind && existing.name === category.name
			)
			if (!exists) {
				tx.insert(app.categories, { organizationId: organization.id, ...category }, { id })
			}
		}
		return organization
	})
	return result.value
}

async function stableUuid(namespaceId: string, name: string) {
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

export function createAccount(db: Db, organizationId: string, name: string, kind: Account['kind']) {
	return db.insert(app.accounts, { organizationId, name, kind, currency: 'USD' }).value
}

export async function createTransaction(db: Db, transaction: AppTransaction) {
	const error = validateTransaction(transaction)
	if (error) return { error }
	const result = await db.transaction((tx) => {
		const row = tx.insert(app.transactions, {
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
			...('paymentMethod' in transaction ? { paymentMethod: transaction.paymentMethod } : {})
		})
		if ('paymentMethod' in transaction && transaction.paymentMethod === 'check') {
			const details = transaction.checkDetails
			tx.insert(app.checkDetails, {
				transactionId: row.id,
				checkNumber: details.checkNumber,
				...(details.checkDate === undefined ? {} : { checkDate: details.checkDate }),
				...(details.payerName === undefined ? {} : { payerName: details.payerName }),
				...(details.bankName === undefined ? {} : { bankName: details.bankName }),
				...(details.memoOnCheck === undefined ? {} : { memoOnCheck: details.memoOnCheck })
			})
		}
		return row
	})
	return { value: result.value }
}
