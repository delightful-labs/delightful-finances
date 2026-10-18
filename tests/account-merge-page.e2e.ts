import { expect, test, type Page } from '@playwright/test'
import { prepareSidebar } from './helpers/ui.js'

declare global {
	interface Window {
		mergePageTest: {
			db: ReturnType<typeof import('jazz-tools/svelte').getDb>
			app: typeof import('../src/lib/schema.js').app
			userId: string
			organizationId: string
			authority: { table: string; tier: string }[]
			mutations: string[]
			active: Set<number>
		}
	}
}
async function start(page: Page) {
	await page.goto('/account-merge')
	await expect(
		page.getByRole('button', { name: 'Check this workspace', exact: true })
	).toBeVisible()
	await prepareSidebar(page)
	const organizationId = await page.getByLabel('Current workspace', { exact: true }).inputValue()
	await page.evaluate(async (organizationId) => {
		const sessionPath = '/src/lib/jazz-session.ts'
		const schemaPath = '/src/lib/schema.ts'
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const session = getCurrentJazzSession()?.getSnapshot()
		if (!session?.client || !session.account) throw new Error('Session not ready')
		const db = session.client.db
		await db.all(app.organizations.where({ id: organizationId }), { tier: 'remote' })
		const state = {
			db,
			app,
			organizationId,
			userId: session.account.id,
			authority: [],
			mutations: [],
			active: new Set<number>()
		} satisfies Window['mergePageTest']
		window.mergePageTest = state
		const subscribe = db.subscribe.bind(db)
		let nextId = 0
		db.subscribe = (query, callbacks, options, readSession) => {
			const subscriptionId = nextId++
			if (options?.tier === 'remote') {
				const description: unknown = JSON.parse(query._build())
				const table =
					typeof description === 'object' &&
					description !== null &&
					'table' in description &&
					typeof description.table === 'string'
						? description.table
						: 'unknown'
				window.mergePageTest.authority.push({ table, tier: options.tier })
				window.mergePageTest.active.add(subscriptionId)
			}
			const unsubscribe = subscribe(query, callbacks, options, readSession)
			return () => {
				window.mergePageTest.active.delete(subscriptionId)
				unsubscribe()
			}
		}
	}, organizationId)
}
async function createBusiness(page: Page) {
	return page.evaluate(async () => {
		const { db, app, userId } = window.mergePageTest
		const row = await db
			.insert(app.organizations, {
				name: 'Merge test business',
				kind: 'business',
				ownerId: userId,
				defaultCurrency: 'USD'
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: row.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		return row.id
	})
}

async function activeAuthority(page: Page) {
	return page.evaluate(() => window.mergePageTest.active.size)
}

async function gateServer(page: Page) {
	let held = false
	await page.routeWebSocket(/.*/, (socket) => {
		const server = socket.connectToServer()
		server.onMessage((message) => {
			if (!held) socket.send(message)
		})
	})
	return {
		hold: () => {
			held = true
		},
		release: () => {
			held = false
		}
	}
}

test('isolated route performs an explicit remote destination check without mutations or provider calls', async ({
	page
}) => {
	const providerRequests: string[] = []
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.route(/\/api\/simplefin|https:\/\/[^/]*simplefin\.org\//, (route) => {
		providerRequests.push(route.request().url())
		return route.abort()
	})
	await start(page)
	await expect(page.getByRole('button', { name: 'Merge local data', exact: true })).toBeDisabled()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveCount(0)
	expect(await activeAuthority(page)).toBe(0)
	await page.evaluate(() => {
		const { db, mutations } = window.mergePageTest
		db.insert = () => {
			mutations.push('insert')
			throw new Error('Unexpected mutation')
		}
		db.update = () => {
			mutations.push('update')
			throw new Error('Unexpected mutation')
		}
		db.delete = () => {
			mutations.push('delete')
			throw new Error('Unexpected mutation')
		}
	})
	await page.getByRole('button', { name: 'Check this workspace', exact: true }).click()
	await expect(
		page.getByRole('status').filter({ hasText: 'This is your personal workspace' })
	).toBeVisible()
	await expect.poll(() => activeAuthority(page)).toBe(0)
	await page.getByRole('button', { name: 'Check again', exact: true }).click()
	await expect(
		page.getByRole('status').filter({ hasText: 'This is your personal workspace' })
	).toBeVisible()
	await expect.poll(() => activeAuthority(page)).toBe(0)
	const result = await page.evaluate(() => ({
		authority: window.mergePageTest.authority,
		mutations: window.mergePageTest.mutations
	}))
	expect(new Set(result.authority.map((row) => row.table))).toEqual(
		new Set(['organizations', 'organizationMembers'])
	)
	expect(result.authority.every((row) => row.tier === 'remote')).toBe(true)
	expect(result.authority).toHaveLength(4)
	expect(result.mutations).toEqual([])
	expect(providerRequests).toEqual([])
	expect(errors).toEqual([])
})

test('rejects a business destination and keeps existing sign-in separate', async ({ page }) => {
	await start(page)
	const businessId = await createBusiness(page)
	const selector = page.getByLabel('Current workspace', { exact: true })
	await expect(selector.locator(`option[value="${businessId}"]`)).toHaveCount(1)
	await selector.selectOption(businessId)
	await page.getByRole('button', { name: 'Check this workspace', exact: true }).click()
	await expect(
		page.getByRole('alert').filter({ hasText: 'Choose a personal workspace that you own' })
	).toBeVisible()
	await expect.poll(() => activeAuthority(page)).toBe(0)
	await page.goto('/login')
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Account merge', exact: true })).toHaveCount(0)
})

test('cached local data cannot complete a held remote check; cancellation retires both reads', async ({
	page
}) => {
	const gate = await gateServer(page)
	await start(page)
	gate.hold()
	await page.getByRole('button', { name: 'Check this workspace', exact: true }).click()
	await expect(
		page.getByRole('status').filter({ hasText: 'Checking the destination workspace' })
	).toBeVisible()
	await expect.poll(() => activeAuthority(page)).toBe(2)
	await expect(
		page.getByRole('status').filter({ hasText: 'This is your personal workspace' })
	).toHaveCount(0)
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(
		page.getByRole('button', { name: 'Check this workspace', exact: true })
	).toBeVisible()
	await expect.poll(() => activeAuthority(page)).toBe(0)
	gate.release()
})

test('navigation retires pending destination subscriptions', async ({ page }) => {
	const gate = await gateServer(page)
	await start(page)
	gate.hold()
	await page.getByRole('button', { name: 'Check this workspace', exact: true }).click()
	await expect.poll(() => activeAuthority(page)).toBe(2)
	await page.getByRole('complementary').getByRole('link', { name: 'Overview', exact: true }).click()
	await expect(page).toHaveURL('/')
	await expect.poll(() => activeAuthority(page)).toBe(0)
	gate.release()
})

test('changing workspace cancels the old check and leaves the new workspace unchecked', async ({
	page
}) => {
	const gate = await gateServer(page)
	await start(page)
	const businessId = await createBusiness(page)
	const selector = page.getByLabel('Current workspace', { exact: true })
	await expect(selector.locator(`option[value="${businessId}"]`)).toHaveCount(1)
	gate.hold()
	await page.getByRole('button', { name: 'Check this workspace', exact: true }).click()
	await expect.poll(() => activeAuthority(page)).toBe(2)
	await selector.selectOption(businessId)
	await expect(
		page.getByRole('button', { name: 'Check this workspace', exact: true })
	).toBeVisible()
	await expect.poll(() => activeAuthority(page)).toBe(0)
	gate.release()
	await expect(
		page.getByRole('status').filter({ hasText: 'This is your personal workspace' })
	).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Merge local data', exact: true })).toBeDisabled()
})
