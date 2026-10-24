import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPolicyTestApp, type PolicyTestApp, type TestDb } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'

const organizationId = crypto.randomUUID()
const otherOrganizationId = crypto.randomUUID()
const accountId = crypto.randomUUID()
const otherAccountId = crypto.randomUUID()
const foreignAccountId = crypto.randomUUID()
const expenseCategoryId = crypto.randomUUID()
const incomeCategoryId = crypto.randomUUID()
const foreignCategoryId = crypto.randomUUID()
const historicalTagId = crypto.randomUUID()
const historicalLinkId = crypto.randomUUID()
const expenseId = crypto.randomUUID()
const session = {
	user_id: 'permission-integrity',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let fixture: PolicyTestApp
let db: TestDb
const selectedMemberSession = {
	user_id: 'check-selected-member',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
const viewerSession = {
	user_id: 'check-viewer',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let selectedMemberDb: TestDb
let viewerDb: TestDb

function transaction(kind: 'expense' | 'income') {
	return {
		organizationId,
		accountId,
		categoryId: kind === 'expense' ? expenseCategoryId : incomeCategoryId,
		kind,
		amountMinor: 100,
		currency: 'USD',
		bookedOn: '2026-10-23',
		source: 'manual'
	} satisfies import('jazz-tools').schema.InsertOf<typeof app.transactions>
}

beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	db = fixture.as(session)
	const userId = fixture.accountFor(session)

	for (const id of [organizationId, otherOrganizationId]) {
		await fixture.seed((seed) =>
			seed.insert(
				app.organizations,
				{ name: 'Permission fixture', ownerId: userId, kind: 'personal', defaultCurrency: 'USD' },
				{ id }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(app.organizationMembers, {
				organizationId: id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
		)
	}
	await fixture.seed((seed) =>
		seed.insert(
			app.accounts,
			{ organizationId, name: 'Ledger', kind: 'cash', currency: 'USD' },
			{ id: accountId }
		)
	)
	for (const [id, scope] of [
		[otherAccountId, organizationId],
		[foreignAccountId, otherOrganizationId]
	] satisfies [string, string][]) {
		await fixture.seed((seed) =>
			seed.insert(
				app.accounts,
				{ organizationId: scope, name: 'Other', kind: 'cash', currency: 'USD' },
				{ id }
			)
		)
	}
	selectedMemberDb = fixture.as(selectedMemberSession)
	viewerDb = fixture.as(viewerSession)
	const selectedMemberId = fixture.accountFor(selectedMemberSession)
	const viewerId = fixture.accountFor(viewerSession)
	await fixture.seed((seed) =>
		seed.insert(app.organizationMembers, {
			organizationId,
			userId: selectedMemberId,
			role: 'member',
			accountAccessMode: 'selected'
		})
	)
	await fixture.seed((seed) =>
		seed.insert(app.accountMemberships, {
			organizationId,
			accountId,
			userId: selectedMemberId,
			access: 'write'
		})
	)
	await fixture.seed((seed) =>
		seed.insert(app.organizationMembers, {
			organizationId,
			userId: viewerId,
			role: 'viewer',
			accountAccessMode: 'all'
		})
	)
	for (const [id, kind, workspace] of [
		[expenseCategoryId, 'expense', organizationId],
		[incomeCategoryId, 'income', organizationId],
		[foreignCategoryId, 'expense', otherOrganizationId]
	] satisfies [string, 'expense' | 'income', string][]) {
		await fixture.seed((seed) =>
			seed.insert(
				app.categories,
				{ organizationId: workspace, kind, name: kind, isSystem: false },
				{ id }
			)
		)
	}
	await fixture.seed((seed) =>
		seed.insert(app.transactions, transaction('expense'), { id: expenseId })
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.tags,
			{ organizationId, name: 'Historical', kind: 'expense' },
			{ id: historicalTagId }
		)
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.transactionTags,
			{ organizationId, transactionId: expenseId, tagId: historicalTagId },
			{ id: historicalLinkId }
		)
	)
}, 30_000)
afterAll(async () => {
	await fixture?.shutdown()
})

describe('independent Check permissions', () => {
	async function createCheck(scope = { organizationId, accountId }) {
		return db
			.insert(app.checks, {
				...scope,
				checkNumber: crypto.randomUUID().slice(0, 8),
				checkDate: '2026-10-23'
			})
			.wait({ tier: 'global' })
	}

	it('allows a selected member to create and edit a Check only in a granted account', async () => {
		const check = await selectedMemberDb
			.insert(app.checks, {
				organizationId,
				accountId,
				checkNumber: '101',
				checkDate: '2026-10-23'
			})
			.wait({ tier: 'global' })
		await selectedMemberDb
			.update(app.checks, check.id, { memoOnCheck: 'Updated' })
			.wait({ tier: 'global' })
		expect(
			(await selectedMemberDb.one(app.checks.where({ id: check.id }), { tier: 'remote' }))
				?.memoOnCheck
		).toBe('Updated')
		await selectedMemberDb.expectDenied((writer) =>
			writer.insert(app.checks, {
				organizationId,
				accountId: otherAccountId,
				checkNumber: '102',
				checkDate: '2026-10-23'
			})
		)
		await db.expectDenied((writer) =>
			writer.update(app.checks, check.id, { accountId: otherAccountId })
		)
		await db.expectDenied((writer) => writer.delete(app.checks, check.id))
	})

	it('keeps Check access within organization and viewer rules', async () => {
		const check = await createCheck()
		expect(await viewerDb.one(app.checks.where({ id: check.id }), { tier: 'remote' })).toBeTruthy()
		await viewerDb.expectDenied((writer) => writer.update(app.checks, check.id, { bankName: 'No' }))
		await selectedMemberDb.expectDenied((writer) =>
			writer.insert(app.checks, {
				organizationId: otherOrganizationId,
				accountId: foreignAccountId,
				checkNumber: '103',
				checkDate: '2026-10-23'
			})
		)
	})

	it.each(['income', 'expense'] satisfies ('income' | 'expense')[])(
		'allows a direct %s transaction reference to a saved Check',
		async (kind) => {
			const check = await createCheck()
			const row = await db
				.insert(app.transactions, {
					...transaction(kind),
					paymentMethod: 'check',
					checkId: check.id
				})
				.wait({ tier: 'global' })
			expect(row.checkId).toBe(check.id)
		}
	)

	it('rejects missing, mismatched, and simultaneous Check references on direct writes', async () => {
		const check = await createCheck()
		const otherCheck = await createCheck({ organizationId, accountId: otherAccountId })
		const foreignCheck = await createCheck({
			organizationId: otherOrganizationId,
			accountId: foreignAccountId
		})
		for (const checkId of [crypto.randomUUID(), otherCheck.id, foreignCheck.id]) {
			await db.expectDenied((writer) =>
				writer.insert(app.transactions, {
					...transaction('expense'),
					paymentMethod: 'check',
					checkId
				})
			)
		}
		await db.expectDenied((writer) =>
			writer.insert(app.transactions, {
				...transaction('expense'),
				paymentMethod: 'cash',
				checkId: check.id
			})
		)
		const row = await db.insert(app.transactions, transaction('expense')).wait({ tier: 'global' })
		await db.expectDenied((writer) =>
			writer.update(app.transactions, row.id, { paymentMethod: 'check', checkId: otherCheck.id })
		)
		await db
			.update(app.transactions, row.id, { paymentMethod: 'check', checkId: check.id })
			.wait({ tier: 'global' })
		await db.expectDenied((writer) =>
			writer.update(app.transactions, row.id, { checkDetailsId: crypto.randomUUID() })
		)
	})
})

describe('tag permission integrity', () => {
	it.each([
		{ name: 'wrong category kind', kind: 'expense', categoryId: incomeCategoryId },
		{ name: 'foreign category', kind: 'expense', categoryId: foreignCategoryId }
	] satisfies { name: string; kind: 'expense'; categoryId: string | null }[])(
		'rejects $name',
		async (values) => {
			await db.expectDenied((writer) => writer.insert(app.tags, { organizationId, ...values }))
		}
	)
	it('accepts typed tags with matching or absent categories and rejects incompatible updates', async () => {
		for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
			const categoryId = kind === 'expense' ? expenseCategoryId : incomeCategoryId
			const tag = await db
				.insert(app.tags, { organizationId, name: kind, kind, categoryId })
				.wait({ tier: 'global' })
			expect(tag.kind).toBe(kind)
			await db.expectDenied((writer) =>
				writer.update(app.tags, tag.id, { categoryId: foreignCategoryId })
			)
			await db.expectDenied((writer) =>
				writer.update(app.tags, tag.id, {
					categoryId: kind === 'expense' ? incomeCategoryId : expenseCategoryId
				})
			)
			await db.expectDenied((writer) =>
				writer.update(app.tags, tag.id, {
					kind: kind === 'expense' ? 'income' : 'expense',
					categoryId: null
				})
			)
			const uncategorized = await db
				.insert(app.tags, { organizationId, name: 'No category', kind })
				.wait({ tier: 'global' })
			expect(uncategorized.kind).toBe(kind)
		}
	})
	it('matches assignment kinds and prevents transaction kind changes', async () => {
		for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
			const tag = await db
				.insert(app.tags, { organizationId, name: 'Assignment', kind })
				.wait({ tier: 'global' })
			if (kind === 'income') {
				await db.expectDenied((writer) =>
					writer.insert(app.transactionTags, {
						organizationId,
						transactionId: expenseId,
						tagId: tag.id
					})
				)
			} else {
				const link = await db
					.insert(app.transactionTags, { organizationId, transactionId: expenseId, tagId: tag.id })
					.wait({ tier: 'global' })
				expect(link.tagId).toBe(tag.id)
			}
		}
		await db.expectDenied((writer) =>
			writer.update(app.transactions, expenseId, {
				kind: 'income',
				categoryId: incomeCategoryId,
				paymentMethod: 'cash'
			})
		)
	})
	it('rejects missing/null kinds on direct SDK inserts and updates', async () => {
		for (const kind of [undefined, null]) {
			const values = {
				organizationId,
				name: 'Invalid',
				kind: 'expense'
			} satisfies import('jazz-tools').schema.InsertOf<typeof app.tags>
			if (kind === undefined) Reflect.deleteProperty(values, 'kind')
			else Reflect.set(values, 'kind', kind)
			await expect(
				Promise.resolve().then(() => db.insert(app.tags, values).wait({ tier: 'global' }))
			).rejects.toThrow()
		}
		const patch: Pick<import('./schema.js').Tag, 'kind'> = { kind: 'expense' }
		Reflect.set(patch, 'kind', null)
		await expect(
			Promise.resolve().then(() =>
				db.update(app.tags, historicalTagId, patch).wait({ tier: 'global' })
			)
		).rejects.toThrow()
		expect((await db.one(app.tags.where({ id: historicalTagId }), { tier: 'remote' }))?.kind).toBe(
			'expense'
		)
	})
	it('preserves archived typed history and permits removing its assignment', async () => {
		await db.update(app.tags, historicalTagId, { archivedAt: new Date() }).wait({ tier: 'global' })
		expect(
			await db.one(app.transactionTags.where({ id: historicalLinkId }), { tier: 'remote' })
		).toBeTruthy()
		await db.expectDenied((writer) =>
			writer.insert(app.transactionTags, {
				organizationId,
				transactionId: expenseId,
				tagId: historicalTagId
			})
		)
		await db.delete(app.transactionTags, historicalLinkId).wait({ tier: 'global' })
		expect(
			await db.one(app.transactionTags.where({ id: historicalLinkId }), { tier: 'remote' })
		).toBeNull()
	})
	it('rejects moving a tag or assigning it across workspaces even with access to both', async () => {
		const tag = await db
			.insert(app.tags, { organizationId, name: 'Scope', kind: 'expense' })
			.wait({ tier: 'global' })
		await db.expectDenied((writer) =>
			writer.update(app.tags, tag.id, { organizationId: otherOrganizationId })
		)
		const foreign = await db
			.insert(app.tags, { organizationId: otherOrganizationId, name: 'Foreign', kind: 'expense' })
			.wait({ tier: 'global' })
		for (const scope of [organizationId, otherOrganizationId]) {
			await db.expectDenied((writer) =>
				writer.insert(app.transactionTags, {
					organizationId: scope,
					transactionId: expenseId,
					tagId: foreign.id
				})
			)
		}
	})
})

