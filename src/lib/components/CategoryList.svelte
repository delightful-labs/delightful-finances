<script lang="ts">
	import { Button, Icon } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type { Category } from '#lib/schema.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		categories,
		counts,
		archivableCategoryIds,
		archiving,
		archivingCategoryId,
		archivedName,
		archiveFailed,
		onArchive
	}: {
		categories: readonly Category[]
		counts: ReadonlyMap<string, { transactions: number; tags: number }>
		archivableCategoryIds: readonly string[]
		archiving: boolean
		archivingCategoryId: string | undefined
		archivedName: string | undefined
		archiveFailed: boolean
		onArchive: (categoryId: string) => void
	} = $props()
	const numbers = $derived(new Intl.NumberFormat(getLocale()))
</script>

{#if archivedName}
	<p role="status">{m['categories.archived']({ name: archivedName })}</p>
{:else if archiveFailed}
	<p role="alert">{m['errors.archive']({ subject: m['labels.category']() })}</p>
{/if}

{#if categories.length}
	<table>
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
			{#each categories as category (category.id)}
				<tr>
					<th scope="row">{category.name}</th>
					<td>{category.kind === 'expense' ? m['labels.expenses']() : m['labels.income']()}</td>
					<td>{numbers.format(counts.get(category.id)?.transactions ?? 0)}</td>
					<td>{numbers.format(counts.get(category.id)?.tags ?? 0)}</td>
					<td
						>{#if archivableCategoryIds.includes(category.id)}
							<Button
								type="button"
								disabled={archiving}
								aria-label={m['actions.archive_category']({ name: category.name })}
								onclick={() => onArchive(category.id)}
							>
								{#if archiving && archivingCategoryId === category.id}
									{m['status.archiving']({ subject: m['labels.category']() })}
								{:else}
									<Icon style="width: 1em; height: 1em;"><ArchiveIcon /></Icon>
									{m['actions.archive']()}
								{/if}
							</Button>
						{/if}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<p>{m['categories.empty']()}</p>
{/if}
