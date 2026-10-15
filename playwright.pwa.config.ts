import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests',
	testMatch: 'pwa.e2e.ts',
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: { baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'allow' },
	webServer: {
		command: 'FINANCE_PREVIEW=true pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI
	}
})
