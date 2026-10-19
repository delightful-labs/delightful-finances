import { beforeEach, describe, expect, it, vi } from 'vitest'
import { m } from './paraglide/messages.js'
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
	updateTransaction,
	ensurePersonalWorkspace,
	saveProfileName,
	saveProfileAvatar
} from './data.js'
import type { AppTransaction } from './domain/transaction.js'
import { app, type Account, type Organization } from './schema.js'

type Db = ReturnType<typeof getDb>
const userId = '11111111-1111-4111-8111-111111111111'
const profileId = '33333333-3333-4333-8333-333333333333'
const organizationId = '22222222-2222-4222-8222-222222222222'
const organization = {
	id: organizationId,
	name: 'Existing workspace',
	kind: 'personal',
	defaultCurrency: 'USD',
	ownerId: userId
} satisfies Organization

function setup() {
	vi.spyOn(crypto, 'randomUUID').mockReturnValue(organizationId)
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
	return { db, insert, wait, transaction }
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
			expect.objectContaining({ memo: 'Payment', checkDetailsId: organization.id }),
			{ id: organization.id }
		)
		expect(insert).toHaveBeenCalledWith(
			app.checkDetails,
			{
				transactionId: organization.id,
				organizationId: organization.id,
				accountId: input.accountId,
				checkNumber: '123',
				checkDate: '2026-10-12'
			},
			{ id: organization.id }
		)
		const tables = insert.mock.calls.map(([table]) => table)
		expect(tables.indexOf(app.checkDetails)).toBeLessThan(tables.indexOf(app.transactions))
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
	it('uses translated starter labels without changing category IDs or persisting seed keys', async () => {
		const baseline = await starterCategories()
		// Golden UUIDs from the pre-localization category seed names.
		expect(baseline.map(({ id }) => id)).toEqual([
			'9fd2bcfc-cdb4-5276-9fcb-b999077a3109',
			'192c1d03-fa80-53bd-a950-91db19bfebbe',
			'd5ea5f9c-6f10-56e9-a544-617ff479d553',
			'13bc316a-627a-518a-81a8-756454fae082',
			'65dcd338-f3cb-5e39-a4d1-5d0700b09f3c',
			'558276d3-f47e-58dc-b3c0-d2a4d09cb2dd',
			'2ba045d6-cd27-55db-8962-a5b9d1ed2af0',
			'be552916-de7d-5238-b7f9-1819cd54102c'
		])
		vi.spyOn(m, 'defaults.workspace').mockReturnValue(m['labels.workspace_name']())
		vi.spyOn(m, 'defaults.categories.uncategorized').mockReturnValue(m['labels.category']())
		vi.spyOn(m, 'defaults.categories.groceries').mockReturnValue(m['labels.tags']())
		const { db, insert } = setup()
		db.all.mockResolvedValue([])
		await ensurePersonalWorkspace(db, userId)
		expect(insert).toHaveBeenCalledWith(
			app.organizations,
			expect.objectContaining({ name: 'Workspace name' }),
			{ id: expect.any(String) }
		)
		const created = insert.mock.calls.filter(([table]) => table === app.categories)
		expect(created).toHaveLength(8)
		for (const [, values] of created) expect(values).not.toHaveProperty('key')
		expect(
			created.filter(
				([, values]) =>
					typeof values === 'object' &&
					values !== null &&
					'name' in values &&
					values.name === 'Category'
			)
		).toHaveLength(2)
		expect(
			created.some(
				([, values]) =>
					typeof values === 'object' &&
					values !== null &&
					'name' in values &&
					values.name === 'Tags'
			)
		).toBe(true)
		// Compare against the same organization namespace, not the new-workspace namespace.
		const translated = await starterCategories()
		expect(translated.map(({ id }) => id)).toEqual(baseline.map(({ id }) => id))
	})

	it('does not recreate or rename stored starters when translated defaults change', async () => {
		const categories = await starterCategories()
		vi.spyOn(m, 'defaults.workspace').mockReturnValue(m['labels.workspace_name']())
		vi.spyOn(m, 'defaults.categories.uncategorized').mockReturnValue(m['labels.category']())
		vi.spyOn(m, 'defaults.categories.groceries').mockReturnValue(m['labels.tags']())
		const { db, insert, transaction } = setup()
		const update = vi.spyOn(transaction, 'update')
		db.all
			.mockResolvedValueOnce([{ id: profileId, userId }])
			.mockResolvedValueOnce([organization])
			.mockResolvedValueOnce([
				{ id: 'membership', userId, organizationId: organization.id, profileId }
			])
			.mockResolvedValueOnce(categories)
		await expect(ensurePersonalWorkspace(db, userId)).resolves.toEqual(organization)
		expect(db.transaction).not.toHaveBeenCalled()
		expect(insert).not.toHaveBeenCalled()
		expect(update).not.toHaveBeenCalled()
	})

	it('creates a profile, owner membership and eight categories for a new workspace', async () => {
		const { db, insert, wait } = setup()
		db.all.mockResolvedValue([])
		await ensurePersonalWorkspace(db, userId)
		expect(insert).toHaveBeenCalledTimes(11)
		expect(insert).toHaveBeenCalledWith(app.profiles, { userId }, { id: expect.any(String) })
		const createdProfileId = insert.mock.calls.find(([table]) => table === app.profiles)?.[2]?.id
		expect(insert).toHaveBeenCalledWith(
			app.organizations,
			{ name: 'Personal workspace', kind: 'personal', defaultCurrency: 'USD', ownerId: userId },
			{ id: expect.any(String) }
		)
		expect(insert).toHaveBeenCalledWith(
			app.organizationMembers,
			expect.objectContaining({
				organizationId: organization.id,
				userId,
				profileId: createdProfileId,
				role: 'owner',
				accountAccessMode: 'all'
			}),
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
			.mockResolvedValueOnce([{ id: profileId, userId }])
			.mockResolvedValueOnce([organization])
			.mockResolvedValueOnce([
				{ id: 'membership', userId, organizationId: organization.id, profileId }
			])
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
			.mockResolvedValueOnce([{ id: profileId, userId }])
			.mockResolvedValueOnce([organization])
			.mockResolvedValueOnce([
				{ id: 'membership', userId, organizationId: organization.id, profileId }
			])
			.mockResolvedValueOnce(categories)
		await ensurePersonalWorkspace(db, userId)
		expect(insert).not.toHaveBeenCalled()
	})

	it('adds only a missing category without rewriting protected records', async () => {
		const { db, insert } = setup()
		const categories = (await starterCategories()).filter((category) => category.name !== 'Salary')
		db.all
			.mockResolvedValueOnce([{ id: profileId, userId }])
			.mockResolvedValueOnce([organization])
			.mockResolvedValueOnce([
				{ id: 'membership', userId, organizationId: organization.id, profileId }
			])
			.mockResolvedValueOnce(categories)
		await ensurePersonalWorkspace(db, userId)
		expect(insert).toHaveBeenCalledTimes(1)
		expect(insert).toHaveBeenCalledWith(
			app.categories,
			{ organizationId: organization.id, name: 'Salary', kind: 'income', isSystem: false },
			{ id: expect.any(String) }
		)
	})

	for (const storedProfileId of [null, 'another-profile']) {
		it(`repairs a ${storedProfileId ?? 'missing'} owner profile link without recreating rows`, async () => {
			const { db, insert, transaction, wait } = setup()
			const update = vi.spyOn(transaction, 'update').mockReturnValue(undefined)
			const categories = await starterCategories()
			db.all
				.mockResolvedValueOnce([{ id: profileId, userId }])
				.mockResolvedValueOnce([organization])
				.mockResolvedValueOnce([
					{ id: 'membership', userId, organizationId: organization.id, profileId: storedProfileId }
				])
				.mockResolvedValueOnce(categories)
			await ensurePersonalWorkspace(db, userId)
			expect(update).toHaveBeenCalledExactlyOnceWith(app.organizationMembers, 'membership', {
				profileId
			})
			expect(insert).not.toHaveBeenCalled()
			expect(wait).toHaveBeenCalledWith({ tier: 'local' })
		})
	}

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
		.mockResolvedValueOnce([{ id: profileId, userId }])
		.mockResolvedValueOnce([organization])
		.mockResolvedValueOnce([
			{ id: 'membership', userId, organizationId: organization.id, profileId }
		])
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
			await expect(
				createTag(db, organization.id, '  Garden  ', 'expense', categoryId)
			).resolves.toEqual({
				id: 'tag'
			})
			expect(db.insert).toHaveBeenCalledExactlyOnceWith(app.tags, {
				organizationId: organization.id,
				name: 'Garden',
				kind: 'expense',
				categoryId,
				archivedAt: null
			})
			expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
		}
	)
	it('rejects invalid names before inserting', () => {
		const db = { insert: vi.fn() } satisfies Pick<Db, 'insert'>
		expect(() => createTag(db, organization.id, ' ', 'expense', null)).toThrow()
		expect(db.insert).not.toHaveBeenCalled()
	})
	it('propagates tag creation failures', async () => {
		const failure = new Error('Persistence failed')
		const db = {
			insert: vi.fn().mockReturnValue({ wait: vi.fn().mockRejectedValue(failure) })
		} satisfies Pick<Db, 'insert'>
		await expect(createTag(db, organization.id, 'Garden', 'expense', null)).rejects.toBe(failure)
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

describe('transaction tag persistence', () => {
	const input: AppTransaction = {
		kind: 'expense',
		source: { source: 'manual' },
		organizationId: organization.id,
		accountId: 'account',
		categoryId: '33333333-3333-4333-8333-333333333333',
		bookedOn: '2026-10-14',
		money: { amountMinor: 100, currency: 'USD' }
	}
	it('creates new tags with the transaction category and links all selected tags atomically', async () => {
		const { db, transaction, insert, wait } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([])
		await createTransaction(db, { ...input, tags: [' Garden ', 'Work', 'garden'] })
		expect(db.transaction).toHaveBeenCalledTimes(1)
		expect(insert.mock.calls.filter(([table]) => table === app.tags)).toHaveLength(2)
		expect(insert).toHaveBeenCalledWith(app.tags, {
			organizationId: organization.id,
			name: 'garden',
			kind: 'expense',
			categoryId: input.categoryId,
			archivedAt: null
		})
		expect(insert.mock.calls.filter(([table]) => table === app.transactionTags)).toHaveLength(2)
		expect(insert).toHaveBeenCalledWith(app.transactionTags, {
			organizationId: organization.id,
			transactionId: organization.id,
			tagId: organization.id
		})
		expect(wait).toHaveBeenCalledWith({ tier: 'local' })
	})
	it('reuses existing tags without changing their category', async () => {
		const { db, transaction, insert } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([
			{
				id: 'existing',
				organizationId: organization.id,
				name: 'Garden',
				kind: 'expense',
				categoryId: 'original',
				archivedAt: null
			}
		])
		await createTransaction(db, { ...input, tags: ['garden'] })
		expect(insert.mock.calls.filter(([table]) => table === app.tags)).toHaveLength(0)
		expect(insert).toHaveBeenCalledWith(app.transactionTags, {
			organizationId: organization.id,
			transactionId: organization.id,
			tagId: 'existing'
		})
	})
	it('does not read or create tags when none are selected', async () => {
		const { db, transaction, insert } = setup()
		const read = vi.spyOn(transaction, 'all')
		await createTransaction(db, { ...input, tags: [] })
		expect(read).not.toHaveBeenCalled()
		expect(insert).toHaveBeenCalledTimes(1)
	})
	it.each([
		{ kind: 'expense', archivedAt: new Date(), organizationId: organization.id },
		{ kind: 'income', archivedAt: null, organizationId: organization.id },
		{ kind: null, archivedAt: null, organizationId: organization.id },
		{ kind: 'expense', archivedAt: null, organizationId: 'other' }
	])('creates a typed tag instead of reusing an ineligible existing tag: %j', async (patch) => {
		const { db, transaction, insert } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([
			{ id: 'old-tag', name: 'Garden', categoryId: null, ...patch }
		])
		await createTransaction(db, { ...input, tags: ['Garden'] })
		expect(insert).toHaveBeenCalledWith(app.tags, {
			organizationId: organization.id,
			kind: 'expense',
			name: 'Garden',
			categoryId: input.categoryId,
			archivedAt: null
		})
		expect(insert).not.toHaveBeenCalledWith(
			app.transactionTags,
			expect.objectContaining({ tagId: 'old-tag' })
		)
	})
	it('rejects ambiguous active tag names at the transaction boundary', async () => {
		const { db, transaction, wait } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([
			{
				id: 'one',
				organizationId: organization.id,
				kind: 'expense',
				name: 'Garden',
				archivedAt: null
			},
			{
				id: 'two',
				organizationId: organization.id,
				kind: 'expense',
				name: ' garden ',
				archivedAt: null
			}
		])
		await expect(createTransaction(db, { ...input, tags: ['Garden'] })).rejects.toThrow('ambiguous')
		expect(wait).not.toHaveBeenCalled()
	})
	it('creates income tags with the income category and kind', async () => {
		const { db, transaction, insert } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([])
		await createTransaction(db, {
			...input,
			source: { source: 'manual' },
			kind: 'income',
			paymentMethod: 'cash',
			tags: ['Salary']
		})
		expect(insert).toHaveBeenCalledWith(app.tags, {
			organizationId: organization.id,
			kind: 'income',
			name: 'Salary',
			categoryId: input.categoryId,
			archivedAt: null
		})
	})
	it('propagates failures persisting the complete transaction locally', async () => {
		const { db, wait } = setup()
		const failure = new Error('Persistence failed')
		wait.mockRejectedValueOnce(failure)
		await expect(createTransaction(db, input)).rejects.toBe(failure)
	})
})

describe('saveProfileName', () => {
	it('normalizes the name, updates only the display field, and waits for local persistence', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileName(db, 'profile', userId, '  Matthew  ')
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', {
			displayName: 'Matthew'
		})
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it.each([null, undefined])('clears the name with %j', async (displayName) => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileName(db, 'profile', userId, displayName)
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', {
			displayName: null
		})
	})
	it('rejects invalid canonical names or identities before writing', () => {
		const db = { update: vi.fn() } satisfies Pick<Db, 'update'>
		expect(() => saveProfileName(db, 'profile', userId, ' ')).toThrow()
		expect(() => saveProfileName(db, 'profile', 'invalid', 'Matthew')).toThrow()
		expect(db.update).not.toHaveBeenCalled()
	})
	it('returns the local persistence promise and propagates its failure', async () => {
		const pending = Promise.withResolvers<void>()
		const wait = vi.fn(() => pending.promise)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		const result = saveProfileName(db, 'profile', userId, 'Matthew')
		expect(result).toBe(pending.promise)
		const rejection = expect(result).rejects.toThrow('Profile write failed')
		pending.reject(new Error('Profile write failed'))
		await rejection
	})
})

