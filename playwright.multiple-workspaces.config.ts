import { defineConfig } from '@playwright/test'
import authentication from './playwright.auth.config.js'
export default defineConfig({
	...authentication,
	testMatch: 'multiple-workspaces.e2e.ts',
	timeout: 120_000
})
