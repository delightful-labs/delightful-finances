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
let selectedMemberId: string

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
	selectedMemberId = fixture.accountFor(selectedMemberSession)
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
			access: 'write',
			canDelete: false
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
		await db.update(app.checks, check.id, { accountId: otherAccountId }).wait({ tier: 'global' })
		expect((await db.one(app.checks.where({ id: check.id }), { tier: 'remote' }))?.accountId).toBe(
			otherAccountId
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
	it('allows manual income without a method on insert and update', async () => {
		const row = await db.insert(app.transactions, transaction('income')).wait({ tier: 'global' })
		expect(row.paymentMethod).toBeNull()
		await db.update(app.transactions, row.id, { paymentMethod: null }).wait({ tier: 'global' })
		expect(
			(await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' }))?.paymentMethod
		).toBeNull()
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

describe('internal transfer read safety during unlink recovery', () => {
	it('reveals conflicting links only when the user can read both endpoint accounts', async () => {
		const effectiveTransferId = crypto.randomUUID()
		const conflictingTransferId = crypto.randomUUID()
		const expenseTransactionId = crypto.randomUUID()
		const effectiveIncomeId = crypto.randomUUID()
		const conflictingIncomeId = crypto.randomUUID()

		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: effectiveTransferId },
				{ id: expenseTransactionId }
			)
		)
		for (const [id, transferId] of [
			[effectiveIncomeId, effectiveTransferId],
			[conflictingIncomeId, conflictingTransferId]
		] satisfies [string, string][]) {
			await fixture.seed((seed) =>
				seed.insert(
					app.transactions,
					{
						...transaction('income'),
						accountId: otherAccountId,
						internalTransferId: transferId
					},
					{ id }
				)
			)
		}
		for (const [id, incomeTransactionId] of [
			[effectiveTransferId, effectiveIncomeId],
			[conflictingTransferId, conflictingIncomeId]
		] satisfies [string, string][]) {
			await fixture.seed((seed) =>
				seed.insert(
					app.internalTransfers,
					{
						organizationId,
						expenseTransactionId,
						incomeTransactionId,
						expenseAccountId: accountId,
						incomeAccountId: otherAccountId,
						amountMinor: 100,
						currency: 'USD'
					},
					{ id }
				)
			)
		}

		expect(
			(await db.one(app.internalTransfers.where({ id: conflictingTransferId }), { tier: 'remote' }))
				?.id
		).toBe(conflictingTransferId)
		expect(
			await selectedMemberDb.one(app.internalTransfers.where({ id: conflictingTransferId }), {
				tier: 'remote'
			})
		).toBeNull()
	})

	it('reveals a pending unlink only to a user who can read both endpoint accounts', async () => {
		const transferId = crypto.randomUUID()
		const pendingExpenseId = crypto.randomUUID()
		const pendingIncomeId = crypto.randomUUID()
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: transferId },
				{ id: pendingExpenseId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{
					...transaction('income'),
					accountId: otherAccountId,
					internalTransferId: transferId
				},
				{ id: pendingIncomeId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.internalTransfers,
				{
					organizationId,
					expenseTransactionId: pendingExpenseId,
					incomeTransactionId: pendingIncomeId,
					expenseAccountId: accountId,
					incomeAccountId: otherAccountId,
					amountMinor: 100,
					currency: 'USD'
				},
				{ id: transferId }
			)
		)
		const linked = app.internalTransfers.where({ id: transferId })
		expect((await db.one(linked, { tier: 'remote' }))?.id).toBe(transferId)
		expect(await selectedMemberDb.one(linked, { tier: 'remote' })).toBeNull()

		const clearMarkers = await db.transaction((tx) => {
			tx.update(app.transactions, pendingExpenseId, { internalTransferId: null })
			tx.update(app.transactions, pendingIncomeId, { internalTransferId: null })
		})
		await clearMarkers.wait({ tier: 'global' })

		expect((await db.one(linked, { tier: 'remote' }))?.id).toBe(transferId)
		expect(await selectedMemberDb.one(linked, { tier: 'remote' })).toBeNull()
	})
})

describe('linked transaction update safety', () => {
	it('allows metadata edits and rejects one-sided amount, account, or currency changes', async () => {
		const transferId = crypto.randomUUID()
		const linkedExpenseId = crypto.randomUUID()
		const incomeId = crypto.randomUUID()
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: transferId },
				{ id: linkedExpenseId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{
					...transaction('income'),
					accountId: otherAccountId,
					internalTransferId: transferId
				},
				{ id: incomeId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.internalTransfers,
				{
					organizationId,
					expenseTransactionId: linkedExpenseId,
					incomeTransactionId: incomeId,
					expenseAccountId: accountId,
					incomeAccountId: otherAccountId,
					amountMinor: 100,
					currency: 'USD'
				},
				{ id: transferId }
			)
		)

		await db
			.update(app.transactions, linkedExpenseId, { description: 'Card payment' })
			.wait({ tier: 'global' })
		await db.expectDenied((writer) =>
			writer.update(app.transactions, linkedExpenseId, { amountMinor: 101 })
		)
		await db.expectDenied((writer) =>
			writer.update(app.transactions, linkedExpenseId, { accountId: otherAccountId })
		)
		await db.expectDenied((writer) =>
			writer.update(app.transactions, linkedExpenseId, { currency: 'CAD' })
		)
		const saved = await db.one(app.transactions.where({ id: linkedExpenseId }), { tier: 'remote' })
		expect(saved).toMatchObject({
			amountMinor: 100,
			accountId,
			currency: 'USD',
			description: 'Card payment'
		})
	})
})

