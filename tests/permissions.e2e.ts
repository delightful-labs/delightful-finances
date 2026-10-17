import { prepareSidebar } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'
import type { OrganizationMember } from '../src/lib/schema.js'

declare global {
	interface Window {
		workspacePermissionTest: {
			db: ReturnType<typeof import('jazz-tools/svelte').getDb>
			app: typeof import('../src/lib/schema.js').app
			userId: string
		}
	}
}
type Role = NonNullable<OrganizationMember['role']>
type Mode = OrganizationMember['accountAccessMode']

const scenarios: {
	name: string
	role?: Role
	mode: Mode
	grant?: 'read' | 'write'
	read: boolean
	write: boolean
	all: boolean
}[] = [
	{ name: 'unrelated user', mode: 'selected', read: false, write: false, all: false },
	{ name: 'admin', role: 'admin', mode: 'selected', read: true, write: true, all: true },
	{
		name: 'member with all access',
		role: 'member',
		mode: 'all',
		read: true,
		write: true,
		all: true
	},
	{
		name: 'viewer with all access',
		role: 'viewer',
		mode: 'all',
		read: true,
		write: false,
		all: true
	},
	{
		name: 'member with no grants',
		role: 'member',
		mode: 'selected',
		read: false,
		write: false,
		all: false
	},
	{
		name: 'member with a read grant',
		role: 'member',
		mode: 'selected',
		grant: 'read',
		read: true,
		write: false,
		all: false
	},
	{
		name: 'member with a write grant',
		role: 'member',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: true,
		all: false
	},
	{
		name: 'viewer with a write grant',
		role: 'viewer',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: false,
		all: false
	},
	{
		name: 'grant without membership',
		mode: 'selected',
		grant: 'write',
		read: false,
		write: false,
		all: false
	}
]

async function start(page: Page) {
	await page.goto('/')
	await expect(page.getByRole('complementary').getByRole('navigation')).toBeVisible()
	await prepareSidebar(page)
	await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account)
			throw new Error('Test database session is not ready.')
		window.workspacePermissionTest = { db: snapshot.client.db, app, userId: snapshot.account.id }
	})
}

test('cannot move a category into an unrelated workspace', async ({ page, browser }) => {
	await start(page)
	const targetOrganizationId = await page
		.getByLabel('Current workspace', { exact: true })
		.inputValue()
	const subjectContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
	try {
		const subject = await subjectContext.newPage()
		await start(subject)
		const organizationId = await subject
			.getByLabel('Current workspace', { exact: true })
			.inputValue()
		const outcome = await subject.evaluate(
			async ({ organizationId, targetOrganizationId }) => {
				const { app, db } = window.workspacePermissionTest
				const category = await db
					.insert(app.categories, {
						organizationId,
						name: 'Category boundary fixture',
						kind: 'expense',
						isSystem: false
					})
					.wait({ tier: 'global' })
				try {
					await db
						.update(app.categories, category.id, { organizationId: targetOrganizationId })
						.wait({ tier: 'global' })
					return 'accepted'
				} catch (error) {
					return error instanceof Error ? error.message : 'unknown-error'
				}
			},
			{ organizationId, targetOrganizationId }
		)
		expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
		const injected = await page.evaluate(async (organizationId) => {
			const { app, db } = window.workspacePermissionTest
			return db.all(app.categories.where({ organizationId, name: 'Category boundary fixture' }), {
				tier: 'remote'
			})
		}, targetOrganizationId)
		expect(injected).toHaveLength(0)
	} finally {
		await subjectContext.close()
	}
})

