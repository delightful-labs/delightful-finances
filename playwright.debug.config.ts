import { defineConfig } from '@playwright/test'

const enabled = process.env.PUBLIC_DEBUG === 'true'
const production = process.env.DEBUG_PRODUCTION_SMOKE === 'true'
const port = production ? 5185 : enabled ? 5182 : 5183

export default defineConfig({
	testDir: './tests',
	testMatch: 'debugging.e2e.ts',
	grep: production ? /deployed debug build/ : /debug flag controls|HMR replacement/,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 20_000 },
	use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off', screenshot: 'off', video: 'off' },
	metadata: { debugEnabled: enabled },
	webServer: {
		env: {
			// Do not inherit hosted/local development credentials from .env.
			PUBLIC_JAZZ_APP_ID: '77777777-7777-4777-8777-777777777777',
			PUBLIC_JAZZ_SERVER_URL: '',
			JAZZ_ADMIN_SECRET: ''
		},
		command: production
			? `pnpm preview --host 127.0.0.1 --port ${port} --strictPort`
			: `pnpm dev:agent --host 127.0.0.1 --port ${port}`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: true
	}
})
