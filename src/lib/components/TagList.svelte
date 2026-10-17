<script lang="ts">
	import { Button, Table } from 'delightful-ui'
	import type { Tag } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		tags,
		categoryNames,
		canArchive,
		archiving,
		archivingTagId,
		archivedName,
		archiveFailed,
		onArchive
	}: {
		tags: readonly Tag[]
		categoryNames: ReadonlyMap<string, string>
		canArchive: boolean
		archiving: boolean
		archivingTagId: string | undefined
		archivedName: string | undefined
		archiveFailed: boolean
		onArchive: (tagId: string) => void
	} = $props()
</script>

{#if archivedName}
	<p role="status">{m['tags.archived']({ name: archivedName })}</p>
{:else if archiveFailed}
	<p role="alert">{m['errors.archive']({ subject: m['labels.tag']() })}</p>
{/if}
{#if tags.length}
	<Table caption={m['labels.tags']()}>
		<thead
			><tr>
				<th scope="col">{m['labels.tag_name']()}</th>
				<th scope="col">{m['labels.category']()}</th>
				<th scope="col">{m['labels.actions']()}</th>
			</tr></thead
		>
		<tbody>
			{#each tags as tag (tag.id)}
				<tr>
					<th scope="row">{tag.name}</th>
					<td
						>{tag.categoryId
							? (categoryNames.get(tag.categoryId) ?? m['tags.category_unavailable']())
							: m['tags.no_category']()}</td
					>
					<td
						>{#if canArchive}
							<Button
								type="button"
								disabled={archiving}
								aria-label={m['actions.archive_tag']({ name: tag.name })}
								onclick={() => onArchive(tag.id)}
							>
								{archiving && archivingTagId === tag.id
									? m['status.archiving']({ subject: m['labels.tag']() })
									: m['actions.archive']()}
							</Button>
						{/if}</td
					>
				</tr>
			{/each}
		</tbody>
	</Table>
{:else}
	<p>{m['tags.empty']()}</p>
{/if}
