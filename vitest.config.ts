import { defineConfig } from 'vitest/config'
import { sveltekit } from '@sveltejs/kit/vite'
import svg from '@poppanator/sveltekit-svg'

export default defineConfig({
	plugins: [sveltekit(), svg()],
	ssr: { noExternal: ['delightful-ui', 'tdesign-icons-svg'] },
	define: { 'import.meta.env.PUBLIC_SIMPLEFIN_DEMO': JSON.stringify('false') },
	test: {
		expect: { requireAssertions: true },
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
		server: { deps: { inline: ['delightful-ui'] } },
		environment: 'node'
	}
})