for (const scenario of scenarios) {
	test(`workspace access: ${scenario.name}`, async ({ page, browser }) => {
		await start(page)
		const subjectContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
		try {
			const subject = await subjectContext.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspacePermissionTest.userId)
			if (!subjectId) throw new Error('Test identity is missing.')
			const organizationId = await page
				.getByLabel('Current workspace', { exact: true })
				.inputValue()
			const fixture = await page.evaluate(
				async ({ organizationId, subjectId, role, mode, grant }) => {
					const { app, db } = window.workspacePermissionTest
					const first = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Shared checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const second = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Other checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const category = await db.one(
						app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
						{ tier: 'remote' }
					)
					if (!category) throw new Error('Test expense category is missing.')
					const transaction = await db
						.insert(app.transactions, {
							organizationId,
							accountId: first.id,
							categoryId: category.id,
							kind: 'expense',
							amountMinor: 100,
							currency: 'USD',
							bookedOn: '2026-10-13',
							source: 'manual',
							memo: 'Shared expense'
						})
						.wait({ tier: 'global' })
					const connection = await db
						.insert(app.simplefinConnections, {
							organizationId,
							accessUrl: '',
							ownerId: window.workspacePermissionTest.userId,
							credentialVersion: 1,
							credentialId: 'dGVzdA',
							prfSalt: 'dGVzdA',
							iv: 'dGVzdA',
							ciphertext: 'dGVzdA',
							status: 'active',
							claimedAt: new Date()
						})
						.wait({ tier: 'global' })
					if (role)
						await db
							.insert(app.organizationMembers, {
								organizationId,
								userId: subjectId,
								role,
								accountAccessMode: mode
							})
							.wait({ tier: 'global' })
					if (grant)
						await db
							.insert(app.accountMemberships, {
								organizationId,
								accountId: first.id,
								userId: subjectId,
								access: grant
							})
							.wait({ tier: 'global' })
					return {
						firstId: first.id,
						secondId: second.id,
						transactionId: transaction.id,
						connectionId: connection.id
					}
				},
				{
					organizationId,
					subjectId,
					role: scenario.role,
					mode: scenario.mode,
					grant: scenario.grant
				}
			)

			const access = await subject.evaluate(
				async ({ organizationId, fixture }) => {
					const { app, db } = window.workspacePermissionTest
					const rows = await db.all(app.accounts.where({ organizationId }), { tier: 'remote' })
					return {
						workspace: Boolean(
							await db.one(app.organizations.where({ id: organizationId }), { tier: 'remote' })
						),
						transaction: Boolean(
							await db.one(app.transactions.where({ id: fixture.transactionId }), {
								tier: 'remote'
							})
						),
						credentialEnvelope: Boolean(
							await db.one(app.simplefinConnections.where({ id: fixture.connectionId }), {
								tier: 'remote'
							})
						),
						rows: rows.map((row) => row.id)
					}
				},
				{ organizationId, fixture }
			)
			expect(access.workspace).toBe(Boolean(scenario.role))
			expect(access.transaction).toBe(scenario.read)
			expect(access.credentialEnvelope).toBe(scenario.role === 'admin')
			expect(access.rows.sort()).toEqual(
				(scenario.all
					? [fixture.firstId, fixture.secondId]
					: scenario.read
						? [fixture.firstId]
						: []
				).sort()
			)

			const outcome = await subject.evaluate(
				async ({ id, organizationId, read }) => {
					const { app, db } = window.workspacePermissionTest
					try {
						if (read) {
							await db
								.update(app.accounts, id, { name: 'Changed by subject' })
								.wait({ tier: 'global' })
						} else {
							await db
								.insert(app.accounts, {
									organizationId,
									name: 'Forbidden account',
									kind: 'bank',
									currency: 'USD'
								})
								.wait({ tier: 'global' })
						}
						return 'accepted'
					} catch (error) {
						return error instanceof Error ? error.message : 'unknown-error'
					}
				},
				{ id: fixture.firstId, organizationId, read: scenario.read }
			)
			if (scenario.write) expect(outcome).toBe('accepted')
			else expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			const savedName = await page.evaluate(async (id) => {
				const { app, db } = window.workspacePermissionTest
				return (await db.one(app.accounts.where({ id }), { tier: 'remote' }))?.name
			}, fixture.firstId)
			expect(savedName).toBe(scenario.write ? 'Changed by subject' : 'Shared checking')
			const savedAccounts = await page.evaluate(async (organizationId) => {
				const { app, db } = window.workspacePermissionTest
				return (await db.all(app.accounts.where({ organizationId }), { tier: 'remote' })).length
			}, organizationId)
			expect(savedAccounts).toBe(2)
		} finally {
			await subjectContext.close()
		}
	})
}