describe('saveProfileAvatar', () => {
	const avatar = {
		avatarData: new Uint8Array([1, 2, 3]),
		avatarMimeType: 'image/png'
	} satisfies Parameters<typeof saveProfileAvatar>[3]
	it('writes bytes and MIME type together without changing identity or display name', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileAvatar(db, 'profile', userId, avatar)
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', avatar)
		expect(wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
	})
	it('removes both avatar fields atomically', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		await saveProfileAvatar(db, 'profile', userId, { avatarData: null, avatarMimeType: null })
		expect(db.update).toHaveBeenCalledExactlyOnceWith(app.profiles, 'profile', {
			avatarData: null,
			avatarMimeType: null
		})
	})
	it('rejects invalid identities before writing', () => {
		const db = { update: vi.fn() } satisfies Pick<Db, 'update'>
		expect(() => saveProfileAvatar(db, 'profile', 'invalid', avatar)).toThrow()
		expect(db.update).not.toHaveBeenCalled()
	})
	it('returns local persistence and propagates write failures', async () => {
		const pending = Promise.withResolvers<void>()
		const wait = vi.fn(() => pending.promise)
		const db = { update: vi.fn().mockReturnValue({ wait }) } satisfies Pick<Db, 'update'>
		const result = saveProfileAvatar(db, 'profile', userId, avatar)
		expect(result).toBe(pending.promise)
		const rejection = expect(result).rejects.toThrow('Avatar write failed')
		pending.reject(new Error('Avatar write failed'))
		await rejection
	})
})

