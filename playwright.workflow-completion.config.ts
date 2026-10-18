import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'
const server = isolated.webServer
if (!server || Array.isArray(server)) throw new Error('Expected isolated server')
export default defineConfig({
	...isolated,
	webServer: { ...server, reuseExistingServer: false },
	testMatch: [
		'workspace.e2e.ts',
		'authentication.e2e.ts',
		'creation-modals.e2e.ts',
		'workflow-completion.e2e.ts'
	],
	grep: /account list shows an empty|account form |transaction form |default category |category page |tag page |transaction tags |profile name saves offline|profile name edits are owner|recovery modal clears|profile name trims|avatar upload above|avatar rejects invalid|avatar can upload|modal validates|scoped workflow/,
	use: { ...isolated.use, trace: 'off', screenshot: 'off', video: 'off' }
})
