import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadTier, Transaction } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import {
	archiveAccount,
	archiveCategory,
	archiveTag,
	createTag,
	createCategory,
	createAccount,
	createTransaction,
	ensurePersonalWorkspace
} from './data.js'
import type { AppTransaction } from './domain/transaction.js'
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
		await expect(createAccount(db, organization.id, '  Checking  ', 'bank')).resolves.toEqual(
			account
		)
		expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.accounts, {
			organizationId: organization.id,
			name: 'Checking',
			kind: 'bank',
			currency: 'USD',
			archivedAt: null
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
	it('rejects blank names before opening a write', () => {
		const db = { insert: vi.fn() } satisfies Pick<Db, 'insert'>
		expect(() => createAccount(db, organization.id, ' ', 'cash')).toThrow()
		expect(db.insert).not.toHaveBeenCalled()
	})
})

describe('archiveAccount', () => {
	it('only sets the archive timestamp and waits for local persistence', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		const before = Date.now()
		await archiveAccount(db, 'account')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.accounts, 'account', {
			archivedAt: expect.any(Date)
		})
		const archivedAt = db.update.mock.calls[0]?.[2]?.archivedAt
		expect(archivedAt.getTime()).toBeGreaterThanOrEqual(before)
		expect(archivedAt.getTime()).toBeLessThanOrEqual(Date.now())
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('propagates local persistence errors', async () => {
		const failure = new Error('Archive persistence failed')
		const wait = vi.fn().mockRejectedValue(failure)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await expect(archiveAccount(db, 'account')).rejects.toBe(failure)
	})
})

describe('createTransaction normalization', () => {
	const input: AppTransaction = {
		kind: 'income',
		source: { source: 'manual' },
		paymentMethod: 'check',
		accountId: 'account',
		organizationId: organization.id,
		categoryId: 'category',
		bookedOn: '2026-10-13',
		money: { amountMinor: 100, currency: 'USD' },
		memo: '  Payment  ',
		checkDetails: { checkNumber: ' 123 ', checkDate: '2026-10-12' }
	}
	it('persists normalized memo and check details', async () => {
		const { db, insert } = setup()
		await createTransaction(db, input)
		expect(insert).toHaveBeenCalledWith(
			app.transactions,
			expect.objectContaining({ memo: 'Payment' })
		)
		expect(insert).toHaveBeenCalledWith(app.checkDetails, {
			transactionId: organization.id,
			checkNumber: '123',
			checkDate: '2026-10-12'
		})
	})
	it('omits whitespace-only memos from writes', async () => {
		const { db, insert } = setup()
		await createTransaction(db, { ...input, memo: ' ' })
		const values = insert.mock.calls.find(([table]) => table === app.transactions)?.[1]
		expect(values).not.toHaveProperty('memo')
	})
	it('rejects invalid transactions without opening a write', async () => {
		const { db } = setup()
		await expect(createTransaction(db, { ...input, bookedOn: 'invalid' })).resolves.toEqual({
			error: 'booked-on'
		})
		expect(db.transaction).not.toHaveBeenCalled()
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

describe('category persistence', () => {
	it('creates a trimmed non-system category in the selected workspace and waits locally', async () => {
		const wait = vi.fn().mockResolvedValue({ id: 'category' })
		const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
		await expect(createCategory(db, organization.id, '  Food  ', 'expense')).resolves.toEqual({
			id: 'category'
		})
		expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.categories, {
			organizationId: organization.id,
			name: 'Food',
			kind: 'expense',
			isSystem: false,
			archivedAt: null
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('rejects invalid input before inserting', () => {
		const db = { insert: vi.fn() } satisfies Pick<Db, 'insert'>
		expect(() => createCategory(db, organization.id, ' ', 'income')).toThrow()
		expect(db.insert).not.toHaveBeenCalled()
	})
	it('propagates category creation persistence failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			insert: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'insert'>
		await expect(createCategory(db, organization.id, 'Food', 'expense')).rejects.toBe(failure)
	})
	it('archives without deleting the category or its connections and waits locally', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await archiveCategory(db, 'category')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.categories, 'category', {
			archivedAt: expect.any(Date)
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('propagates category archive persistence failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			update: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'update'>
		await expect(archiveCategory(db, 'category')).rejects.toBe(failure)
	})
})

describe('tag persistence', () => {
	it.each([null, organization.id])(
		'creates normalized tags with category %s and waits locally',
		async (categoryId) => {
			const wait = vi.fn().mockResolvedValue({ id: 'tag' })
			const db = { insert: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'insert'>
			await expect(createTag(db, organization.id, '  Garden  ', categoryId)).resolves.toEqual({
				id: 'tag'
			})
			expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.tags, {
				organizationId: organization.id,
				name: 'Garden',
				categoryId,
				archivedAt: null
			})
			expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
		}
	)
	it('rejects invalid names before inserting', () => {
		const db = { insert: vi.fn() } satisfies Pick<Db, 'insert'>
		expect(() => createTag(db, organization.id, ' ', null)).toThrow()
		expect(db.insert).not.toHaveBeenCalled()
	})
	it('propagates tag creation failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			insert: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'insert'>
		await expect(createTag(db, organization.id, 'Garden', null)).rejects.toBe(failure)
	})
	it('archives without deleting or rewriting links and waits locally', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await archiveTag(db, 'tag')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.tags, 'tag', {
			archivedAt: expect.any(Date)
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('propagates tag archive failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			update: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'update'>
		await expect(archiveTag(db, 'tag')).rejects.toBe(failure)
	})
})
