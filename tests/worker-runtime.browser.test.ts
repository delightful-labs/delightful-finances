import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from '@playwright/test'
import { startTestJazz } from 'jazz-tools/testing'
import { app } from '../src/lib/schema.js'
import permissions from '../src/lib/permissions.js'
import { createSilentJazzProxy } from './helpers/silent-jazz-proxy.js'
import type {} from './worker-runtime/browser.js'

let server: ViteDevServer
let url: string
beforeAll(async () => {
	process.env.FINANCE_PREVIEW = 'true'
	server = await createServer({
		configFile: './vite.config.ts',
		server: {
			host: '0.0.0.0',
			port: 0,
			fs: {
				allow: ['browser.ts', 'image.worker.ts'].map((file) =>
					fileURLToPath(new URL(`./worker-runtime/${file}`, import.meta.url))
				)
			}
		},
		optimizeDeps: { noDiscovery: true },
		plugins: [
			{
				name: 'finance-sdk-worker-harness',
				configureServer(server) {
					server.middlewares.use((request, response, next) => {
						if (request.url === '/favicon.ico') {
							response.statusCode = 204
							response.end()
							return
						}
						if (request.url !== '/__worker_runtime') return next()
						response.setHeader('Content-Type', 'text/html')
						response.end('<script type="module" src="/tests/worker-runtime/browser.ts"></script>')
					})
				}
			}
		]
	})
	await server.listen()
	const base = server.resolvedUrls?.local[0]
	if (!base) throw new Error('Missing worker harness URL')
	url = new URL('/__worker_runtime', base).href
	server.printUrls()
}, 60_000)
afterAll(async () => {
	await server?.close()
})

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	it(`${name}: owns and closes the SDK in a real application worker and reuses its durable identity`, async () => {
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		const context = await browser.newContext()
		const logs: string[] = []
		try {
			const page = await context.newPage()
			page.on('pageerror', (error) => logs.push(error.message))
			page.on('console', (message) => {
				if (message.type() === 'error') logs.push(message.text())
			})
			page.setDefaultTimeout(20_000)
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime, undefined, { polling: 100 })
			const scope = crypto.randomUUID()
			await page.evaluate(
				(scope) => window.financeWorkerRuntime.start('http://127.0.0.1:9/jazz', scope),
				scope
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.session.status === 'ready',
				undefined,
				{ polling: 100 }
			)
			const first = await page.evaluate(() => window.financeWorkerRuntime.view())
			expect(first?.session.identityId).toMatch(/^[a-f\d-]{36}$/i)
			expect(first?.startup.failed).toBe(false)
			await page.evaluate(() => window.financeWorkerRuntime.close())
			expect(await page.evaluate(() => window.financeWorkerRuntime.host())).toBe('closed')
			await page.close()
			const cold = await context.newPage()
			cold.setDefaultTimeout(20_000)
			await cold.goto(url)
			await cold.waitForFunction(() => window.financeWorkerRuntime, undefined, { polling: 100 })
			await cold.evaluate(
				(scope) => window.financeWorkerRuntime.start('http://127.0.0.1:9/jazz', scope),
				scope
			)
			await cold.waitForFunction(
				() => window.financeWorkerRuntime.view()?.session.status === 'ready',
				undefined,
				{ polling: 100 }
			)
			expect(
				await cold.evaluate(() => window.financeWorkerRuntime.view()?.session.identityId)
			).toBe(first?.session.identityId)
			await cold.evaluate(() => window.financeWorkerRuntime.close())
		} catch (error) {
			const views = await Promise.all(
				context.pages().map((page) =>
					page
						.evaluate(() => ({
							view: window.financeWorkerRuntime?.view(),
							host: window.financeWorkerRuntime?.host()
						}))
						.catch(() => null)
				)
			)
			throw new Error(JSON.stringify({ logs, views }), { cause: error })
		} finally {
			await context.close()
			await browser.close()
		}
	}, 60_000)
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	it(`${name}: projects real finance data from the worker after every client closes and the remote stops answering`, async () => {
		const backend = await startTestJazz({
			app,
			permissions,
			jazz: { allowedOrigins: [new URL(url).origin] }
		})
		const proxy = createSilentJazzProxy(backend.url)
		await proxy.listen(0)
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		const context = await browser.newContext()
		const logs: string[] = []
		try {
			let page = await context.newPage()
			page.on('pageerror', (error) => logs.push(error.message))
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime)
			await page.evaluate(
				({ endpoint, scope }) => window.financeWorkerRuntime.start(endpoint, scope),
				{ endpoint: proxy.url, scope: backend.appId }
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.navigation === 'scoped',
				undefined,
				{ timeout: 25_000, polling: 100 }
			)
			const initial = await page.evaluate(() => window.financeWorkerRuntime.view())
			const organizationId = initial?.workspace.organizationId
			if (!organizationId) throw new Error('Missing selected worker workspace')
			const account = await backend.jazz.db
				.insert(app.accounts, {
					organizationId,
					name: 'Worker cash',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'global' })
			const accountId = account.id
			const legacyMemo = 'Legacy memo '.repeat(500) + 'Retained memo tail marker'
			let initialExpenseId: string | undefined
			for (const [kind, amountMinor] of [
				['income', 10501],
				['expense', 234]
			] satisfies ['income' | 'expense', number][]) {
				const category = await backend.jazz.db
					.insert(app.categories, {
						organizationId,
						name: `Worker ${kind}`,
						kind,
						isSystem: false
					})
					.wait({ tier: 'global' })
				const seededTransaction = await backend.jazz.db
					.insert(app.transactions, {
						organizationId,
						accountId,
						categoryId: category.id,
						kind,
						amountMinor,
						currency: 'USD',
						bookedOn: '2026-11-09',
						source: 'manual',
						...(kind === 'expense' ? { memo: legacyMemo } : {})
					})
					.wait({ tier: 'global' })
				if (kind === 'expense') {
					initialExpenseId = seededTransaction.id
					for (let index = 0; index < 30; index++) {
						await backend.jazz.db
							.insert(app.transactions, {
								organizationId,
								accountId,
								categoryId: category.id,
								kind,
								amountMinor: 0,
								currency: 'USD',
								bookedOn: '2026-11-09',
								source: 'manual',
								description: `Ledger row ${index}`
							})
							.wait({ tier: 'global' })
					}
				}
			}
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accounts.find((account) => account.id === id)?.balanceMinor === 10267n,
				accountId,
				{ timeout: 20_000, polling: 100 }
			)

			await page.waitForFunction(() => {
				const report = window.financeWorkerRuntime.view()?.workspace.overview
				return report?.active && !report.loading && !report.failed
			})
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({
					type: 'RANGE',
					start: '2026-11-09',
					end: '2026-11-09'
				})
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.overview.filters.start === '2026-11-09' &&
					window.financeWorkerRuntime.view()?.workspace.overview.preferencesReady &&
					window.financeWorkerRuntime.view()?.workspace.overview.total === 234n
			)
			await page.evaluate(() => window.financeWorkerRuntime.close())
			await page.evaluate(
				({ endpoint, scope, organizationId }) =>
					window.financeWorkerRuntime.start(endpoint, scope, `/?workspace=${organizationId}`),
				{ endpoint: proxy.url, scope: backend.appId, organizationId }
			)
			await page.waitForFunction(() => {
				const report = window.financeWorkerRuntime.view()?.workspace.overview
				return (
					report?.preferencesReady &&
					report.filters.start === '2026-11-09' &&
					report.filters.end === '2026-11-09' &&
					report.filters.query === '' &&
					report.total === 234n
				)
			})
			await page
				.getByTestId('overview')
				.getByRole('button', { name: /Worker expense.*\$2\.34/i })
				.click()
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.activeCategory !== null
			)
			await page
				.getByTestId('overview')
				.getByRole('button', { name: /^All Categories$/i })
				.click()
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.activeCategory === null
			)
			await page
				.getByTestId('overview')
				.getByRole('button', { name: /Search Transactions/i })
				.click()
			await page.getByTestId('overview').getByRole('searchbox').fill('No matching receipt')
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.total === 0n
			)
			await page.getByTestId('overview').getByRole('searchbox').fill('Worker expense')
			await page.keyboard.press('Escape')
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.overview.total === 234n &&
					window.financeWorkerRuntime.view()?.workspace.overview.filters.query === 'Worker expense'
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({
					type: 'RANGE',
					start: '2026-11-10',
					end: '2026-11-10'
				})
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.total === 0n
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({
					type: 'RESTORE_FILTERS',
					value: JSON.stringify({
						start: '2026-11-09',
						end: '2026-11-09',
						categoryId: null,
						currency: 'USD'
					})
				})
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({ type: 'SEARCH', query: 'expense Worker' })
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.overview.filters.query === 'expense Worker'
			)
			expect(
				await page.evaluate(
					() => window.financeWorkerRuntime.view()?.workspace.overview.filters.start
				)
			).toBe('2026-11-10')
			await page.evaluate(() => window.financeWorkerRuntime.overview({ type: 'PRESET', days: 30 }))
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.preset === '30'
			)

			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/expenses?workspace=${id}&q=Worker%20expense`),
				organizationId
			)
			await page.waitForFunction(() => {
				const ledger = window.financeWorkerRuntime.view()?.workspace.ledger
				return (
					ledger?.active &&
					!ledger.loading &&
					!ledger.failed &&
					ledger.total === 31 &&
					ledger.groups[0]?.totals[0]?.amountMinor === 234n
				)
			})
			await expect
				.poll(() =>
					page.getByRole('link', { name: /Transaction details: Worker expense/i }).count()
				)
				.toBe(25)

			await page.evaluate(
				(id) =>
					window.financeWorkerRuntime.route(`/expenses?workspace=${id}&q=Worker%20expense&page=2`),
				organizationId
			)
			await page.waitForFunction(() => {
				const ledger = window.financeWorkerRuntime.view()?.workspace.ledger
				return (
					ledger?.page === 2 &&
					ledger.groups[0]?.rows.length === 6 &&
					ledger.groups[0]?.totals[0]?.amountMinor === 234n
				)
			})
			await expect
				.poll(() =>
					page.getByRole('link', { name: /Transaction details: Worker expense/i }).count()
				)
				.toBe(6)
			await page.evaluate(() => window.financeWorkerRuntime.ledger({ type: 'NO_ACCOUNTS' }))
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.ledger.noAccountsSelected &&
					window.financeWorkerRuntime.view()?.workspace.ledger.total === 0
			)
			await page.evaluate(() => window.financeWorkerRuntime.ledger({ type: 'ALL_ACCOUNTS' }))
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.ledger.total === 31
			)
			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/income?workspace=${id}`),
				organizationId
			)
			await page.waitForFunction(() => {
				const ledger = window.financeWorkerRuntime.view()?.workspace.ledger
				return (
					ledger?.kind === 'income' &&
					!ledger.loading &&
					ledger.groups[0]?.totals[0]?.amountMinor === 10501n
				)
			})
			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/?workspace=${id}`),
				organizationId
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.ledger.active === false
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.accountForm.canSubmit
			)
			await page.getByRole('button', { name: 'Add Account', exact: true }).click()
			const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
			await dialog.getByLabel('Account name', { exact: true }).fill('Worker-owned savings')
			await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
			await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
			await page.waitForFunction(() => {
				const form = window.financeWorkerRuntime.view()?.workspace.accountForm
				return (
					form?.content.kind === 'success' && form.content.value.name === 'Worker-owned savings'
				)
			})
			const savedId = await page.evaluate(() => {
				const content = window.financeWorkerRuntime.view()?.workspace.accountForm.content
				return content?.kind === 'success' ? content.value.id : undefined
			})
			if (!savedId) throw new Error('Missing worker-persisted account')
			await expect
				.poll(async () => (await backend.jazz.db.all(app.accounts.where({ id: savedId }))).length)
				.toBe(1)
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			const colleagueId = await backend.jazz.createAccountFor(crypto.randomUUID())
			await backend.jazz.db
				.insert(app.organizationMembers, {
					organizationId,
					userId: colleagueId,
					role: 'member',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			await page.getByRole('button', { name: 'Manage Worker-owned savings', exact: true }).click()
			const actionsDialog = page.getByRole('dialog', { name: 'Worker-owned savings', exact: true })
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accountActions.deleteGrants.permissions.some((row) => row.userId === id),
				colleagueId
			)
			await actionsDialog.getByRole('checkbox').check()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.accountActions.deleteGrants.notice?.key ===
					'permissions.updated'
			)
			await expect
				.poll(
					async () =>
						(
							await backend.jazz.db.all(
								app.accountMemberships.where({
									organizationId,
									accountId: savedId,
									userId: colleagueId
								})
							)
						)[0]?.canDelete
				)
				.toBe(true)
			await page.keyboard.press('Escape')
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.accountActions.permissionPage.total === 0
			)

			await page.getByRole('button', { name: 'Add Category', exact: true }).click()
			const categoryDialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
			await categoryDialog
				.getByLabel('Category name', { exact: true })
				.fill('Worker category with tags')
			await categoryDialog.getByRole('button', { name: 'Add Category', exact: true }).click()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.management.forms.category.content.kind ===
					'success'
			)
			const savedCategoryId = await page.evaluate(() => {
				const content =
					window.financeWorkerRuntime.view()?.workspace.management.forms.category.content
				return content?.kind === 'success' ? content.value.id : undefined
			})
			if (!savedCategoryId) throw new Error('Missing worker-created category')
			await categoryDialog.getByRole('button', { name: 'Close', exact: true }).click()
			await page.getByRole('button', { name: 'Add Tag', exact: true }).click()
			const tagDialog = page.getByRole('dialog', { name: 'Add Tag', exact: true })
			await tagDialog.getByLabel('Tag name', { exact: true }).fill('Worker tag')
			await tagDialog.getByLabel('Transaction type', { exact: true }).selectOption('income')
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.management.categoryOptionsKind === 'income'
			)
			expect(
				await tagDialog.getByLabel('Category', { exact: true }).locator('option').allTextContents()
			).not.toContain('Worker category with tags (Expenses)')
			await tagDialog.getByLabel('Transaction type', { exact: true }).selectOption('expense')
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.management.categoryOptionsKind === 'expense'
			)

			await tagDialog.getByLabel('Category', { exact: true }).selectOption(savedCategoryId)
			await tagDialog.getByRole('button', { name: 'Add Tag', exact: true }).click()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.management.forms.tag.content.kind ===
					'success'
			)
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.management.categories.find((row) => row.id === id)?.tagCount === 1,
				savedCategoryId
			)
			await expect
				.poll(
					async () =>
						(await backend.jazz.db.all(app.tags.where({ organizationId, name: 'Worker tag' })))
							.length
				)
				.toBe(1)

			const existingLongTagName = 'Existing long tag '.repeat(400) + 'NativeExistingTagTailMarker'
			const existingLongTag = await backend.jazz.db
				.insert(app.tags, {
					organizationId,
					name: existingLongTagName,
					kind: 'expense',
					categoryId: null
				})
				.wait({ tier: 'global' })
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.management.tags.some((tag) => tag.id === id),
				existingLongTag.id
			)

			await page.evaluate(() => window.financeWorkerRuntime.close())
			await page.close()
			proxy.silence()
			page = await context.newPage()
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime)
			await page.evaluate(
				({ endpoint, scope, organizationId }) =>
					window.financeWorkerRuntime.start(endpoint, scope, `/?workspace=${organizationId}`),
				{ endpoint: proxy.url, scope: backend.appId, organizationId }
			)
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accounts.find((account) => account.id === id)?.balanceMinor === 10267n,
				accountId,
				{ timeout: 20_000, polling: 100 }
			)
			expect(
				await page.evaluate(() => window.financeWorkerRuntime.view()?.session.identityId)
			).toBe(initial?.session.identityId)
			expect(
				await page.evaluate(() => window.financeWorkerRuntime.view()?.workspace.navigation)
			).toBe('scoped')
			expect(
				await page.evaluate(
					(id) =>
						window.financeWorkerRuntime
							.view()
							?.workspace.accounts.some((account) => account.id === id),
					savedId
				)
			).toBe(true)

			await page.waitForFunction(() => {
				const report = window.financeWorkerRuntime.view()?.workspace.overview
				return report?.active && !report.loading && !report.failed
			})
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({
					type: 'RANGE',
					start: '2026-11-09',
					end: '2026-11-09'
				})
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.overview.filters.start === '2026-11-09' &&
					window.financeWorkerRuntime.view()?.workspace.overview.preferencesReady &&
					window.financeWorkerRuntime.view()?.workspace.overview.total === 234n
			)
			await page.evaluate(() => window.financeWorkerRuntime.close())
			await page.evaluate(
				({ endpoint, scope, organizationId }) =>
					window.financeWorkerRuntime.start(endpoint, scope, `/?workspace=${organizationId}`),
				{ endpoint: proxy.url, scope: backend.appId, organizationId }
			)
			await page.waitForFunction(() => {
				const report = window.financeWorkerRuntime.view()?.workspace.overview
				return (
					report?.preferencesReady &&
					report.filters.start === '2026-11-09' &&
					report.filters.end === '2026-11-09' &&
					report.filters.query === '' &&
					report.total === 234n
				)
			})
			await page
				.getByTestId('overview')
				.getByRole('button', { name: /Worker expense.*\$2\.34/i })
				.click()
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.activeCategory !== null
			)
			await page
				.getByTestId('overview')
				.getByRole('button', { name: /^All Categories$/i })
				.click()
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.activeCategory === null
			)
			await page
				.getByTestId('overview')
				.getByRole('button', { name: /Search Transactions/i })
				.click()
			await page.getByTestId('overview').getByRole('searchbox').fill('No matching receipt')
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.total === 0n
			)
			await page.getByTestId('overview').getByRole('searchbox').fill('Worker expense')
			await page.keyboard.press('Escape')
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.overview.total === 234n &&
					window.financeWorkerRuntime.view()?.workspace.overview.filters.query === 'Worker expense'
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({
					type: 'RANGE',
					start: '2026-11-10',
					end: '2026-11-10'
				})
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.total === 0n
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({
					type: 'RESTORE_FILTERS',
					value: JSON.stringify({
						start: '2026-11-09',
						end: '2026-11-09',
						categoryId: null,
						currency: 'USD'
					})
				})
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.overview({ type: 'SEARCH', query: 'expense Worker' })
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.overview.filters.query === 'expense Worker'
			)
			expect(
				await page.evaluate(
					() => window.financeWorkerRuntime.view()?.workspace.overview.filters.start
				)
			).toBe('2026-11-10')
			await page.evaluate(() => window.financeWorkerRuntime.overview({ type: 'PRESET', days: 30 }))
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.overview.preset === '30'
			)

			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/expenses?workspace=${id}&q=Worker%20expense`),
				organizationId
			)
			await page.waitForFunction(() => {
				const ledger = window.financeWorkerRuntime.view()?.workspace.ledger
				return (
					ledger?.active &&
					!ledger.loading &&
					!ledger.failed &&
					ledger.total === 31 &&
					ledger.groups[0]?.totals[0]?.amountMinor === 234n
				)
			})
			await expect
				.poll(() =>
					page.getByRole('link', { name: /Transaction details: Worker expense/i }).count()
				)
				.toBe(25)

			await page.evaluate(
				(id) =>
					window.financeWorkerRuntime.route(`/expenses?workspace=${id}&q=Worker%20expense&page=2`),
				organizationId
			)
			await page.waitForFunction(() => {
				const ledger = window.financeWorkerRuntime.view()?.workspace.ledger
				return (
					ledger?.page === 2 &&
					ledger.groups[0]?.rows.length === 6 &&
					ledger.groups[0]?.totals[0]?.amountMinor === 234n
				)
			})
			await expect
				.poll(() =>
					page.getByRole('link', { name: /Transaction details: Worker expense/i }).count()
				)
				.toBe(6)
			await page.evaluate(() => window.financeWorkerRuntime.ledger({ type: 'NO_ACCOUNTS' }))
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.ledger.noAccountsSelected &&
					window.financeWorkerRuntime.view()?.workspace.ledger.total === 0
			)
			await page.evaluate(() => window.financeWorkerRuntime.ledger({ type: 'ALL_ACCOUNTS' }))
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.ledger.total === 31
			)
			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/income?workspace=${id}`),
				organizationId
			)
			await page.waitForFunction(() => {
				const ledger = window.financeWorkerRuntime.view()?.workspace.ledger
				return (
					ledger?.kind === 'income' &&
					!ledger.loading &&
					ledger.groups[0]?.totals[0]?.amountMinor === 10501n
				)
			})
			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/?workspace=${id}`),
				organizationId
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.ledger.active === false
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.accountForm.canSubmit
			)
			await page.getByRole('button', { name: 'Add Account', exact: true }).click()
			const coldDialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
			await coldDialog.getByLabel('Account name', { exact: true }).fill('Cold local cash')
			await coldDialog.getByLabel('Account type', { exact: true }).selectOption('cash')
			await coldDialog.getByRole('button', { name: 'Add Account', exact: true }).click()
			await page.waitForFunction(() => {
				const feedback = window.financeWorkerRuntime.view()?.workspace.accountForm.feedback
				return (
					feedback?.kind === 'result' &&
					feedback.result.outcome === 'succeeded' &&
					feedback.result.settlement === 'locallyPersisted'
				)
			})
			await page.waitForFunction(() =>
				window.financeWorkerRuntime
					.view()
					?.workspace.accounts.some((account) => account.name === 'Cold local cash')
			)
			await coldDialog.getByRole('button', { name: 'Close', exact: true }).click()
			await page.getByRole('button', { name: 'Manage Worker-owned savings', exact: true }).click()
			const coldActions = page.getByRole('dialog', { name: 'Worker-owned savings', exact: true })
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accountActions.deleteGrants.permissions.some(
							(row) => row.userId === id && row.canDelete
						),
				colleagueId
			)
			expect(await coldActions.getByRole('checkbox').isChecked()).toBe(true)
			await coldActions.getByRole('checkbox').uncheck()
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accountActions.deleteGrants.permissions.some(
							(row) => row.userId === id && !row.canDelete
						) &&
					window.financeWorkerRuntime.view()?.workspace.accountActions.deleteGrants.notice?.key ===
						'permissions.updated',
				colleagueId
			)
			await page.keyboard.press('Escape')
			await page.getByRole('button', { name: 'Manage Cold local cash', exact: true }).click()
			const archiveDialog = page.getByRole('dialog', { name: 'Cold local cash', exact: true })
			await archiveDialog.getByRole('button', { name: 'Archive', exact: true }).click()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.accountActions.archive.feedback?.outcome ===
						'succeeded' &&
					!window.financeWorkerRuntime
						.view()
						?.workspace.accounts.some((row) => row.name === 'Cold local cash')
			)
			await page.getByRole('button', { name: 'Add Account', exact: true }).click()
			const replacementDialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
			await replacementDialog
				.getByLabel('Account name', { exact: true })
				.fill('Cold replacement cash')
			await replacementDialog.getByLabel('Account type', { exact: true }).selectOption('cash')
			await replacementDialog.getByRole('button', { name: 'Add Account', exact: true }).click()
			await page.waitForFunction(() =>
				window.financeWorkerRuntime
					.view()
					?.workspace.accounts.some((row) => row.name === 'Cold replacement cash')
			)
			await replacementDialog.getByRole('button', { name: 'Close', exact: true }).click()

			await page
				.getByTestId('categories')
				.getByRole('button', { name: 'Archive Worker category with tags', exact: true })
				.click()
			await page.waitForFunction(() => {
				const feedback =
					window.financeWorkerRuntime.view()?.workspace.management.forms.categoryArchive.feedback
				return (
					feedback?.kind === 'result' &&
					feedback.result.outcome === 'succeeded' &&
					feedback.result.settlement === 'locallyPersisted'
				)
			})
			await page.getByTestId('categories').getByLabel('Archived only', { exact: true }).check()
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.management.categories.some(
							(row) => row.id === id && row.archivedAt !== null
						),
				savedCategoryId
			)
			await page
				.getByTestId('tags')
				.getByRole('button', { name: 'Archive Worker tag', exact: true })
				.click()
			await page.waitForFunction(() => {
				const feedback =
					window.financeWorkerRuntime.view()?.workspace.management.forms.tagArchive.feedback
				return (
					feedback?.kind === 'result' &&
					feedback.result.outcome === 'succeeded' &&
					feedback.result.settlement === 'locallyPersisted'
				)
			})
			await page.getByTestId('tags').getByLabel('Archived only', { exact: true }).check()
			await page.waitForFunction(() =>
				window.financeWorkerRuntime
					.view()
					?.workspace.management.tags.some(
						(row) => row.name === 'Worker tag' && row.archivedAt !== null
					)
			)
			expect(
				await page.evaluate(
					(id) =>
						window.financeWorkerRuntime
							.view()
							?.workspace.management.categories.find((row) => row.id === id)?.tagCount,
					savedCategoryId
				)
			).toBe(1)
			expect(await page.getByTestId('tags').getByRole('table').innerText()).toContain(
				'Worker category with tags'
			)

			const originalGeneration = await page.evaluate(
				() => window.financeWorkerRuntime.view()?.workspace.generation
			)
			if (!originalGeneration) throw new Error('Missing original workspace generation')
			await page.evaluate(() =>
				window.financeWorkerRuntime.workspace({
					type: 'CREATION',
					event: { type: 'SUBMIT', name: 'Other private workspace' }
				})
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.creation.mode === 'complete'
			)
			const otherWorkspaceId = await page.evaluate(
				() => window.financeWorkerRuntime.view()?.workspace.creation.workspace?.id
			)
			if (!otherWorkspaceId) throw new Error('Missing locally created workspace')
			await page.evaluate(
				(workspaceId) =>
					window.financeWorkerRuntime.workspace({ type: 'SELECT_WORKSPACE', workspaceId }),
				otherWorkspaceId
			)
			await page.waitForFunction((id) => {
				const view = window.financeWorkerRuntime.view()?.workspace
				return view?.organizationId === id && view.accountForm.canSubmit
			}, otherWorkspaceId)
			await page.evaluate(
				(generation) =>
					window.financeWorkerRuntime.accountForm(
						{ type: 'SUBMIT', values: { name: 'Stale A draft', kind: 'cash', currency: 'USD' } },
						generation
					),
				originalGeneration
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.accountForm({
					type: 'SUBMIT',
					values: { name: 'Current B cash', kind: 'cash', currency: 'USD' }
				})
			)
			await page.waitForFunction(() =>
				window.financeWorkerRuntime
					.view()
					?.workspace.accounts.some((account) => account.name === 'Current B cash')
			)
			expect(
				await page.evaluate(() =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accounts.some((account) => account.name === 'Stale A draft')
				)
			).toBe(false)
			await page.evaluate(
				(workspaceId) =>
					window.financeWorkerRuntime.workspace({ type: 'SELECT_WORKSPACE', workspaceId }),
				organizationId
			)
			await page.waitForFunction((id) => {
				const view = window.financeWorkerRuntime.view()?.workspace
				return (
					view?.organizationId === id &&
					view.accountForm.canSubmit &&
					view.accounts.some((account) => account.name === 'Cold replacement cash')
				)
			}, organizationId)
			await page.evaluate(
				(generation) =>
					window.financeWorkerRuntime.accountForm(
						{ type: 'SUBMIT', values: { name: 'Stale A draft', kind: 'cash', currency: 'USD' } },
						generation
					),
				originalGeneration
			)
			await page.evaluate(() =>
				window.financeWorkerRuntime.accountForm({
					type: 'SUBMIT',
					values: { name: 'Current A cash', kind: 'cash', currency: 'USD' }
				})
			)
			await page.waitForFunction(() =>
				window.financeWorkerRuntime
					.view()
					?.workspace.accounts.some((account) => account.name === 'Current A cash')
			)
			expect(
				await page.evaluate(() =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accounts.some(
							(account) => account.name === 'Stale A draft' || account.name === 'Current B cash'
						)
				)
			).toBe(false)

			await page.evaluate(() => window.financeWorkerRuntime.close())
			await page.close()
			page = await context.newPage()
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime)
			await page.evaluate(
				({ endpoint, scope, organizationId }) =>
					window.financeWorkerRuntime.start(endpoint, scope, `/?workspace=${organizationId}`),
				{ endpoint: proxy.url, scope: backend.appId, organizationId }
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accounts.some((account) => account.name === 'Cold replacement cash'),
				undefined,
				{ timeout: 20_000, polling: 100 }
			)
			expect(
				await page.evaluate(() =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accounts.some((row) => row.name === 'Cold local cash')
				)
			).toBe(false)
			await page.getByRole('button', { name: 'Manage Worker-owned savings', exact: true }).click()
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.accountActions.deleteGrants.permissions.some(
							(row) => row.userId === id && !row.canDelete
						),
				colleagueId
			)
			expect(
				await page
					.getByRole('dialog', { name: 'Worker-owned savings', exact: true })
					.getByRole('checkbox')
					.isChecked()
			).toBe(false)
			await page.keyboard.press('Escape')

			await page.getByTestId('categories').getByLabel('Archived only', { exact: true }).check()
			await page.waitForFunction(
				(id) =>
					window.financeWorkerRuntime
						.view()
						?.workspace.management.categories.some(
							(row) => row.id === id && row.archivedAt !== null && row.tagCount === 1
						),
				savedCategoryId
			)
			await page.getByTestId('tags').getByLabel('Archived only', { exact: true }).check()
			await page.waitForFunction(() =>
				window.financeWorkerRuntime
					.view()
					?.workspace.management.tags.some(
						(row) =>
							row.name === 'Worker tag' &&
							row.archivedAt !== null &&
							row.categoryName === 'Worker category with tags'
					)
			)

			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/expenses/new?workspace=${id}`),
				organizationId
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.form.canSubmit
			)
			const controller = await page.evaluate(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.generation
			)
			await page.evaluate(() => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				if (!view?.defaultAccountId || !view.defaultCategoryId)
					throw new Error('Missing worker transaction defaults')
				window.financeWorkerRuntime.transaction({
					type: 'SUBMIT',
					values: {
						accountId: view.defaultAccountId,
						categoryId: view.defaultCategoryId,
						amount: 'invalid',
						bookedOn: '2026-11-09',
						tags: []
					}
				})
			})
			await page.waitForFunction(() => {
				const feedback = window.financeWorkerRuntime.view()?.workspace.transaction.form.feedback
				return feedback?.kind === 'result' && feedback.result.outcome === 'invalid'
			})
			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/income/new?workspace=${id}`),
				organizationId
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.transaction.route?.kind === 'income' &&
					window.financeWorkerRuntime.view()?.workspace.transaction.form.canSubmit
			)
			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/expenses/new?workspace=${id}`),
				organizationId
			)
			await page.waitForFunction((old) => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				return view?.route?.kind === 'expense' && view.generation !== old && view.form.canSubmit
			}, controller)
			await page.evaluate((old) => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				if (!view?.defaultAccountId || !view.defaultCategoryId)
					throw new Error('Missing worker transaction defaults')
				window.financeWorkerRuntime.transaction(
					{
						type: 'SUBMIT',
						values: {
							accountId: view.defaultAccountId,
							categoryId: view.defaultCategoryId,
							amount: '1.23',
							bookedOn: '2026-11-09',
							description: 'Stale transaction controller',
							tags: []
						}
					},
					old
				)
			}, controller)
			const entry = page.getByTestId('transaction-entry')
			await entry.getByLabel('Amount', { exact: true }).fill('1.23')
			await entry.getByLabel('Date', { exact: true }).fill('2026-11-09')
			await entry
				.getByLabel('Description', { exact: true })
				.fill('Worker-created local transaction')
			const tags = entry
				.getByRole('textbox', { name: 'Tags', exact: true })
				.or(entry.getByRole('combobox', { name: 'Tags', exact: true }))
			await tags.fill('Worker local receipt')
			await tags.press('Enter')
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.newTags.page.total === 1
			)
			await entry.getByLabel('Select Tag', { exact: true }).selectOption(existingLongTag.id)
			await entry.getByRole('button', { name: 'Select Tag', exact: true }).click()
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.newTags.page.total === 2
			)
			const longTagName = 'New native tag '.repeat(500) + 'NativeLongTagTailMarker'
			await tags.fill(longTagName)
			await tags.press('Enter')
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.newTags.page.total === 3
			)
			await tags.fill(' WORKER LOCAL RECEIPT ')
			await tags.press('Enter')
			await page.waitForFunction(() => {
				const draft = window.financeWorkerRuntime.view()?.workspace.transaction.newTags
				return draft?.page.total === 3 && draft.feedback !== null
			})
			await entry
				.locator('ul[aria-label]')
				.filter({ hasText: longTagName.slice(0, 50) })
				.getByRole('button')
				.last()
				.click()
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.newTags.page.total === 2
			)
			await tags.fill(longTagName)
			await tags.press('Enter')
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.newTags.page.total === 3
			)

			const receipt = {
				name: 'worker-receipt.png',
				mimeType: 'image/png',
				buffer: Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
					'base64'
				)
			}
			await entry
				.locator('input[type="file"]')
				.setInputFiles(
					Array.from({ length: 6 }, (_, index) => ({ ...receipt, name: `receipt-${index}.png` }))
				)
			const invalidFields = await entry.locator('form').evaluate((form) =>
				[
					...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
						'input, select, textarea'
					)
				]
					.filter((field) => !field.validity.valid)
					.map((field) => ({
						name: field.name,
						value: field.value,
						message: field.validationMessage
					}))
			)
			expect(invalidFields).toEqual([])
			await entry.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await page.waitForFunction(() => {
				const feedback = window.financeWorkerRuntime.view()?.workspace.transaction.form.feedback
				return (
					feedback?.kind === 'result' &&
					feedback.result.outcome === 'invalid' &&
					feedback.result.issues.some((issue) => issue.path[0] === 'attachments')
				)
			})
			for (let index = 0; index < 6; index++) {
				await entry
					.getByRole('button', { name: new RegExp(`^.*details: receipt-${index}\\.png$`, 'i') })
					.click()
				await page
					.getByRole('dialog', { name: `receipt-${index}.png`, exact: true })
					.getByRole('button', { name: new RegExp(`^Remove.*: receipt-${index}\\.png$`) })
					.click()
			}
			await entry.locator('input[type="file"]').setInputFiles(receipt)
			const createdMemo = 'Created native memo '.repeat(500) + 'NativeCreatedMemoTailMarker'
			await entry
				.getByRole('textbox', { name: 'Memo (additional notes)', exact: true })
				.fill(createdMemo)
			expect(await entry.getByRole('textbox', { name: 'Amount', exact: true }).inputValue()).toBe(
				'1.23'
			)
			expect(await entry.locator('input[name="bookedOn"]').inputValue()).toBe('2026-11-09')
			expect(
				await entry
					.locator('input[type="file"]')
					.evaluate((input) => (input instanceof HTMLInputElement ? input.files?.length : null))
			).toBe(1)
			await entry.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await page.waitForFunction(
				() =>
					location.pathname === '/expenses' &&
					window.financeWorkerRuntime.view()?.workspace.ledger.total === 32
			)
			await page.evaluate(
				(id) => window.financeWorkerRuntime.route(`/expenses?workspace=${id}&q=Worker-created`),
				organizationId
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.ledger.total === 1 &&
					window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.description ===
						'Worker-created local transaction'
			)

			const editedId = await page.evaluate(
				() => window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.id
			)
			expect(editedId).toBeTruthy()
			await page.evaluate(
				({ id, workspace }) =>
					window.financeWorkerRuntime.route(`/expenses/${id}?workspace=${workspace}`),
				{ id: editedId, workspace: organizationId }
			)
			await page.waitForFunction((id) => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				return (
					view?.route &&
					'transactionId' in view.route &&
					view.route.transactionId === id &&
					view.form.fieldsEditable
				)
			}, editedId)
			const savedTag = entry.getByRole('checkbox', { name: 'Worker local receipt', exact: true })
			await savedTag.uncheck()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime
						.view()
						?.workspace.transaction.savedTags.find((tag) => tag.name === 'Worker local receipt')
						?.selected === false
			)
			await savedTag.check()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime
						.view()
						?.workspace.transaction.savedTags.find((tag) => tag.name === 'Worker local receipt')
						?.selected === true
			)
			await page.waitForFunction(() => {
				const form = window.financeWorkerRuntime.view()?.workspace.transaction.form
				return form?.fieldsEditable && !form.canSubmit
			})

			await entry.getByRole('textbox', { name: 'Amount', exact: true }).fill('2.34')
			await entry
				.getByRole('textbox', { name: 'Description', exact: true })
				.fill('Worker-edited local transaction')
			await entry.getByRole('button', { name: 'Save Transaction', exact: true }).click()

			await page.waitForFunction(() => {
				const feedback = window.financeWorkerRuntime.view()?.workspace.transaction.form.feedback
				return feedback?.kind === 'result' && feedback.result.outcome === 'succeeded'
			})

			await page.evaluate(
				(workspace) => window.financeWorkerRuntime.route(`/income/new?workspace=${workspace}`),
				organizationId
			)
			await page.waitForFunction(() => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				return view?.route?.pathname === '/income/new' && view.form.canSubmit
			})
			await entry.getByRole('combobox', { name: 'Account', exact: true }).selectOption(accountId)
			await entry.getByRole('textbox', { name: 'Amount', exact: true }).fill('2.34')
			await entry.getByLabel('Date', { exact: true }).fill('2026-11-09')
			await entry
				.getByRole('textbox', { name: 'Description', exact: true })
				.fill('Worker transfer counterpart')
			await entry.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await page.waitForFunction(() => location.pathname === '/income')
			await page.evaluate(
				({ id, workspace }) =>
					window.financeWorkerRuntime.route(`/expenses/${id}?workspace=${workspace}`),
				{ id: editedId, workspace: organizationId }
			)
			await page.waitForFunction((id) => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				return (
					view?.route &&
					'transactionId' in view.route &&
					view.route.transactionId === id &&
					view.form.fieldsEditable
				)
			}, editedId)
			await entry
				.getByRole('checkbox', { name: 'Convert this transaction to a transfer', exact: true })
				.check()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.state === 'matches'
			)
			const counterpartId = await page.evaluate(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.candidates[0]?.id
			)
			expect(counterpartId).toBeTruthy()
			if (!counterpartId) throw new Error('Missing transfer candidate')
			await entry.getByRole('radio', { name: /Worker transfer counterpart/ }).check()
			await entry.getByRole('button', { name: /^Link to existing transaction$/i }).click()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.linkOutcome ===
					'succeeded'
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.unlinkWritable ===
					true
			)
			const firstTransferId = await page.evaluate(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.linkedTransferId
			)
			expect(firstTransferId).toBeTruthy()
			await entry.getByRole('button', { name: /^Unlink transfer$/i }).click()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.unlinkOutcome ===
					'succeeded'
			)
			await entry
				.getByRole('checkbox', { name: 'Convert this transaction to a transfer', exact: true })
				.check()
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.state === 'matches'
			)
			await entry.getByRole('radio', { name: /Worker transfer counterpart/ }).check()
			await entry.getByRole('button', { name: /^Link to existing transaction$/i }).click()
			await page.waitForFunction((previousId) => {
				const transfer = window.financeWorkerRuntime.view()?.workspace.transaction.transfer
				return (
					transfer?.linkOutcome === 'succeeded' &&
					transfer.state === 'linked' &&
					transfer.linkedTransferId !== null &&
					transfer.linkedTransferId !== previousId
				)
			}, firstTransferId)

			await entry.getByRole('link', { name: /^Open transaction$/i }).click()

			await page.waitForFunction((id) => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				return (
					view?.route &&
					'transactionId' in view.route &&
					view.route.transactionId === id &&
					view.transfer?.state === 'linked' &&
					view.form.fieldsEditable
				)
			}, counterpartId)

			await entry.getByRole('button', { name: /^Delete transactions$/i }).click()
			await page
				.getByRole('dialog', { name: /^Delete transactions$/i })
				.getByRole('button', { name: /^Delete transaction$/i })
				.click()

			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.transaction.transfer?.deleteOutcome ===
					'succeeded'
			)

			if (!initialExpenseId) throw new Error('Missing initial expense')
			await page.evaluate(
				({ id, workspace }) =>
					window.financeWorkerRuntime.route(`/expenses/${id}?workspace=${workspace}`),
				{ id: initialExpenseId, workspace: organizationId }
			)
			await page.waitForFunction((id) => {
				const view = window.financeWorkerRuntime.view()?.workspace.transaction
				return (
					view?.route &&
					'transactionId' in view.route &&
					view.route.transactionId === id &&
					view.form.fieldsEditable
				)
			}, initialExpenseId)
			const memoInput = entry.getByRole('textbox', { name: 'Memo (additional notes)', exact: true })
			await expect.poll(() => memoInput.inputValue()).toBe(legacyMemo)
			await expect.poll(() => memoInput.getAttribute('readonly')).toBeNull()

			await entry
				.getByRole('textbox', { name: 'Description', exact: true })
				.fill('Worker-preserved memo transaction')
			await entry.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await page.waitForFunction(() => {
				const feedback = window.financeWorkerRuntime.view()?.workspace.transaction.form.feedback
				return feedback?.kind === 'result' && feedback.result.outcome === 'succeeded'
			})

			await page.evaluate(
				(workspace) => window.financeWorkerRuntime.route(`/expenses?workspace=${workspace}`),
				organizationId
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.transaction.mode === 'idle'
			)
			await page.evaluate(
				({ id, workspace }) =>
					window.financeWorkerRuntime.route(`/expenses/${id}?workspace=${workspace}`),
				{ id: initialExpenseId, workspace: organizationId }
			)
			await page.waitForFunction((id) => {
				const current = window.financeWorkerRuntime.view()?.workspace.transaction
				return (
					current?.route &&
					'transactionId' in current.route &&
					current.route.transactionId === id &&
					current.form.fieldsEditable
				)
			}, initialExpenseId)
			await expect.poll(() => memoInput.inputValue()).toBe(legacyMemo)
			await expect.poll(() => memoInput.getAttribute('readonly')).toBeNull()
			const editedMemo = legacyMemo + '\nNativeEditedMemoTailMarker'
			await memoInput.fill(editedMemo)
			await entry.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await page.waitForFunction(() => {
				const feedback = window.financeWorkerRuntime.view()?.workspace.transaction.form.feedback
				return feedback?.kind === 'result' && feedback.result.outcome === 'succeeded'
			})
			await page.evaluate(() => window.financeWorkerRuntime.close())
			await page.close()
			page = await context.newPage()
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime)
			await page.evaluate(
				({ endpoint, scope, organizationId }) =>
					window.financeWorkerRuntime.start(
						endpoint,
						scope,
						`/expenses?workspace=${organizationId}&q=Worker-edited`
					),
				{ endpoint: proxy.url, scope: backend.appId, organizationId }
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.ledger.total === 1 &&
					window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.description ===
						'Worker-edited local transaction' &&
					window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.amountMinor ===
						234 &&
					window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.currency ===
						'USD' &&
					window.financeWorkerRuntime
						.view()
						?.workspace.ledger.groups[0]?.rows[0]?.tags.names.includes('Worker local receipt')
			)

			for (const marker of ['NativeLongTagTailMarker', 'NativeExistingTagTailMarker']) {
				await page.evaluate(
					({ workspace, marker }) =>
						window.financeWorkerRuntime.route(`/expenses?workspace=${workspace}&q=${marker}`),
					{ workspace: organizationId, marker }
				)
				await page.waitForFunction(
					() =>
						window.financeWorkerRuntime.view()?.workspace.ledger.total === 1 &&
						window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.description ===
							'Worker-edited local transaction'
				)
			}

			await page.evaluate(
				(workspace) =>
					window.financeWorkerRuntime.route(
						`/expenses?workspace=${workspace}&q=NativeCreatedMemoTailMarker`
					),
				organizationId
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.ledger.total === 1 &&
					window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.description ===
						'Worker-edited local transaction'
			)

			await page.evaluate(
				(workspace) =>
					window.financeWorkerRuntime.route(
						`/expenses?workspace=${workspace}&q=NativeEditedMemoTailMarker`
					),
				organizationId
			)
			await page.waitForFunction(
				() =>
					window.financeWorkerRuntime.view()?.workspace.ledger.total === 1 &&
					window.financeWorkerRuntime.view()?.workspace.ledger.groups[0]?.rows[0]?.description ===
						'Worker-preserved memo transaction'
			)

			await page.evaluate(() => window.financeWorkerRuntime.close())
			expect(logs).toEqual([])
		} catch (error) {
			const views = await Promise.all(
				context
					.pages()
					.map((page) => page.evaluate(() => window.financeWorkerRuntime?.view()).catch(() => null))
			)
			throw new Error(
				JSON.stringify({ views, logs }, (_key, value: unknown) =>
					typeof value === 'bigint' ? value.toString() : value
				),
				{ cause: error }
			)
		} finally {
			await context.close()
			await browser.close()
			await proxy.close()
			await backend.stop()
		}
	}, 60_000)
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	it(`${name}: preserves full native form names through worker validation and cold restore`, async () => {
		const backend = await startTestJazz({
			app,
			permissions,
			jazz: { allowedOrigins: [new URL(url).origin] }
		})
		const proxy = createSilentJazzProxy(backend.url)
		await proxy.listen(0)
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		const context = await browser.newContext(),
			logs: string[] = []
		try {
			let page = await context.newPage()
			page.on('pageerror', (error) => logs.push(error.message))
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime)
			await page.evaluate(
				({ endpoint, scope }) => window.financeWorkerRuntime.start(endpoint, scope),
				{ endpoint: proxy.url, scope: backend.appId }
			)
			await page.waitForFunction(
				() => window.financeWorkerRuntime.view()?.workspace.navigation === 'scoped'
			)
			const organizationId = await page.evaluate(
				() => window.financeWorkerRuntime.view()?.workspace.organizationId
			)
			if (!organizationId) throw new Error('Missing native-name workspace')
			const forms = [
				{
					form: 'account',
					subject: 'Account',
					name: 'Long account '.repeat(500) + 'AccountNameTail'
				},
				{
					form: 'category',
					subject: 'Category',
					name: 'Long category '.repeat(500) + 'CategoryNameTail'
				},
				{ form: 'tag', subject: 'Tag', name: 'Long tag '.repeat(700) + 'TagNameTail' }
			] satisfies { form: 'account' | 'category' | 'tag'; subject: string; name: string }[]
			for (const item of forms) {
				await page.getByRole('button', { name: `Add ${item.subject}`, exact: true }).click()
				const dialog = page.getByRole('dialog', { name: `Add ${item.subject}`, exact: true })
				await dialog
					.getByLabel(`${item.subject} name`, { exact: true })
					.fill('  ' + item.name + '  ')
				if (item.form === 'account')
					await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
				await dialog.getByRole('button', { name: `Add ${item.subject}`, exact: true }).click()
				await page.waitForFunction((slot) => {
					const workspace = window.financeWorkerRuntime.view()?.workspace
					return (
						(slot === 'account' ? workspace?.accountForm : workspace?.management.forms[slot])
							?.content.kind === 'success'
					)
				}, item.form)
				await expect
					.poll(async () => {
						const rows =
							item.form === 'account'
								? await backend.jazz.db.all(app.accounts.where({ organizationId, name: item.name }))
								: item.form === 'category'
									? await backend.jazz.db.all(
											app.categories.where({ organizationId, name: item.name })
										)
									: await backend.jazz.db.all(app.tags.where({ organizationId, name: item.name }))
						return rows.map((row) => row.name)
					})
					.toEqual([item.name])
				await page.keyboard.press('Escape')
			}
			await page.evaluate(() => window.financeWorkerRuntime.close())
			await page.close()
			proxy.silence()
			page = await context.newPage()
			page.on('pageerror', (error) => logs.push(error.message))
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime)
			await page.evaluate(
				({ endpoint, scope, organizationId }) =>
					window.financeWorkerRuntime.start(endpoint, scope, `/?workspace=${organizationId}`),
				{ endpoint: proxy.url, scope: backend.appId, organizationId }
			)
			await page.waitForFunction(() => window.financeWorkerRuntime.view()?.workspace.ready)
			for (const item of forms) {
				await page.getByRole('button', { name: `Add ${item.subject}`, exact: true }).click()
				const dialog = page.getByRole('dialog', { name: `Add ${item.subject}`, exact: true })
				await dialog.getByLabel(`${item.subject} name`, { exact: true }).fill(item.name)
				if (item.form === 'account')
					await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
				await dialog.getByRole('button', { name: `Add ${item.subject}`, exact: true }).click()
				await page.waitForFunction((slot) => {
					const workspace = window.financeWorkerRuntime.view()?.workspace
					const feedback = (
						slot === 'account' ? workspace?.accountForm : workspace?.management.forms[slot]
					)?.feedback
					return (
						feedback?.kind === 'result' &&
						feedback.result.outcome === 'unavailable' &&
						feedback.result.reason === 'duplicateName'
					)
				}, item.form)
				await page.keyboard.press('Escape')
			}
			await page.evaluate(() => window.financeWorkerRuntime.close())
			expect(logs).toEqual([])
		} finally {
			await context.close()
			await browser.close()
			await proxy.close()
			await backend.stop()
		}
	}, 60_000)
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	it(`${name}: processes an image entirely in a native worker`, async () => {
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		try {
			const page = await browser.newPage()
			await page.goto(url)
			await page.waitForFunction(() => window.financeWorkerRuntime)
			await page.evaluate(() => {
				void window.financeWorkerRuntime.processImage(
					new File(
						[
							Uint8Array.from(
								atob(
									'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='
								),
								(char) => char.charCodeAt(0)
							)
						],
						'worker-receipt.png',
						{ type: 'image/png' }
					)
				)
			})
			try {
				await page.waitForFunction(
					() =>
						window.financeWorkerRuntime
							.imageReports()
							.some(
								(report) =>
									typeof report === 'object' &&
									report !== null &&
									'type' in report &&
									report.type === 'DONE'
							),
					undefined,
					{ timeout: 10_000 }
				)
			} catch (error) {
				throw new Error(
					JSON.stringify(await page.evaluate(() => window.financeWorkerRuntime.imageReports())),
					{ cause: error }
				)
			}
			const reports = await page.evaluate(() => window.financeWorkerRuntime.imageReports())
			expect(reports.at(-1), JSON.stringify(reports)).toMatchObject({
				type: 'DONE',
				outcome: 'processed',
				dimensions: { width: 1, height: 1 }
			})
		} finally {
			await browser.close()
		}
	}, 30_000)
}
