import { defineConfig } from '@playwright/test'

export default defineConfig({
	use: { baseURL: 'http://127.0.0.1:5173' },
	webServer: {
		command: 'pnpm dev --host 127.0.0.1 --port 5173 --strictPort',
		url: 'http://127.0.0.1:5173',
		reuseExistingServer: !process.env.CI
	},
	testMatch: '**/*.e2e.{ts,js}',
	testIgnore: [
		'**/tests/pwa.e2e.ts',
		'**/tests/authentication.e2e.ts',
		'**/tests/permissions.e2e.ts'
	]
})
