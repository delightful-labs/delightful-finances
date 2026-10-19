import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

export default defineConfig({
	...isolated,
	testMatch: 'creation-modals.e2e.ts',
	grep: /first account can be created/
})
