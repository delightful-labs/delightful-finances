<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'

	let { error = false, workspace = false }: { error?: boolean; workspace?: boolean } = $props()
</script>

<main>
	<h1>
		{workspace
			? m['workspace.loading']()
			: error
				? m['database.start_error.heading']()
				: m['database.starting.heading']()}
	</h1>
	<p>
		{workspace && error
			? m['workspace.setup_error']()
			: workspace
				? m['workspace.loading_description']()
				: error
					? m['database.start_error.description']()
					: m['database.starting.description']()}
	</p>
</main>
