import { defineConfig } from '@playwright/test'
export default defineConfig({
	testDir: './tests',
	webServer: {
		command: 'pnpm dev:agent --host 127.0.0.1 --port 5182',
		url: 'http://127.0.0.1:5182',
		reuseExistingServer: true
	},
	testMatch: ['transaction-edit.e2e.ts'],
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: { baseURL: 'http://127.0.0.1:5182', trace: 'retain-on-failure' }
})
