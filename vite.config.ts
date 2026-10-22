import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-auto'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import svg from '@poppanator/sveltekit-svg'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'

const previewing = process.env.FINANCE_PREVIEW === 'true'

export default defineConfig({
	// A different page origin has different browser storage. Never silently change ports.
	server: { port: 5173, strictPort: true },
	plugins: [
		sveltekit({
			adapter: adapter(),
			preprocess: vitePreprocess(),
			prerender: { entries: ['*'] }
		}),
		...(previewing
			? []
			: [
					jazzSvelteKit({
						// Jazz scopes browser identity to the server URL; keep it stable across restarts.
						server: process.env.npm_lifecycle_event === 'dev' ? { port: 5174 } : false
					})
				]),
		svg(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			emitTsDeclarations: true,
			strategy: ['cookie', 'baseLocale']
		})
	]
})
