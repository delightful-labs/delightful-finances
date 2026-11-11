import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { chromium, expect as browserExpect } from '@playwright/test'

let server: ViteDevServer
let url: string
const guarded = new Set<string>()
beforeAll(async () => {
	process.env.FINANCE_PREVIEW = 'true'
	server = await createServer({
		configFile: './vite.config.ts',
		server: { host: '0.0.0.0', port: 0 },
		plugins: [
			{
				name: 'production-worker-ownership-guards',
				enforce: 'pre',
				transform(code, id) {
					const path = id.split('?')[0] ?? ''
					if (path.endsWith('/src/routes/+layout.svelte')) {
						// Isolate the normal application from all real authorities. No test
						// page/component replaces the production layout or startup component.
						const start = code.indexOf('const serverUrl ='),
							end = code.indexOf('const legacyScope =', start)
						if (start < 0 || end < 0) throw new Error('Missing production endpoint binding')
						return (
							code.slice(0, start) +
							"const serverUrl = 'http://127.0.0.1:9/jazz'\n\t" +
							code.slice(end)
						)
					}
					if (path.includes('/src/') && code.includes('createQuerySubscription(')) {
						return code.replaceAll(
							'createQuerySubscription(',
							"(() => { if (typeof window !== 'undefined') throw new Error('DOMAIN_QUERY_IN_WINDOW'); return createQuerySubscription })()("
						)
					}
					if (path.endsWith('/src/lib/runtime/jazz-session-capabilities.ts')) {
						guarded.add('sdk')
						const original =
							"export const loadLocalFirstClient = () => import('jazz-tools/local-first')"
						if (!code.includes(original)) throw new Error('Missing SDK ownership guard target')
						return code.replace(
							original,
							"export const loadLocalFirstClient = () => { if (typeof window !== 'undefined') throw new Error('SDK_STARTED_IN_WINDOW'); return import('jazz-tools/local-first') }"
						)
					}
					if (path.endsWith('/src/lib/machines/runtime/application-readiness.ts')) {
						guarded.add('application')
						const start = code.indexOf('export function createApplicationReadinessMachine('),
							body = code.indexOf('\n) {', start)
						if (start < 0 || body < 0) throw new Error('Missing application ownership guard target')
						return (
							code.slice(0, body) +
							code
								.slice(body)
								.replace(
									'\n) {',
									"\n) {\n if (typeof window !== 'undefined') throw new Error('APPLICATION_STARTED_IN_WINDOW');"
								)
						)
					}
				}
			}
		]
	})
	await server.listen()
	const address = server.resolvedUrls?.local[0]
	if (!address) throw new Error('Missing application URL')
	url = address
	server.printUrls()
}, 60_000)
afterAll(async () => {
	await server?.close()
})

