import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

export default defineConfig({
	...isolated,
	webServer: {
		command: 'pnpm dev:agent --host 127.0.0.1 --port 5181',
		url: 'http://127.0.0.1:5181',
		reuseExistingServer: false
	},
	use: { ...isolated.use, baseURL: 'http://127.0.0.1:5181' },
	projects: [
		{ name: 'workspace', testMatch: 'transaction-workspace.e2e.ts' },
		{ name: 'editing', testMatch: 'transaction-edit.e2e.ts' },
		{
			name: 'creation',
			testMatch: 'creation-modals.e2e.ts',
			grep: /first account can be created/
		}
	]
})
