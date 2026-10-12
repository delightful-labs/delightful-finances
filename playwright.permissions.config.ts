import { defineConfig } from '@playwright/test'
import authentication from './playwright.auth.config.js'

export default defineConfig({
	...authentication,
	testMatch: 'permissions.e2e.ts',
	timeout: 120_000
})
