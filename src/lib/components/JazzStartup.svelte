<script lang="ts">
	import { LoadingScreen } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'

	let { error = false, workspace = false }: { error?: boolean; workspace?: boolean } = $props()
</script>

<main>
	<LoadingScreen
		variant={error ? 'error' : 'loading'}
		text={workspace && error
			? m['workspace.setup_error']()
			: workspace
				? m['workspace.loading']()
				: error
					? m['database.start_error']()
					: m['database.starting']()}
	/>
</main>