describe('income payment method permissions', () => {
	it('rejects manual income without a method on insert and update', async () => {
		await db.expectDenied((writer) => writer.insert(app.transactions, transaction('income')))
		const row = await db
			.insert(app.transactions, { ...transaction('income'), paymentMethod: 'cash' })
			.wait({ tier: 'global' })
		await db.expectDenied((writer) =>
			writer.update(app.transactions, row.id, { paymentMethod: null })
		)
	})
	it.each(['cash', 'transfer', 'electronic'] satisfies ('cash' | 'transfer' | 'electronic')[])(
		'accepts manual %s income',
		async (paymentMethod) => {
			const row = await db
				.insert(app.transactions, { ...transaction('income'), paymentMethod })
				.wait({ tier: 'global' })
			expect(row.paymentMethod).toBe(paymentMethod)
		}
	)
	it('accepts imported income without a method but still requires details for check income', async () => {
		const row = await db
			.insert(app.transactions, {
				...transaction('income'),
				source: 'simplefin',
				externalId: 'provider-income'
			})
			.wait({ tier: 'global' })
		expect(row.paymentMethod).toBeNull()
		await db.expectDenied((writer) =>
			writer.insert(app.transactions, { ...transaction('income'), paymentMethod: 'check' })
		)
		await db.expectDenied((writer) => writer.update(app.transactions, row.id, { source: 'manual' }))
	})
})

