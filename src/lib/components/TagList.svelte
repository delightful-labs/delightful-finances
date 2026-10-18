<script lang="ts">
	import { Button, Table } from 'delightful-ui'
	import type { Tag } from '#lib/schema.js'
	import type { ManagementView } from '#lib/management-contract.js'
	import { formReasonText } from '#lib/form-messages.js'
	import FormFeedback from './FormFeedback.svelte'
	import { m } from '#lib/paraglide/messages.js'

	let {
		tags,
		categoryNames,
		archivableTagIds,
		archiveView,
		onArchive
	}: {
		tags: readonly Tag[]
		categoryNames: ReadonlyMap<string, string>
		archivableTagIds: readonly string[]
		archiveView: ManagementView<string>
		onArchive: (tagId: string) => void
	} = $props()
</script>

<FormFeedback
	view={archiveView}
	subject={m['labels.tag']()}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['tags.validation_error']()}
	successMessage={(name) => m['actions.archived']({ subject: m['labels.tag'](), name })}
	action="archive"
	section="result"
/>

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
							? (categoryNames.get(tag.categoryId) ??
								m['transactions.unavailable_item']({ subject: m['labels.category']() }))
							: m['tags.no_category']()}</td
					>
					<td
						>{#if archivableTagIds.includes(tag.id)}
							<Button
								type="button"
								disabled={!archiveView.canSubmit}
								aria-label={m['actions.archive']({ name: tag.name })}
								onclick={() => onArchive(tag.id)}
							>
								{m['actions.archive_button']()}
							</Button>
						{/if}</td
					>
				</tr>
			{/each}
		</tbody>
	</Table>
{:else}
	<p>{m['actions.empty']({ name: m['labels.tags']() })}</p>
{/if}
