import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

const server = isolated.webServer
if (!server || Array.isArray(server)) throw new Error('Expected one isolated test server')

export default defineConfig({
	...isolated,
	webServer: { ...server, reuseExistingServer: false },
	testMatch: 'workspace.e2e.ts',
	grep: /owner can rename|has the correct rename access/
})
