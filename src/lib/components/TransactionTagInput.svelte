<script lang="ts">
	import type { Tag } from '#lib/schema.js'
	import { tick, untrack } from 'svelte'
	import { TagInput } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		organizationId,
		suggestions,
		initialTags = [],
		disabled = false
	}: {
		organizationId: Tag['organizationId']
		suggestions: readonly Tag['name'][]
		initialTags?: readonly Tag['name'][]
		disabled?: boolean
	} = $props()
	let selectedTags = $state(untrack(() => [...initialTags]))
	let inputHost: HTMLDivElement | undefined = $state()
	$effect(() => {
		void selectedTags
		let active = true
		// TagInput updates hidden fields without a native input event.
		void tick().then(() => {
			if (active) inputHost?.dispatchEvent(new Event('input', { bubbles: true }))
		})
		return () => {
			active = false
		}
	})
</script>

{#key organizationId}
	<div bind:this={inputHost}>
		<TagInput
			name="tags"
			label={m['labels.tags']()}
			addLabel={m['actions.add']({ name: m['labels.tag']() })}
			removeLabel={(name) => m['tags.input.remove']({ name })}
			selectedTagsLabel={m['tags.input.selected']()}
			addedMessage={(name) => m['tags.input.added']({ name })}
			removedMessage={(name) => m['tags.input.removed']({ name })}
			duplicateMessage={(name) => m['tags.input.duplicate']({ name })}
			instructions={m['tags.input.instructions']()}
			suggestions={[...suggestions]}
			bind:value={selectedTags}
			{disabled}
		/>
	</div>
{/key}
