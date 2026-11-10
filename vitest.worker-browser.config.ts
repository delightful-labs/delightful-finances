import { defineConfig } from 'vitest/config'

export default defineConfig({
	tsconfig: './tsconfig.worker-host.json',
	test: {
		include: ['tests/worker-host.browser.test.ts'],
		environment: 'node',
		hookTimeout: 30_000,
		expect: { requireAssertions: true }
	}
})
