import { defineConfig } from '@playwright/test'

const seedEnabled = process.env.PUBLIC_FAKE_DATA === 'true'
const debugEnabled = process.env.PUBLIC_DEBUG === 'true'
const port = seedEnabled ? 5186 : 5187
export default defineConfig({
	testDir: './tests',
	testMatch: 'fake-data.e2e.ts',
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 20_000 },
	metadata: { seedEnabled, debugEnabled },
	use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off', screenshot: 'off', video: 'off' },
	webServer: {
		command: `pnpm dev:agent --host 127.0.0.1 --port ${port}`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: true,
		env: {
			PUBLIC_FAKE_DATA: String(seedEnabled),
			PUBLIC_DEBUG: String(debugEnabled),
			PUBLIC_JAZZ_APP_ID: '77777777-7777-4777-8777-777777777777',
			PUBLIC_JAZZ_SERVER_URL: '',
			JAZZ_ADMIN_SECRET: ''
		}
	}
})