describe('linked transaction deletion permissions', () => {
	async function configureMemberDeleteGrants(expenseCanDelete: boolean, incomeCanDelete: boolean) {
		const sourceGrant = await db.one(
			app.accountMemberships.where({
				organizationId,
				accountId,
				userId: selectedMemberId
			})
		)
		if (!sourceGrant) throw new Error('Missing selected member source grant')
		await db
			.update(app.accountMemberships, sourceGrant.id, {
				access: 'write',
				canDelete: expenseCanDelete
			})
			.wait({ tier: 'global' })
		const destinationGrant = await db.one(
			app.accountMemberships.where({
				organizationId,
				accountId: otherAccountId,
				userId: selectedMemberId
			})
		)
		if (destinationGrant) {
			await db
				.update(app.accountMemberships, destinationGrant.id, {
					access: 'write',
					canDelete: incomeCanDelete
				})
				.wait({ tier: 'global' })
			return
		}
		await db
			.insert(app.accountMemberships, {
				organizationId,
				accountId: otherAccountId,
				userId: selectedMemberId,
				access: 'write',
				canDelete: incomeCanDelete
			})
			.wait({ tier: 'global' })
	}

	async function seedTransferPair() {
		const transferId = crypto.randomUUID()
		const linkedExpenseId = crypto.randomUUID()
		const linkedIncomeId = crypto.randomUUID()
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{ ...transaction('expense'), internalTransferId: transferId },
				{ id: linkedExpenseId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.transactions,
				{
					...transaction('income'),
					accountId: otherAccountId,
					internalTransferId: transferId
				},
				{ id: linkedIncomeId }
			)
		)
		await fixture.seed((seed) =>
			seed.insert(
				app.internalTransfers,
				{
					organizationId,
					expenseTransactionId: linkedExpenseId,
					incomeTransactionId: linkedIncomeId,
					expenseAccountId: accountId,
					incomeAccountId: otherAccountId,
					amountMinor: 100,
					currency: 'USD'
				},
				{ id: transferId }
			)
		)
		return { transferId, linkedExpenseId, linkedIncomeId }
	}

	async function clearTransferMarkers(
		writer: TestDb,
		linkedExpenseId: string,
		linkedIncomeId: string
	) {
		const write = await writer.transaction((tx) => {
			tx.update(app.transactions, linkedExpenseId, { internalTransferId: null })
			tx.update(app.transactions, linkedIncomeId, { internalTransferId: null })
		})
		await write.wait({ tier: 'global' })
	}

	it('rejects endpoint deletion without that account delete grant', async () => {
		const { linkedIncomeId } = await seedTransferPair()
		await configureMemberDeleteGrants(true, false)
		const linkedExpenseId = (
			await db.one(app.internalTransfers.where({ incomeTransactionId: linkedIncomeId }))
		)?.expenseTransactionId
		if (!linkedExpenseId) throw new Error('Missing seeded transfer expense')
		await clearTransferMarkers(selectedMemberDb, linkedExpenseId, linkedIncomeId)
		await selectedMemberDb.expectDenied((writer) => writer.delete(app.transactions, linkedIncomeId))
		expect(
			(await db.one(app.transactions.where({ id: linkedIncomeId }), { tier: 'remote' }))?.id
		).toBe(linkedIncomeId)
	})
})

