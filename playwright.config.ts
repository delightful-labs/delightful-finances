import { defineConfig } from '@playwright/test'

export default defineConfig({
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL: 'http://127.0.0.1:5180',
		trace: 'off',
		screenshot: 'off',
		video: 'off'
	},
	webServer: {
		command: 'pnpm dev:agent --host 127.0.0.1',
		url: 'http://127.0.0.1:5180',
		reuseExistingServer: false
	},
	testMatch: '**/*.e2e.{ts,js}',
	testIgnore: [
		'**/tests/startup-stalled-remote.e2e.ts',
		'**/tests/debugging.e2e.ts',
		'**/tests/fake-data.e2e.ts',
		'**/.delta/**',
		'**/tests/pwa.e2e.ts',
		'**/tests/authentication.e2e.ts',
		'**/tests/permissions.e2e.ts',
		'**/tests/workspace.e2e.ts'
	]
})
