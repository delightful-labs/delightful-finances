import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadTier, Transaction } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { createAccount, ensurePersonalWorkspace } from './data.js'
import { app, type Account, type Organization } from './schema.js'

type Db = ReturnType<typeof getDb>
const userId = '11111111-1111-4111-8111-111111111111'
const organization = {
	id: '22222222-2222-4222-8222-222222222222',
	name: 'Existing workspace',
	kind: 'personal',
	defaultCurrency: 'USD',
	ownerId: userId
} satisfies Organization

function setup() {
	const transaction = new Transaction('mergeable', () => {
		throw new Error('Unit tests must not open a database runtime.')
	})
	const insert = vi.spyOn(transaction, 'insert').mockReturnValue(organization)
	const wait = vi.fn()
	const db = { all: vi.fn(), transaction: vi.fn() } satisfies Pick<Db, 'all' | 'transaction'>
	db.transaction.mockImplementation(async (write: Parameters<Db['transaction']>[0]) => {
		const value = await write(transaction)
		wait.mockResolvedValue(value)
		return { wait }
	})
	return { db, insert, wait }
}

beforeEach(() => vi.restoreAllMocks())

describe('createAccount', () => {
	const account: Account = {
		id: 'account',
		organizationId: organization.id,
		name: 'Checking',
		kind: 'bank',
		currency: 'USD',
		archivedAt: null
	}
	it('writes the selected workspace and USD currency, then waits for local persistence', async () => {
		const wait = vi.fn().mockResolvedValue(account)
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		await expect(createAccount(db, organization.id, 'Checking', 'bank')).resolves.toEqual(account)
		expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.accounts, {
			organizationId: organization.id,
			name: 'Checking',
			kind: 'bank',
			currency: 'USD'
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('returns the persistence promise rather than reporting success immediately', async () => {
		const pending = Promise.withResolvers<Account>()
		const wait = vi.fn(() => pending.promise)
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		const result = createAccount(db, organization.id, 'Checking', 'bank')
		expect(result).toBe(pending.promise)
		pending.resolve(account)
		await expect(result).resolves.toEqual(account)
	})
	it('propagates local persistence failures', async () => {
		const failure = new Error('Local write failed')
		const wait = vi.fn().mockRejectedValue(failure)
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		await expect(createAccount(db, organization.id, 'Checking', 'bank')).rejects.toBe(failure)
	})
})

describe('ensurePersonalWorkspace', () => {
	it('creates a profile, owner membership and eight categories for a new workspace', async () => {
		const { db, insert, wait } = setup()
		db.all.mockResolvedValue([])
		await ensurePersonalWorkspace(db, userId)
		expect(insert).toHaveBeenCalledTimes(11)
		expect(insert).toHaveBeenCalledWith(app.profiles, { userId }, { id: expect.any(String) })
		expect(insert).toHaveBeenCalledWith(
			app.organizations,
			{ name: 'Personal workspace', kind: 'personal', defaultCurrency: 'USD', ownerId: userId },
			{ id: expect.any(String) }
		)
		expect(insert).toHaveBeenCalledWith(
			app.organizationMembers,
			{ organizationId: organization.id, userId, role: 'owner', accountAccessMode: 'all' },
			{ id: expect.any(String) }
		)
		const categories = insert.mock.calls.filter(([table]) => table === app.categories)
		expect(categories).toHaveLength(8)
		expect(
			categories.filter(
				([, values]) =>
					typeof values === 'object' &&
					values !== null &&
					'isSystem' in values &&
					values.isSystem === true
			)
		).toHaveLength(2)
		expect(wait).toHaveBeenCalledWith({ tier: 'local' })
		expect(db.all).toHaveBeenCalledTimes(4)
		for (const [, options] of db.all.mock.calls) {
			expect(options).toEqual({ tier: ReadTier.LocalFirstUnlessEmpty })
		}
	})

	it('reuses a complete workspace without opening a write transaction', async () => {
		const { db, insert } = setup()
		const categories = await starterCategories()
		db.all
			.mockResolvedValueOnce([{ userId }])
			.mockResolvedValueOnce([organization])
			.mockResolvedValueOnce([{ userId, organizationId: organization.id }])
			.mockResolvedValueOnce(categories)
		await expect(ensurePersonalWorkspace(db, userId)).resolves.toEqual(organization)
		expect(db.transaction).not.toHaveBeenCalled()
		expect(insert).not.toHaveBeenCalled()
	})

	it('preserves renamed starter categories by their stable IDs', async () => {
		const { db, insert } = setup()
		const categories = (await starterCategories()).map((category) => ({
			...category,
			name: `Renamed ${category.name}`
		}))
		db.all
			.mockResolvedValueOnce([{ userId }])
			.mockResolvedValueOnce([organization])
			.mockResolvedValueOnce([{ userId, organizationId: organization.id }])
			.mockResolvedValueOnce(categories)
		await ensurePersonalWorkspace(db, userId)
		expect(insert).not.toHaveBeenCalled()
	})

	it('adds only a missing category without rewriting protected records', async () => {
		const { db, insert } = setup()
		const categories = (await starterCategories()).filter((category) => category.name !== 'Salary')
		db.all
			.mockResolvedValueOnce([{ userId }])
			.mockResolvedValueOnce([organization])
			.mockResolvedValueOnce([{ userId, organizationId: organization.id }])
			.mockResolvedValueOnce(categories)
		await ensurePersonalWorkspace(db, userId)
		expect(insert).toHaveBeenCalledTimes(1)
		expect(insert).toHaveBeenCalledWith(
			app.categories,
			{ organizationId: organization.id, name: 'Salary', kind: 'income', isSystem: false },
			{ id: expect.any(String) }
		)
	})

	it('does not write when existing workspace records cannot be read', async () => {
		const { db, insert } = setup()
		const failure = new Error('Workspace read failed.')
		db.all.mockRejectedValue(failure)
		await expect(ensurePersonalWorkspace(db, userId)).rejects.toBe(failure)
		expect(db.transaction).not.toHaveBeenCalled()
		expect(insert).not.toHaveBeenCalled()
	})

	it('does not report success when local persistence fails', async () => {
		const { db, wait } = setup()
		const failure = new Error('Local persistence failed.')
		db.all.mockResolvedValue([])
		wait.mockRejectedValueOnce(failure)
		await expect(ensurePersonalWorkspace(db, userId)).rejects.toBe(failure)
		expect(wait).toHaveBeenCalledWith({ tier: 'local' })
	})
})

async function starterCategories() {
	const { db, insert } = setup()
	db.all
		.mockResolvedValueOnce([{ userId }])
		.mockResolvedValueOnce([organization])
		.mockResolvedValueOnce([{ userId, organizationId: organization.id }])
		.mockResolvedValueOnce([])
	await ensurePersonalWorkspace(db, userId)
	return insert.mock.calls.flatMap(([table, values, options]) =>
		table === app.categories &&
		typeof values === 'object' &&
		values !== null &&
		'name' in values &&
		'kind' in values &&
		'isSystem' in values
			? [{ ...values, id: options?.id }]
			: []
	)
}
