import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

export default defineConfig({
	...isolated,
	testMatch: 'category-loading.e2e.ts',
	webServer: {
		...isolated.webServer,
		command: 'pnpm dev:agent --host 127.0.0.1'
	}
})
