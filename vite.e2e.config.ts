import { defineConfig } from 'vite'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'
import config from './vite.config.js'
export default defineConfig({
	...config,
	plugins: [
		...(config.plugins ?? []).filter(
			(plugin) =>
				!(
					plugin &&
					typeof plugin === 'object' &&
					'name' in plugin &&
					plugin.name === 'jazz-sveltekit'
				)
		),
		jazzSvelteKit({ server: { inMemory: true }, inspector: false })
	]
})