const moveCases = [
	{
		label: 'owner',
		role: 'owner',
		mode: 'selected',
		source: 'none',
		target: 'none',
		allowed: true
	},
	{
		label: 'admin',
		role: 'admin',
		mode: 'selected',
		source: 'none',
		target: 'none',
		allowed: true
	},
	{
		label: 'all-account member',
		role: 'member',
		mode: 'all',
		source: 'none',
		target: 'none',
		allowed: true
	},
	{
		label: 'selected member with both writes',
		role: 'member',
		mode: 'selected',
		source: 'write',
		target: 'write',
		allowed: true
	},
	{
		label: 'selected member with only source write',
		role: 'member',
		mode: 'selected',
		source: 'write',
		target: 'none',
		allowed: false
	},
	{
		label: 'selected member with only destination write',
		role: 'member',
		mode: 'selected',
		source: 'none',
		target: 'write',
		allowed: false
	},
	{
		label: 'selected member with source read',
		role: 'member',
		mode: 'selected',
		source: 'read',
		target: 'write',
		allowed: false
	},
	{
		label: 'selected member with destination read',
		role: 'member',
		mode: 'selected',
		source: 'write',
		target: 'read',
		allowed: false
	},
	{
		label: 'selected member with no grants',
		role: 'member',
		mode: 'selected',
		source: 'none',
		target: 'none',
		allowed: false
	},
	{
		label: 'all-account viewer',
		role: 'viewer',
		mode: 'all',
		source: 'write',
		target: 'write',
		allowed: false
	},
	{
		label: 'selected viewer with both grants',
		role: 'viewer',
		mode: 'selected',
		source: 'write',
		target: 'write',
		allowed: false
	},
	{
		label: 'nonmember with orphan grants',
		role: null,
		mode: 'selected',
		source: 'write',
		target: 'write',
		allowed: false
	}
] satisfies {
	label: string
	role: 'owner' | 'admin' | 'member' | 'viewer' | null
	mode: 'all' | 'selected'
	source: 'write' | 'read' | 'none'
	target: 'write' | 'read' | 'none'
	allowed: boolean
}[]

describe.each(['income', 'expense'] satisfies ('income' | 'expense')[])(
	'atomic %s transaction and Check account movement',
	(kind) => {
		it.each(moveCases)('$label', async ({ label, role, mode, source, target, allowed }) => {
			const actorSession = {
				user_id: `check-move-${kind}-${label}`,
				authMode: 'local-first',
				claims: {}
			} satisfies import('jazz-tools/testing').PolicyTestSession
			const writer = fixture.as(actorSession)
			const userId = fixture.accountFor(actorSession)
			if (role !== null)
				await fixture.seed((seed) =>
					seed.insert(app.organizationMembers, {
						organizationId,
						userId,
						role,
						accountAccessMode: mode
					})
				)
			for (const [id, access] of [
				[accountId, source],
				[otherAccountId, target]
			] satisfies [string, 'write' | 'read' | 'none'][]) {
				if (access === 'write' || access === 'read')
					await fixture.seed((seed) =>
						seed.insert(app.accountMemberships, {
							organizationId,
							userId,
							accountId: id,
							access,
							canDelete: false
						})
					)
			}
			const check = await db
				.insert(app.checks, {
					organizationId,
					accountId,
					checkNumber: 'move',
					checkDate: '2026-10-23'
				})
				.wait({ tier: 'global' })
			const row = await db
				.insert(app.transactions, {
					...transaction(kind),
					paymentMethod: 'check',
					checkId: check.id
				})
				.wait({ tier: 'global' })
			const write = await writer.transaction((tx) => {
				tx.update(app.checks, check.id, { accountId: otherAccountId })
				tx.update(app.transactions, row.id, { accountId: otherAccountId })
			})
			if (allowed) await write.wait({ tier: 'global' })
			else await expect(write.wait({ tier: 'global' })).rejects.toThrow()
			const expectedAccountId = allowed ? otherAccountId : accountId
			expect(
				(await db.one(app.checks.where({ id: check.id }), { tier: 'remote' }))?.accountId
			).toBe(expectedAccountId)
			const saved = await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' })
			expect(saved).toMatchObject({ accountId: expectedAccountId, checkId: check.id })
		})

		it.each(['foreign', 'archived', 'invalid-category'])(
			'rejects a %s destination or ledger update without moving either record',
			async (scenario) => {
				const archived =
					scenario === 'archived'
						? await fixture.seed((seed) =>
								seed.insert(app.accounts, {
									organizationId,
									name: 'Archived move target',
									kind: 'cash',
									currency: 'USD',
									archivedAt: new Date()
								})
							)
						: null
				const targetId =
					archived?.id ?? (scenario === 'foreign' ? foreignAccountId : otherAccountId)
				const check = await db
					.insert(app.checks, {
						organizationId,
						accountId,
						checkNumber: 'denied-move',
						checkDate: '2026-10-23'
					})
					.wait({ tier: 'global' })
				const row = await db
					.insert(app.transactions, {
						...transaction(kind),
						paymentMethod: 'check',
						checkId: check.id
					})
					.wait({ tier: 'global' })
				const write = await db.transaction((tx) => {
					tx.update(app.checks, check.id, { accountId: targetId })
					tx.update(app.transactions, row.id, {
						accountId: targetId,
						...(scenario === 'invalid-category' ? { categoryId: crypto.randomUUID() } : {})
					})
				})
				await expect(write.wait({ tier: 'global' })).rejects.toThrow()
				expect(
					(await db.one(app.checks.where({ id: check.id }), { tier: 'remote' }))?.accountId
				).toBe(accountId)
				expect(
					(await db.one(app.transactions.where({ id: row.id }), { tier: 'remote' }))?.accountId
				).toBe(accountId)
			}
		)
	}
)
