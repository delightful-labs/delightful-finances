<script lang="ts">
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

{#if images.length}
	<section aria-labelledby="transaction-attachments-heading">
		<h2 id="transaction-attachments-heading">
			{m['nouns.image']({ count: 2 })}
		</h2>
		<ul>
			{#each images as image (image.id)}
				<li>
					<a href={image.source} download={image.name}>
						<img src={image.source} alt={m['attachments.image_preview']({ name: image.name })} />
					</a>
					<a href={image.source} download={image.name}>{image.name}</a>
					{#if canEdit && onremove}
						<button
							type="button"
							disabled={removingIds.includes(image.id)}
							onclick={() => onremove?.(image.id)}
						>
							{m['attachments.remove_image']({ name: image.name })}
						</button>
						{#if failedIds.includes(image.id)}<p role="status">
								{m['attachments.remove_failed']()}
							</p>{/if}
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		gap: var(--dui-spacing-sm);
		list-style: none;
		padding: 0;
	}

	li {
		display: grid;
		gap: var(--dui-spacing-xs);
		min-width: 0;
	}

	img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
	}
</style>