describe('updateTransaction', () => {
	const input: AppTransaction = {
		organizationId,
		accountId: userId,
		categoryId: profileId,
		kind: 'expense',
		source: { source: 'manual' },
		money: { amountMinor: 100, currency: 'USD' },
		bookedOn: '2026-10-18',
		tags: ['Historical']
	}
	const existing = {
		id: profileId,
		organizationId,
		accountId: userId,
		kind: 'expense',
		source: 'manual',
		paymentMethod: null
	}
	it.each([true, false])(
		'preserves or removes archived assignments according to selection: %s',
		async (retained) => {
			const { db, transaction, insert, wait } = setup()
			const update = vi.spyOn(transaction, 'update').mockReturnValue(undefined)
			const remove = vi.spyOn(transaction, 'delete').mockReturnValue(undefined)
			vi.spyOn(transaction, 'all')
				.mockResolvedValueOnce([existing])
				.mockResolvedValueOnce([{ id: 'link', tagId: 'archived-tag' }])
				.mockResolvedValueOnce([{ id: 'archived-tag', name: 'Historical', archivedAt: new Date() }])
				.mockResolvedValueOnce([])
			await expect(
				updateTransaction(db, profileId, { ...input, tags: retained ? ['Historical'] : [] })
			).resolves.toEqual({ value: profileId })
			expect(update).toHaveBeenCalledOnce()
			expect(insert).not.toHaveBeenCalled()
			if (retained) expect(remove).not.toHaveBeenCalled()
			else expect(remove).toHaveBeenCalledExactlyOnceWith(app.transactionTags, 'link')
			expect(wait).toHaveBeenCalledWith({ tier: 'local' })
		}
	)
	it.each([
		{ rows: [] },
		{ rows: [{ ...existing, source: 'simplefin' }] },
		{ rows: [{ ...existing, organizationId: 'other' }] }
	])('rejects missing or incompatible existing rows before mutation', async ({ rows }) => {
		const { db, transaction, insert } = setup()
		const update = vi.spyOn(transaction, 'update').mockReturnValue(undefined)
		vi.spyOn(transaction, 'all').mockResolvedValue(rows)
		await expect(updateTransaction(db, profileId, input)).rejects.toThrow()
		expect(update).not.toHaveBeenCalled()
		expect(insert).not.toHaveBeenCalled()
	})
})
