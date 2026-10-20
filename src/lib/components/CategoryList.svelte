<script lang="ts">
	import Icon from './AppIcon.svelte'
	import { Button, Table } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type { Category } from '#lib/schema.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import type { ManagementView } from '#lib/management-contract.js'
	import { formReasonText } from '#lib/form-messages.js'
	import FormFeedback from './FormFeedback.svelte'
	import ArchiveFilter, { type ArchiveFilterValue } from './ArchiveFilter.svelte'
	import { m } from '#lib/paraglide/messages.js'

	let {
		loading = false,
		categories,
		counts,
		archivableCategoryIds,
		archiveView,
		onArchive
	}: {
		loading?: boolean
		categories: readonly Category[]
		counts: ReadonlyMap<string, { transactions: number; tags: number }>
		archivableCategoryIds: readonly string[]
		archiveView: ManagementView<string>
		onArchive: (categoryId: string) => void
	} = $props()
	const numbers = $derived(new Intl.NumberFormat(getLocale()))
	let archiveFilter = $state<ArchiveFilterValue>('active')
	const visibleCategories = $derived(
		categories.filter(
			(row) =>
				archiveFilter === 'all' ||
				(archiveFilter === 'archived' ? !!row.archivedAt : !row.archivedAt)
		)
	)
</script>

<FormFeedback
	view={archiveView}
	subject={m['labels.category']()}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['categories.validation_error']()}
	successMessage={(name) => m['actions.archived']({ subject: m['labels.category'](), name })}
	action="archive"
	section="result"
/>

<ArchiveFilter bind:value={archiveFilter} />

{#if loading || visibleCategories.length}
	<Table caption={m['labels.categories']()}>
		<thead
			><tr>
				<th scope="col">{m['labels.category_name']()}</th>
				<th scope="col">{m['labels.transaction_type']()}</th>
				<th scope="col">{m['labels.transactions']()}</th>
				<th scope="col">{m['labels.tags']()}</th>
				<th scope="col">{m['labels.actions']()}</th>
			</tr></thead
		>
		<tbody>
			{#each visibleCategories as category (category.id)}
				<tr>
					<th scope="row">{category.name}</th>
					<td>{category.kind === 'expense' ? m['labels.expenses']() : m['labels.income']()}</td>
					<td>{numbers.format(counts.get(category.id)?.transactions ?? 0)}</td>
					<td>{numbers.format(counts.get(category.id)?.tags ?? 0)}</td>
					<td
						>{#if archivableCategoryIds.includes(category.id)}
							<Button
								type="button"
								disabled={!archiveView.canSubmit}
								aria-label={m['actions.archive']({ name: category.name })}
								onclick={() => onArchive(category.id)}
								><Icon style="width: 1em; height: 1em;" icon={ArchiveIcon} />{m[
									'actions.archive_button'
								]()}
							</Button>
						{/if}</td
					>
				</tr>
			{/each}
		</tbody>
	</Table>
{:else}
	<p>{m['actions.empty']({ name: m['labels.categories']() })}</p>
{/if}
