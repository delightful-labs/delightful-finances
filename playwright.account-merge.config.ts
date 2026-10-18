import { defineConfig } from '@playwright/test'
import config from './playwright.bank-sync.config.js'

export default defineConfig({
	...config,
	testMatch: ['account-merge-origins.e2e.ts', 'account-merge-page.e2e.ts']
})