declare global {
	interface Window {
		financeBootstrapProbe: { workers: number; identity: string | undefined; close: () => void }
	}
}
it('starts the normal application SDK exclusively in Worker and reopens the persisted identity after real shutdown', async () => {
	const browser = await chromium.launch({ headless: true, channel: 'chromium' })
	const context = await browser.newContext(),
		errors: string[] = []
	await context.addInitScript(() => {
		function record(value: unknown): value is Record<string, unknown> {
			return value !== null && typeof value === 'object'
		}
		const probe: { workers: number; identity: string | undefined; close: () => void } = {
			workers: 0,
			identity: undefined,
			close: () => {}
		}
		window.financeBootstrapProbe = probe
		const BrowserWorker = window.Worker
		window.Worker = class extends BrowserWorker {
			private scope: string | undefined
			private sequence = 0
			constructor(source: string | URL, options?: WorkerOptions) {
				super(source, options)
				if (!String(source).includes('/application.worker.')) return
				probe.workers++
				this.addEventListener('message', (event: MessageEvent<unknown>) => {
					const message = event.data
					if (
						record(message) &&
						message.type === 'VIEW' &&
						record(message.view) &&
						record(message.view.session) &&
						typeof message.view.session.identityId === 'string'
					)
						probe.identity = message.view.session.identityId
				})
				probe.close = () =>
					this.postMessage({
						version: 1,
						type: 'SHUTDOWN',
						scope: this.scope,
						sequence: this.sequence + 1,
						requestId: crypto.randomUUID()
					})
			}
			postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
				if (record(message)) {
					if (message.type === 'INITIALIZE' && typeof message.scope === 'string')
						this.scope = message.scope
					if (typeof message.sequence === 'number') this.sequence = message.sequence
				}
				if (Array.isArray(options)) super.postMessage(message, options)
				else super.postMessage(message, options)
			}
		}
	})
	try {
		let page = await context.newPage()
		page.on('pageerror', (error) => errors.push(error.message))
		await page.goto(url)
		await page
			.locator('main[data-finance-runtime="worker"][data-finance-session="ready"]')
			.waitFor({ timeout: 30_000 })
		await page.waitForFunction(() => !!window.financeBootstrapProbe.identity)
		const first = await page.evaluate(() => ({
			workers: window.financeBootstrapProbe.workers,
			identity: window.financeBootstrapProbe.identity
		}))
		expect(first.workers).toBe(1)
		expect(first.identity).toMatch(/^[a-f\d-]{36}$/i)
		expect(guarded).toEqual(new Set(['sdk', 'application']))
		// Exercise the actual shell and routes before closing the only application client.
		await page.getByRole('button', { name: 'Add Account', exact: true }).click()
		const dialog = page.getByRole('dialog')
		await dialog.getByLabel('Account name', { exact: true }).fill('Production worker cash')
		await dialog.getByLabel('Account type', { exact: true }).selectOption('cash')
		await dialog.getByRole('button', { name: 'Save', exact: true }).click()
		await browserExpect(
			page.getByRole('checkbox', { name: 'Production worker cash', exact: true })
		).toBeChecked()
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		const workspace = new URL(page.url()).searchParams.get('workspace')
		expect(workspace).toMatch(/^[a-f\d-]{36}$/i)
		await page.getByRole('link', { name: 'Expenses', exact: true }).click()
		await page.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		await browserExpect(page.getByLabel('Amount', { exact: true })).toBeEnabled()
		await page.getByLabel('Amount', { exact: true }).fill('12.34')
		await page.getByLabel('Date', { exact: true }).fill('2026-11-09')
		await page.getByLabel('Description', { exact: true }).fill('Production worker expense')
		await page.getByRole('button', { name: 'Save', exact: true }).click()
		await browserExpect(
			page.getByRole('link').filter({ hasText: 'Production worker expense' })
		).toHaveCount(1)
		expect(new URL(page.url()).searchParams.get('workspace')).toBe(workspace)
		await page.getByRole('checkbox', { name: 'Production worker cash', exact: true }).uncheck()
		await browserExpect(
			page.getByText('Turn on an account to see its transactions.', { exact: true })
		).toBeVisible()
		await page.getByRole('checkbox', { name: 'Production worker cash', exact: true }).check()
		await browserExpect(
			page.getByRole('link').filter({ hasText: 'Production worker expense' })
		).toHaveCount(1)
		await page.getByRole('link', { name: 'Income', exact: true }).click()
		await browserExpect(page.getByRole('link', { name: 'Add Income', exact: true })).toBeVisible()
		for (const path of ['/accounts', '/settings/categories', '/settings/tags', '/login']) {
			// Use native links through the client router; preserve the single application owner.
			await page.evaluate((href) => {
				const link = document.createElement('a')
				link.href = href
				document.body.append(link)
				link.click()
				link.remove()
			}, `${path}?workspace=${workspace}`)
			await page.waitForURL((href) => href.pathname === path)
			await browserExpect(page.getByRole('heading', { level: 1 })).toBeVisible()
		}
		await page.getByLabel('Recovery phrase', { exact: true }).fill('invalid recovery phrase')
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		await browserExpect(page.getByRole('alert')).toBeVisible()
		expect(await page.evaluate(() => window.financeBootstrapProbe.workers)).toBe(1)
		await page.evaluate(() => window.financeBootstrapProbe.close())
		await page.locator('main[data-finance-lifecycle="closed"]').waitFor({ timeout: 30_000 })
		await page.close()
		page = await context.newPage()
		page.on('pageerror', (error) => errors.push(error.message))
		await page.goto(url)
		await page.locator('main[data-finance-session="ready"]').waitFor({ timeout: 30_000 })
		await page.waitForFunction(() => !!window.financeBootstrapProbe.identity)
		expect(await page.evaluate(() => window.financeBootstrapProbe.identity)).toBe(first.identity)
		expect(await page.evaluate(() => window.financeBootstrapProbe.workers)).toBe(1)
		await page.evaluate(() => window.financeBootstrapProbe.close())
		await page.locator('main[data-finance-lifecycle="closed"]').waitFor({ timeout: 30_000 })
		expect(errors).toEqual([])
	} finally {
		await context.close()
		await browser.close()
	}
}, 90_000)
