import { defineConfig } from '@playwright/test'

export default defineConfig({
	use: { baseURL: 'http://127.0.0.1:5180' },
	webServer: {
		command: 'pnpm dev:agent --host 127.0.0.1',
		url: 'http://127.0.0.1:5180',
		reuseExistingServer: false
	},
	testMatch: '**/*.e2e.{ts,js}',
	testIgnore: [
		'**/tests/pwa.e2e.ts',
		'**/tests/authentication.e2e.ts',
		'**/tests/permissions.e2e.ts',
		'**/tests/workspace.e2e.ts'
	]
})