test('transaction tags enforce workspace consistency, active assignment, immutable links, and archived history', async ({
	page
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Current workspace', { exact: true }).inputValue()
	const result = await page.evaluate(async (organizationId) => {
		const { app, db, userId } = window.workspacePermissionTest
		const category = await db.one(
			app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
			{ tier: 'remote' }
		)
		if (!category) throw new Error('No expense category')
		const account = await db
			.insert(app.accounts, {
				organizationId,
				name: 'Tag permission account',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const tag = await db
			.insert(app.tags, { organizationId, name: 'Active permission tag' })
			.wait({ tier: 'global' })
		const other = await db
			.insert(app.organizations, {
				name: 'Other tag workspace',
				kind: 'business',
				defaultCurrency: 'USD',
				ownerId: userId
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: other.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		const foreignTag = await db
			.insert(app.tags, { organizationId: other.id, name: 'Foreign tag' })
			.wait({ tier: 'global' })
		// The transaction and assignment must be accepted together, in either write order.
		const tx = await db.transaction((tx) => {
			const transaction = tx.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-13',
				source: 'manual'
			})
			const link = tx.insert(app.transactionTags, {
				organizationId,
				transactionId: transaction.id,
				tagId: tag.id
			})
			return { transactionId: transaction.id, linkId: link.id }
		})
		const fixture = await tx.wait({ tier: 'global' })
		const outcomes: string[] = []
		async function insertLink(workspaceId: string, transactionId: string, tagId: string) {
			try {
				await db
					.insert(app.transactionTags, { organizationId: workspaceId, transactionId, tagId })
					.wait({ tier: 'global' })
				return 'accepted'
			} catch (error) {
				return error instanceof Error ? error.message : 'unknown-error'
			}
		}
		outcomes.push(await insertLink(organizationId, fixture.transactionId, foreignTag.id))
		outcomes.push(await insertLink(other.id, fixture.transactionId, foreignTag.id))
		outcomes.push(await insertLink(organizationId, crypto.randomUUID(), tag.id))
		outcomes.push(await insertLink(organizationId, fixture.transactionId, crypto.randomUUID()))
		try {
			await db
				.update(app.transactionTags, fixture.linkId, { tagId: foreignTag.id })
				.wait({ tier: 'global' })
			outcomes.push('accepted')
		} catch (error) {
			outcomes.push(error instanceof Error ? error.message : 'unknown-error')
		}
		await db.update(app.tags, tag.id, { archivedAt: new Date() }).wait({ tier: 'global' })
		outcomes.push(await insertLink(organizationId, fixture.transactionId, tag.id))
		const historical = await db.one(app.transactionTags.where({ id: fixture.linkId }), {
			tier: 'remote'
		})
		await db.delete(app.transactionTags, fixture.linkId).wait({ tier: 'global' })
		const removed = await db.one(app.transactionTags.where({ id: fixture.linkId }), {
			tier: 'remote'
		})
		return { outcomes, retained: historical?.tagId === tag.id, removed: !removed }
	}, organizationId)
	expect(result.outcomes).toHaveLength(6)
	for (const outcome of result.outcomes)
		expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
	expect(result.retained).toBe(true)
	expect(result.removed).toBe(true)
})

for (const scenario of scenarios) {
	test(`transaction tag permissions: ${scenario.name}`, async ({ page, browser }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current workspace', { exact: true }).inputValue()
		const subjectContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
		try {
			const subject = await subjectContext.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspacePermissionTest.userId)
			const fixture = await page.evaluate(
				async ({ organizationId, subjectId, role, mode, grant }) => {
					const { app, db } = window.workspacePermissionTest
					if (role)
						await db
							.insert(app.organizationMembers, {
								organizationId,
								userId: subjectId,
								role,
								accountAccessMode: mode
							})
							.wait({ tier: 'global' })
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Tag shared account',
							kind: 'cash',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					if (grant)
						await db
							.insert(app.accountMemberships, {
								organizationId,
								userId: subjectId,
								accountId: account.id,
								access: grant
							})
							.wait({ tier: 'global' })
					const category = await db.one(
						app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
						{ tier: 'remote' }
					)
					if (!category) throw new Error('No expense category')
					const transaction = await db
						.insert(app.transactions, {
							organizationId,
							accountId: account.id,
							categoryId: category.id,
							kind: 'expense',
							amountMinor: 100,
							currency: 'USD',
							bookedOn: '2026-10-13',
							source: 'manual'
						})
						.wait({ tier: 'global' })
					const tag = await db
						.insert(app.tags, { organizationId, name: 'Tag shared assignment' })
						.wait({ tier: 'global' })
					const link = await db
						.insert(app.transactionTags, {
							organizationId,
							transactionId: transaction.id,
							tagId: tag.id
						})
						.wait({ tier: 'global' })
					return { transactionId: transaction.id, tagId: tag.id, linkId: link.id }
				},
				{
					organizationId,
					subjectId,
					role: scenario.role,
					mode: scenario.mode,
					grant: scenario.grant
				}
			)
			const access = await subject.evaluate(
				async ({ organizationId, fixture }) => {
					const { app, db } = window.workspacePermissionTest
					const read = Boolean(
						await db.one(app.transactionTags.where({ id: fixture.linkId }), { tier: 'remote' })
					)
					let insert = 'accepted'
					try {
						await db
							.insert(app.transactionTags, {
								organizationId,
								transactionId: fixture.transactionId,
								tagId: fixture.tagId
							})
							.wait({ tier: 'global' })
					} catch (error) {
						insert = error instanceof Error ? error.message : 'unknown-error'
					}
					let remove = 'accepted'
					try {
						await db.delete(app.transactionTags, fixture.linkId).wait({ tier: 'global' })
					} catch (error) {
						remove = error instanceof Error ? error.message : 'unknown-error'
					}
					return { read, insert, remove }
				},
				{ organizationId, fixture }
			)
			expect(access.read).toBe(scenario.read)
			if (scenario.write) {
				expect(access.insert).toBe('accepted')
				expect(access.remove).toBe('accepted')
			} else {
				expect(access.insert).toMatch(/AuthorizationDenied|permission_denied/)
				expect(access.remove).toMatch(/AuthorizationDenied|permission_denied/)
			}
			const retained = await page.evaluate(async (id) => {
				const { app, db } = window.workspacePermissionTest
				return Boolean(await db.one(app.transactionTags.where({ id }), { tier: 'remote' }))
			}, fixture.linkId)
			expect(retained).toBe(!scenario.write)
		} finally {
			await subjectContext.close()
		}
	})
}

test('check detail references enforce initial integrity, edits, and single selection', async ({
	page
}) => {
	await start(page)
	const result = await page.evaluate(async () => {
		const { app, db, userId } = window.workspacePermissionTest
		const organization = await db.one(app.organizations.where({ ownerId: userId }), {
			tier: 'remote'
		})
		if (!organization) throw new Error('Missing workspace')
		const category = await db.one(
			app.categories.where({ organizationId: organization.id, kind: 'income', isSystem: true }),
			{ tier: 'remote' }
		)
		if (!category) throw new Error('Missing category')
		const account = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Check integrity',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const transactionValues = {
			organizationId: organization.id,
			accountId: account.id,
			categoryId: category.id,
			kind: 'income',
			amountMinor: 100,
			currency: 'USD',
			bookedOn: '2026-10-14',
			paymentMethod: 'check',
			source: 'manual'
		} satisfies import('jazz-tools').schema.InsertOf<typeof app.transactions>
		const insertCheck = async () => {
			const id = crypto.randomUUID()
			const write = await db.transaction((tx) => {
				tx.insert(
					app.checkDetails,
					{
						transactionId: id,
						organizationId: organization.id,
						accountId: account.id,
						checkNumber: '123',
						checkDate: '2026-10-14'
					},
					{ id }
				)
				tx.insert(app.transactions, { ...transactionValues, checkDetailsId: id }, { id })
				return id
			})
			return write.wait({ tier: 'global' })
		}
		const first = await insertCheck()
		const second = await insertCheck()
		await db.one(app.checkDetails.where({ id: first }), { tier: 'remote' })
		const attempt = async (write: () => Promise<unknown>) => {
			try {
				await write()
				return 'accepted'
			} catch (error) {
				return error instanceof Error ? error.message : 'rejected'
			}
		}
		const missingReference = await attempt(() =>
			db.insert(app.transactions, transactionValues).wait({ tier: 'global' })
		)
		const nonCheckReference = await attempt(() =>
			db
				.insert(app.transactions, {
					...transactionValues,
					paymentMethod: 'cash',
					checkDetailsId: first
				})
				.wait({ tier: 'global' })
		)
		const invalidDate = { checkDate: '2026-10-14' }
		Reflect.set(invalidDate, 'checkDate', null)
		const missingDate = await attempt(() =>
			db.update(app.checkDetails, first, invalidDate).wait({ tier: 'global' })
		)
		await db
			.update(app.checkDetails, first, { checkNumber: '456', checkDate: '2026-10-15' })
			.wait({ tier: 'global' })
		const reassignment = await attempt(() =>
			db.update(app.checkDetails, first, { transactionId: second }).wait({ tier: 'global' })
		)
		await db.one(app.transactions.where({ id: first }), { tier: 'remote' })
		const replacement = await attempt(() =>
			db.update(app.transactions, first, { checkDetailsId: second }).wait({ tier: 'global' })
		)
		const deletion = await attempt(() =>
			db.delete(app.checkDetails, first).wait({ tier: 'global' })
		)
		const duplicates = await Promise.all(
			['A', 'B'].map((checkNumber) =>
				attempt(() =>
					db
						.insert(app.checkDetails, {
							transactionId: first,
							organizationId: organization.id,
							accountId: account.id,
							checkNumber,
							checkDate: '2026-10-14'
						})
						.wait({ tier: 'global' })
				)
			)
		)
		const initialFailures: string[] = []
		initialFailures.push(
			await attempt(() =>
				db
					.insert(app.transactions, { ...transactionValues, checkDetailsId: crypto.randomUUID() })
					.wait({ tier: 'global' })
			)
		)
		initialFailures.push(
			await attempt(() =>
				db
					.insert(app.transactions, { ...transactionValues, checkDetailsId: first })
					.wait({ tier: 'global' })
			)
		)
		const otherAccount = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Other ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const wrongAccountId = crypto.randomUUID()
		await db
			.insert(
				app.checkDetails,
				{
					transactionId: wrongAccountId,
					organizationId: organization.id,
					accountId: otherAccount.id,
					checkNumber: 'other',
					checkDate: '2026-10-15'
				},
				{ id: wrongAccountId }
			)
			.wait({ tier: 'global' })
		initialFailures.push(
			await attempt(() =>
				db
					.insert(
						app.transactions,
						{ ...transactionValues, checkDetailsId: wrongAccountId },
						{ id: wrongAccountId }
					)
					.wait({ tier: 'global' })
			)
		)
		await db
			.update(app.accounts, otherAccount.id, { archivedAt: new Date() })
			.wait({ tier: 'global' })
		initialFailures.push(
			await attempt(() =>
				db
					.insert(app.checkDetails, {
						transactionId: crypto.randomUUID(),
						organizationId: organization.id,
						accountId: otherAccount.id,
						checkNumber: 'archived account',
						checkDate: '2026-10-15'
					})
					.wait({ tier: 'global' })
			)
		)

		const otherOrg = await db
			.insert(app.organizations, {
				name: 'Other workspace',
				kind: 'business',
				ownerId: userId,
				defaultCurrency: 'USD'
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: otherOrg.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		const orgAccount = await db
			.insert(app.accounts, {
				organizationId: otherOrg.id,
				name: 'Other workspace ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		initialFailures.push(
			await attempt(() =>
				db
					.insert(app.checkDetails, {
						transactionId: crypto.randomUUID(),
						organizationId: otherOrg.id,
						accountId: account.id,
						checkNumber: 'wrong workspace',
						checkDate: '2026-10-15'
					})
					.wait({ tier: 'global' })
			)
		)

		const wrongOrgId = crypto.randomUUID()
		await db
			.insert(
				app.checkDetails,
				{
					transactionId: wrongOrgId,
					organizationId: otherOrg.id,
					accountId: orgAccount.id,
					checkNumber: 'other workspace',
					checkDate: '2026-10-15'
				},
				{ id: wrongOrgId }
			)
			.wait({ tier: 'global' })
		initialFailures.push(
			await attempt(() =>
				db
					.insert(
						app.transactions,
						{ ...transactionValues, checkDetailsId: wrongOrgId },
						{ id: wrongOrgId }
					)
					.wait({ tier: 'global' })
			)
		)
		const rollbackId = crypto.randomUUID()
		const rollback = await attempt(async () => {
			const write = await db.transaction((tx) => {
				tx.insert(
					app.checkDetails,
					{
						transactionId: rollbackId,
						organizationId: organization.id,
						accountId: account.id,
						checkNumber: 'rollback',
						checkDate: '2026-10-15'
					},
					{ id: rollbackId }
				)
				tx.insert(
					app.transactions,
					{ ...transactionValues, checkDetailsId: rollbackId, currency: 'EUR' },
					{ id: rollbackId }
				)
			})
			await write.wait({ tier: 'global' })
		})
		const rolledBackDetail = await db.one(app.checkDetails.where({ id: rollbackId }), {
			tier: 'remote'
		})
		const rolledBackTransaction = await db.one(app.transactions.where({ id: rollbackId }), {
			tier: 'remote'
		})

		const candidates = await db.all(app.checkDetails.where({ transactionId: first }), {
			tier: 'remote'
		})
		const competingSelections = await Promise.all(
			candidates
				.filter((detail) => detail.id !== first)
				.map((detail) =>
					attempt(() =>
						db
							.update(app.transactions, first, { checkDetailsId: detail.id })
							.wait({ tier: 'global' })
					)
				)
		)
		const sharedReferenceRace = await Promise.all(
			[1, 2].map(() =>
				attempt(() =>
					db
						.insert(app.transactions, { ...transactionValues, checkDetailsId: first })
						.wait({ tier: 'global' })
				)
			)
		)

		const retained = await db.one(
			app.transactions.where({ id: first }).include({ checkDetails: true }),
			{ tier: 'remote' }
		)
		const rows = await db.all(app.checkDetails.where({ transactionId: first }), { tier: 'remote' })
		return {
			competingSelections,
			sharedReferenceRace,
			initialFailures,
			rollback,
			rollbackEmpty: !rolledBackDetail && !rolledBackTransaction,
			missingReference,
			nonCheckReference,
			missingDate,
			reassignment,
			replacement,
			deletion,
			duplicates,
			rowCount: rows.length,
			selectedId: retained?.checkDetailsId,
			first,
			details: retained?.checkDetails
		}
	})
	for (const outcome of [
		...result.sharedReferenceRace,
		...result.initialFailures,
		result.rollback,
		result.missingReference,
		result.nonCheckReference,
		result.reassignment,
		result.replacement,
		result.deletion
	])
		expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
	for (const outcome of result.competingSelections)
		expect(outcome).toMatch(/AuthorizationDenied|permission_denied|cascade_rejected/)
	expect(
		result.competingSelections.some((outcome) =>
			/AuthorizationDenied|permission_denied/.test(outcome)
		)
	).toBe(true)
	expect(result.rollbackEmpty).toBe(true)
	expect(result.missingDate).not.toBe('accepted')
	expect(result.duplicates).toEqual(['accepted', 'accepted'])
	expect(result.rowCount).toBe(3)
	expect(result.selectedId).toBe(result.first)
	expect(result.details).toMatchObject({
		id: result.first,
		transactionId: result.first,
		checkNumber: '456',
		checkDate: '2026-10-15'
	})
})

for (const scenario of scenarios) {
	test(`check detail access: ${scenario.name}`, async ({ page, browser }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current workspace', { exact: true }).inputValue()
		const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
		try {
			const subject = await context.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspacePermissionTest.userId)
			const fixture = await page.evaluate(
				async ({ organizationId, subjectId, scenario }) => {
					const { app, db } = window.workspacePermissionTest
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Check grants',
							kind: 'cash',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const category = await db.one(
						app.categories.where({ organizationId, kind: 'income', isSystem: true }),
						{ tier: 'remote' }
					)
					if (!category) throw new Error('Missing income category')
					const id = crypto.randomUUID()
					const write = await db.transaction((tx) => {
						tx.insert(
							app.checkDetails,
							{
								organizationId,
								accountId: account.id,
								transactionId: id,
								checkNumber: 'owner check',
								checkDate: '2026-10-15'
							},
							{ id }
						)
						tx.insert(
							app.transactions,
							{
								organizationId,
								accountId: account.id,
								categoryId: category.id,
								kind: 'income',
								amountMinor: 100,
								currency: 'USD',
								bookedOn: '2026-10-15',
								paymentMethod: 'check',
								source: 'manual',
								checkDetailsId: id
							},
							{ id }
						)
					})
					await write.wait({ tier: 'global' })
					if (scenario.role)
						await db
							.insert(app.organizationMembers, {
								organizationId,
								userId: subjectId,
								role: scenario.role,
								accountAccessMode: scenario.mode
							})
							.wait({ tier: 'global' })
					if (scenario.grant)
						await db
							.insert(app.accountMemberships, {
								organizationId,
								accountId: account.id,
								userId: subjectId,
								access: scenario.grant
							})
							.wait({ tier: 'global' })
					return { id, accountId: account.id }
				},
				{ organizationId, subjectId, scenario }
			)
			const outcome = await subject.evaluate(
				async ({ fixture, organizationId }) => {
					const { app, db } = window.workspacePermissionTest
					const row = await db.one(app.checkDetails.where({ id: fixture.id }), { tier: 'remote' })
					let insert = 'accepted',
						edit = 'accepted'
					try {
						await db
							.insert(app.checkDetails, {
								organizationId,
								accountId: fixture.accountId,
								transactionId: crypto.randomUUID(),
								checkNumber: 'candidate',
								checkDate: '2026-10-15'
							})
							.wait({ tier: 'global' })
					} catch (error) {
						insert = error instanceof Error ? error.message : 'rejected'
					}
					try {
						await db
							.upsert(app.checkDetails, fixture.id, {
								organizationId,
								accountId: fixture.accountId,
								transactionId: fixture.id,
								checkNumber: 'member edit',
								checkDate: '2026-10-16'
							})
							.wait({ tier: 'global' })
					} catch (error) {
						edit = error instanceof Error ? error.message : 'rejected'
					}
					return { readable: Boolean(row), insert, edit }
				},
				{ fixture, organizationId }
			)
			expect(outcome.readable).toBe(scenario.read)
			for (const result of [outcome.insert, outcome.edit]) {
				if (scenario.write) expect(result).toBe('accepted')
				else expect(result).toMatch(/AuthorizationDenied|permission_denied/)
			}
			const retained = await page.evaluate(async (id) => {
				const { app, db } = window.workspacePermissionTest
				return (await db.one(app.checkDetails.where({ id }), { tier: 'remote' }))?.checkNumber
			}, fixture.id)
			expect(retained).toBe(scenario.write ? 'member edit' : 'owner check')
		} finally {
			await context.close()
		}
	})
}
