<script lang="ts">
	import { TagInput } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		organizationId,
		suggestions,
		disabled = false
	}: {
		organizationId: string
		suggestions: readonly string[]
		disabled?: boolean
	} = $props()
</script>

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
		suggestions={[...suggestions]}
		{disabled}
	/>
{/key}
