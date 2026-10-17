import { defineConfig } from '@playwright/test'
export default defineConfig({
	testDir: './tests',
	webServer: {
		command:
			'pnpm exec vite dev --config vite.e2e.config.ts --host 127.0.0.1 --port 5180 --strictPort',
		url: 'http://127.0.0.1:5180',
		reuseExistingServer: !process.env.CI
	},
	testMatch: ['bank-sync.e2e.ts', 'bank-sync-offline.e2e.ts', 'readiness.e2e.ts'],
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: { baseURL: 'http://127.0.0.1:5180', trace: 'retain-on-failure' }
})
