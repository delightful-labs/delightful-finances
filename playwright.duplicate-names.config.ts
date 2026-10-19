import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

export default defineConfig({
	...isolated,
	testMatch: 'duplicate-names.e2e.ts',
	webServer: {
		command:
			'pnpm exec vite dev --config vite.e2e.config.ts --host 127.0.0.1 --port 5184 --strictPort',
		url: 'http://127.0.0.1:5184',
		reuseExistingServer: !process.env.CI
	},
	use: { ...isolated.use, baseURL: 'http://127.0.0.1:5184' }
})
