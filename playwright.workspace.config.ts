import { defineConfig } from '@playwright/test'
import authentication from './playwright.auth.config.js'

export default defineConfig({
	...authentication,
	testMatch: 'workspace.e2e.ts',
	timeout: 120_000
})
