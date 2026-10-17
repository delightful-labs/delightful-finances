import { expect, test, type Page } from '@playwright/test'
import type { MergeEntity } from '../src/lib/schema/account-merge-mapping.js'

declare global {
	interface Window {
		mergeOriginTest: {
			db: ReturnType<typeof import('jazz-tools/svelte').getDb>
			app: typeof import('../src/lib/schema.js').app
			userId: string
			organizationId: string
		}
	}
}
async function start(page: Page) {
	await page.goto('/')
	await expect(page.getByLabel('Current workspace', { exact: true })).toBeVisible()
	const organizationId = await page.getByLabel('Current workspace', { exact: true }).inputValue()
	await page.evaluate(async (organizationId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Session is not ready')
		window.mergeOriginTest = {
			db: snapshot.client.db,
			app,
			userId: snapshot.account.id,
			organizationId
		}
	}, organizationId)
}

test('receipts cover every target and remain immutable after target deletion', async ({ page }) => {
	await start(page)
	const result = await page.evaluate(async () => {
		const { db, app, organizationId } = window.mergeOriginTest
		const account = await db
			.insert(app.accounts, { organizationId, name: 'Merge target', kind: 'bank', currency: 'USD' })
			.wait({ tier: 'global' })
		const category = await db
			.insert(app.categories, {
				organizationId,
				name: 'Merge category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const tag = await db
			.insert(app.tags, { organizationId, name: 'Merge tag' })
			.wait({ tier: 'global' })
		const transaction = await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				amountMinor: 100,
				currency: 'USD',
				kind: 'expense',
				bookedOn: '2026-10-17',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		const check = await db
			.insert(app.checkDetails, {
				organizationId,
				accountId: account.id,
				transactionId: crypto.randomUUID(),
				checkNumber: '101',
				checkDate: '2026-10-17'
			})
			.wait({ tier: 'global' })
		const link = await db
			.insert(app.transactionTags, { organizationId, transactionId: transaction.id, tagId: tag.id })
			.wait({ tier: 'global' })
		const batch = await db
			.insert(app.transactionBatches, { organizationId, name: 'Merge batch' })
			.wait({ tier: 'global' })
		const template = await db
			.insert(app.batchTemplates, { organizationId, name: 'Merge template' })
			.wait({ tier: 'global' })
		const targets: Record<MergeEntity, string> = {
			accounts: account.id,
			categories: category.id,
			tags: tag.id,
			transactions: transaction.id,
			checkDetails: check.id,
			transactionTags: link.id,
			transactionBatches: batch.id,
			batchTemplates: template.id
		}
		const receiptIds: string[] = []
		for (const [sourceEntity, destinationRecordId] of Object.entries(targets)) {
			const entityPath = '/src/lib/validation/account-merge-origins.ts'
			const { mergeEntitySchema }: typeof import('../src/lib/validation/account-merge-origins.js') =
				await import(entityPath)
			const row = await db
				.insert(app.mergeOrigins, {
					organizationId,
					sourceOrganizationId: crypto.randomUUID(),
					sourceEntity: mergeEntitySchema.parse(sourceEntity),
					sourceRecordId: crypto.randomUUID(),
					destinationRecordId
				})
				.wait({ tier: 'global' })
			receiptIds.push(row.id)
		}
		const firstId = receiptIds[0]
		if (!firstId) throw new Error('Missing receipt')
		const denied: string[] = []
		for (const operation of [
			() =>
				db
					.update(app.mergeOrigins, firstId, { sourceRecordId: crypto.randomUUID() })
					.wait({ tier: 'global' }),
			() => db.delete(app.mergeOrigins, firstId).wait({ tier: 'global' })
		]) {
			try {
				await operation()
				denied.push('accepted')
			} catch (error) {
				denied.push(error instanceof Error ? error.message : 'unknown')
			}
		}
		await db
			.update(app.batchTemplates, template.id, { name: 'Edited target' })
			.wait({ tier: 'global' })
		await db.delete(app.batchTemplates, template.id).wait({ tier: 'global' })
		const rows = await db.all(app.mergeOrigins.where({ organizationId }), { tier: 'remote' })
		return {
			count: rows.filter((row) => receiptIds.includes(row.id)).length,
			denied,
			retained: rows.some((row) => row.destinationRecordId === template.id)
		}
	})
	expect(result.count).toBe(8)
	expect(result.retained).toBe(true)
	for (const error of result.denied) expect(error).toMatch(/AuthorizationDenied|permission_denied/)
})

test('rejects missing, wrong-table and cross-organization destinations and business receipts', async ({
	page
}) => {
	await start(page)
	const errors = await page.evaluate(async () => {
		const { db, app, userId, organizationId } = window.mergeOriginTest
		const other = await db
			.insert(app.organizations, {
				name: 'Other scope',
				kind: 'business',
				ownerId: userId,
				defaultCurrency: 'USD'
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
		const tag = await db
			.insert(app.tags, { organizationId, name: 'Wrong table' })
			.wait({ tier: 'global' })
		const account = await db
			.insert(app.accounts, {
				organizationId: other.id,
				name: 'Other account',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const errors: string[] = []
		for (const target of [
			{ organizationId, destinationRecordId: crypto.randomUUID() },
			{ organizationId, destinationRecordId: tag.id },
			{ organizationId, destinationRecordId: account.id },
			{ organizationId: other.id, destinationRecordId: account.id }
		]) {
			try {
				await db
					.insert(app.mergeOrigins, {
						...target,
						sourceEntity: 'accounts',
						sourceOrganizationId: crypto.randomUUID(),
						sourceRecordId: crypto.randomUUID()
					})
					.wait({ tier: 'global' })
				errors.push('accepted')
			} catch (error) {
				errors.push(error instanceof Error ? error.message : 'unknown')
			}
		}
		return errors
	})
	expect(errors).toHaveLength(4)
	for (const error of errors) expect(error).toMatch(/AuthorizationDenied|permission_denied/)
})

for (const role of ['admin', 'member', 'viewer', 'unrelated']) {
	test(`provenance access for ${role}`, async ({ page, browser }) => {
		await start(page)
		const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5180' })
		try {
			const subject = await context.newPage()
			await start(subject)
			const userId = await subject.evaluate(() => window.mergeOriginTest.userId)
			const fixture = await page.evaluate(
				async ({ userId, role }) => {
					const { db, app, organizationId } = window.mergeOriginTest
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Role target',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					const receipt = await db
						.insert(app.mergeOrigins, {
							organizationId,
							sourceEntity: 'accounts',
							sourceOrganizationId: crypto.randomUUID(),
							sourceRecordId: crypto.randomUUID(),
							destinationRecordId: account.id
						})
						.wait({ tier: 'global' })
					if (role === 'admin' || role === 'member' || role === 'viewer')
						await db
							.insert(app.organizationMembers, {
								organizationId,
								userId,
								role,
								accountAccessMode: 'all'
							})
							.wait({ tier: 'global' })
					return { organizationId, destinationRecordId: account.id, receiptId: receipt.id }
				},
				{ userId, role }
			)
			const result = await subject.evaluate(async (fixture) => {
				const { db, app } = window.mergeOriginTest
				const rows = await db.all(
					app.mergeOrigins.where({ organizationId: fixture.organizationId }),
					{ tier: 'remote' }
				)
				let insert = 'accepted'
				try {
					await db
						.insert(app.mergeOrigins, {
							organizationId: fixture.organizationId,
							destinationRecordId: fixture.destinationRecordId,
							sourceEntity: 'accounts',
							sourceOrganizationId: crypto.randomUUID(),
							sourceRecordId: crypto.randomUUID()
						})
						.wait({ tier: 'global' })
				} catch (error) {
					insert = error instanceof Error ? error.message : 'unknown'
				}
				return { read: rows.some((row) => row.id === fixture.receiptId), insert }
			}, fixture)
			expect(result.read).toBe(role === 'admin')
			expect(result.insert).toMatch(/AuthorizationDenied|permission_denied/)
		} finally {
			await context.close()
		}
	})
}
