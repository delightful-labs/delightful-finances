import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'
export default defineConfig({
	...isolated,
	testMatch: 'expense-overview.e2e.ts',
	webServer: {
		command: 'pnpm dev:agent --host 127.0.0.1 --port 5182 --strictPort',
		url: 'http://127.0.0.1:5182',
		reuseExistingServer: false
	},
	use: { ...isolated.use, baseURL: 'http://127.0.0.1:5182' }
})
