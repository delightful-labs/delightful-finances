import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests',
	testMatch: 'authentication.e2e.ts',
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', screenshot: 'off', video: 'off' },
	webServer: {
		command: 'pnpm dev --host 127.0.0.1 --port 5173 --strictPort',
		url: 'http://127.0.0.1:5173',
		reuseExistingServer: !process.env.CI
	}
})
