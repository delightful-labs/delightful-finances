import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'
import config from './vite.config.js'
const require = createRequire(import.meta.url)
const jazzToolsDirectory = dirname(require.resolve('jazz-tools/package.json'))
const jazzWasmDirectory = dirname(
	require.resolve('jazz-wasm/package.json', {
		paths: [jazzToolsDirectory]
	})
)

export default defineConfig({
	...config,
	server: {
		...config.server,
		// pnpm worktrees may resolve Jazz WASM and workers outside this checkout.
		fs: { allow: [searchForWorkspaceRoot(process.cwd()), jazzWasmDirectory, jazzToolsDirectory] }
	},
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
