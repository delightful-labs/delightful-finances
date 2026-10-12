import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Account, type Category, type Organization } from './schema.js'
import { validateTransaction, type AppTransaction } from './domain/transaction.js'

type Db = ReturnType<typeof getDb>

export async function ensurePersonalWorkspace(db: Pick<Db, 'all' | 'transaction'>, userId: string) {
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
	// Hydrate existing rows before opening a transaction: a cold transaction's
	// read snapshot can miss records arriving from sync and recreate protected rows.
	const readOptions = { tier: ReadTier.LocalFirstUnlessEmpty }
	const [profiles, ownedOrganizations] = await Promise.all([
		db.all(app.profiles.where({ userId }), readOptions),
		db.all(app.organizations.where({ ownerId: userId, kind: 'personal' }), readOptions)
	])
	const existingOrganization = ownedOrganizations[0]
	const activeOrganizationId = existingOrganization?.id ?? organizationId
	const [memberships, categories] = await Promise.all([
		db.all(
			app.organizationMembers.where({ organizationId: activeOrganizationId, userId }),
			readOptions
		),
		db.all(app.categories.where({ organizationId: activeOrganizationId }), readOptions)
	])
	const categoriesWithIds = await Promise.all(
		defaultCategories.map(async (category) => ({
			category,
			id: await stableUuid(
				activeOrganizationId,
				`category:${category.kind}:${category.name.toLowerCase()}`
			)
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
	if (
		existingOrganization &&
		profiles.length > 0 &&
		memberships.length > 0 &&
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
				{ name: 'Personal workspace', kind: 'personal', defaultCurrency: 'USD', ownerId: userId },
				{ id: organizationId }
			)
		if (memberships.length === 0) {
			tx.insert(
				app.organizationMembers,
				{ organizationId: organization.id, userId, role: 'owner', accountAccessMode: 'all' },
				{ id: membershipId }
			)
		}
		for (const { category, id } of missingCategories) {
			tx.insert(app.categories, { organizationId: organization.id, ...category }, { id })
		}
		return organization
	})
	// Persist the bootstrap locally before another page can reopen the database.
	return result.wait({ tier: 'local' })
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
