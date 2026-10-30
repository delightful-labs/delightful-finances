import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { defineConfig, loadEnv } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-auto'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import svg from '@poppanator/sveltekit-svg'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'

const previewing = process.env.FINANCE_PREVIEW === 'true'

export default defineConfig({
	// A different page origin has different browser storage. Never silently change ports.
	server: { port: 5173, strictPort: true },
	// Vendored DUI updates must be loaded from the current package, not a cached bundle.
	optimizeDeps: { exclude: ['delightful-ui'] },
	plugins: [
		{
			name: 'finance-debug-default',
			config(config, { command, mode }) {
				const env = loadEnv(mode, config.envDir ?? config.root ?? process.cwd(), 'PUBLIC_DEBUG')
				process.env.PUBLIC_DEBUG ??=
					env.PUBLIC_DEBUG ?? String(command === 'serve' && mode === 'development')
			}
		},
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
						server: ['dev', 'dev:network'].includes(process.env.npm_lifecycle_event ?? '')
							? { port: 5174 }
							: false
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
