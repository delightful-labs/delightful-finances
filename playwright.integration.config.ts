import { defineConfig } from '@playwright/test'

// Use the already-running isolated integration server, without starting another runtime.
export default defineConfig({
	testDir: './tests',
	testMatch: [
		'authentication.e2e.ts',
		'workspace.e2e.ts',
		'ui-integration.e2e.ts',
		'creation-modals.e2e.ts',
		'navigation.e2e.ts',
		'account-order.e2e.ts',
		'permissions.e2e.ts'
	],
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL: process.env.FINANCE_INTEGRATION_URL ?? 'http://127.0.0.1:5180',
		trace: 'off',
		screenshot: 'off',
		video: 'off'
	}
})
