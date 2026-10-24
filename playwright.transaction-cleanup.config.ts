import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

export default defineConfig({
	...isolated,
	testMatch: ['transaction-workspace.e2e.ts', 'transaction-edit.e2e.ts', 'expense-overview.e2e.ts'],
	webServer: {
		command: 'pnpm dev:agent --host 127.0.0.1 --port 5186 --strictPort',
		url: 'http://127.0.0.1:5186',
		reuseExistingServer: true
	},
	use: { ...isolated.use, baseURL: 'http://127.0.0.1:5186' }
})
