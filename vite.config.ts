import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-auto'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import svg from '@poppanator/sveltekit-svg'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'

const previewing = process.env.FINANCE_PREVIEW === 'true'

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			preprocess: vitePreprocess(),
			prerender: { entries: ['*'] }
		}),
		...(previewing ? [] : [jazzSvelteKit({ server: process.env.npm_lifecycle_event === 'dev' })]),
		svg(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			emitTsDeclarations: true,
			strategy: ['url', 'cookie', 'baseLocale']
		})
	]
})
