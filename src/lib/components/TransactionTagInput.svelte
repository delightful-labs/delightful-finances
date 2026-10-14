<script lang="ts">
	import { TagInput } from 'delightful-ui'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	let { organizationId, disabled = false }: { organizationId: string; disabled?: boolean } =
		$props()
	const tags = new QuerySubscription(() =>
		app.tags.where({ organizationId, archivedAt: { isNull: true } }).orderBy('name')
	)
	const suggestions = $derived((tags.current ?? []).map((tag) => tag.name))
</script>

<QueryContent
	queries={[tags]}
	loadingMessage={m['status.loading']({ subject: m['labels.tags']() })}
	errorMessage={m['errors.load']({ subject: m['labels.tags']() })}
>
	{#key organizationId}
		<TagInput
			name="tags"
			label={m['labels.tags']()}
			addLabel={m['tags.input.add']()}
			removeLabel={(name) => m['tags.input.remove']({ name })}
			selectedTagsLabel={m['tags.input.selected']()}
			addedMessage={(name) => m['tags.input.added']({ name })}
			removedMessage={(name) => m['tags.input.removed']({ name })}
			duplicateMessage={(name) => m['tags.input.duplicate']({ name })}
			instructions={m['tags.input.instructions']()}
			{suggestions}
			{disabled}
		/>
	{/key}
</QueryContent>