describe('exact large money storage', () => {
	it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])(
		'persists %s minor units through the SDK authority without truncation',
		async (amountMinor) => {
			const row = await db
				.insert(app.transactions, { ...transaction('expense'), amountMinor })
				.wait({ tier: 'global' })
			const saved = await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' })
			expect(saved?.amountMinor).toBe(amountMinor)
		}
	)
})

describe('immutable transaction provenance', () => {
	it.each(['expense', 'income'] satisfies ('expense' | 'income')[])(
		'allows %s annotations but rejects provider identity and source changes',
		async (kind) => {
			const row = await db
				.insert(app.transactions, {
					...transaction(kind),
					source: 'simplefin',
					externalId: `immutable-${kind}`
				})
				.wait({ tier: 'global' })
			await db
				.update(app.transactions, row.id, { description: 'User description', memo: 'User notes' })
				.wait({ tier: 'global' })
			await db.expectDenied((writer) =>
				writer.update(app.transactions, row.id, { externalId: 'changed' })
			)
			await expect(
				Promise.resolve().then(() =>
					db.update(app.transactions, row.id, { externalId: null }).wait({ tier: 'global' })
				)
			).rejects.toThrow()
			await db.expectDenied((writer) =>
				writer.update(app.transactions, row.id, {
					source: 'manual',
					paymentMethod: kind === 'income' ? 'cash' : null
				})
			)
			const saved = await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' })
			expect(saved).toMatchObject({
				source: 'simplefin',
				externalId: `immutable-${kind}`,
				description: 'User description',
				memo: 'User notes',
				paymentMethod: null
			})
		}
	)
	it('rejects converting a manual expense into a provider transaction', async () => {
		const row = await db.insert(app.transactions, transaction('expense')).wait({ tier: 'global' })
		await db.expectDenied((writer) =>
			writer.update(app.transactions, row.id, { source: 'simplefin', externalId: 'forged' })
		)
	})
})
