<script lang="ts">
	import { AvatarImageTile } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	type AttachmentImage = { id: string; name: string; source: string }
	let {
		images,
		canEdit = false,
		removingIds = [],
		failedIds = [],
		onremove
	}: {
		images: readonly AttachmentImage[]
		canEdit?: boolean
		removingIds?: readonly string[]
		failedIds?: readonly string[]
		onremove?: (id: string) => void
	} = $props()
</script>

{#each images as image (image.id)}
	<div class="item">
		<AvatarImageTile
			name={image.name}
			preview={image.source}
			downloadUrl={image.source}
			alt={m['attachments.image_preview']({ name: image.name })}
			infoLabel={m['labels.subject_details']({ subject: m['nouns.image']({ count: 1 }) })}
			removeLabel={m['actions.remove_subject']({ subject: m['nouns.image']({ count: 1 }) })}
			removeAccessibleLabel={m['attachments.remove_image']({ name: image.name })}
			disabled={removingIds.includes(image.id)}
			onremove={canEdit && onremove ? () => onremove?.(image.id) : undefined}
		/>
		{#if canEdit && failedIds.includes(image.id)}
			<p role="status">{m['attachments.remove_failed']()}</p>
		{/if}
	</div>
{/each}

<style>
	.item {
		width: var(--dui-avatar-size, 8rem);
		max-width: 100%;
		min-width: 0;
	}
</style>
