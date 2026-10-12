import { defineConfig } from '@playwright/test'

export default defineConfig({
	webServer: {
		command: 'pnpm dev --host 127.0.0.1 --port 4173',
		port: 4173,
		reuseExistingServer: !process.env.CI
	},
	testMatch: '**/*.e2e.{ts,js}',
	testIgnore: '**/tests/pwa.e2e.ts'
})
