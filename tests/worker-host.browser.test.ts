import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { chromium, firefox, webkit } from '@playwright/test'
import type {} from './worker-host/browser.js'

let server: ViteDevServer
let url: string
beforeAll(async () => {
	server = await createServer({
		configFile: false,
		tsconfig: './tsconfig.worker-host.json',
		optimizeDeps: {
			noDiscovery: true,
			include: ['zod']
		},
		server: { host: '0.0.0.0', port: 0 },
		plugins: [
			{
				name: 'worker-lease-harness',
				configureServer(server) {
					server.middlewares.use((request, response, next) => {
						if (request.url !== '/') return next()
						response.setHeader('Content-Type', 'text/html')
						response.end('<script type="module" src="/tests/worker-host/browser.ts"></script>')
					})
				}
			}
		]
	})
	await server.listen()
	url = server.resolvedUrls?.local[0] ?? ''
	if (!url) throw new Error('Missing harness URL')
	server.printUrls()
})
afterAll(async () => {
	await server?.close()
})

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	it(`${name}: retains a crashed worker's Window lease until old writes are fenced across tabs`, async () => {
		const browser = await engine.launch({
			headless: true,
			timeout: 10_000,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		const context = await browser.newContext()
		const errors: string[] = []
		context.on('page', (page) => {
			page.on('pageerror', (error) => errors.push(error.message))
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text())
			})
			page.setDefaultTimeout(5_000)
		})
		try {
			const first = await context.newPage()
			const second = await context.newPage()
			await Promise.all([first.goto(url), second.goto(url)])
			await Promise.all([
				first.waitForFunction(() => window.leaseHarness, undefined, { polling: 100 }),
				second.waitForFunction(() => window.leaseHarness, undefined, { polling: 100 })
			])
			const key = `worker-termination-test:${crypto.randomUUID()}`
			await first.evaluate((key) => window.leaseHarness.start(key, 'obsolete', true), key)
			await first.waitForFunction(() => window.leaseHarness.reports.includes('QUEUED'), undefined, {
				polling: 100
			})
			await first.evaluate(() => window.leaseHarness.terminate())
			await second.evaluate((key) => window.leaseHarness.start(key, 'replacement'), key)
			await expect
				.poll(async () =>
					second.evaluate(async (key) => {
						const snapshot = await window.leaseHarness.locks()
						return {
							held: snapshot.held?.filter((lock) => lock.name === key).length,
							pending: snapshot.pending?.filter((lock) => lock.name === key).length
						}
					}, key)
				)
				.toEqual({ held: 1, pending: 1 })
			expect(await second.evaluate(() => window.leaseHarness.reports)).not.toContain('LOCKED')
			await first.evaluate(() => window.leaseHarness.closeHost())
			await second.waitForFunction(
				() => window.leaseHarness.reports.includes('WRITTEN'),
				undefined,
				{ polling: 100 }
			)
			await first.evaluate(() => window.leaseHarness.replayQueued())
			expect(await first.evaluate(() => window.leaseHarness.read())).toBe('replacement')
			await second.evaluate(() => window.leaseHarness.release())
			await second.waitForFunction(
				() => window.leaseHarness.reports.includes('RELEASED'),
				undefined,
				{ polling: 100 }
			)
			expect(
				await second.evaluate(
					async (key) =>
						(await window.leaseHarness.locks()).held?.some((lock) => lock.name === key),
					key
				)
			).toBe(false)
			await second.evaluate(() => window.leaseHarness.closeHost())
		} catch (error) {
			const reports = await Promise.all(
				context
					.pages()
					.map((page) => page.evaluate(() => window.leaseHarness?.reports).catch(() => []))
			)
			throw new Error(JSON.stringify({ errors, reports }), { cause: error })
		} finally {
			await context.close()
			await browser.close()
		}
	}, 30_000)
}
