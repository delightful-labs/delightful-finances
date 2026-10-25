<script lang="ts">
	import { ACCOUNT_KIND } from '#lib/domain/account-kind.js'
	import Icon from './AppIcon.svelte'
	import { Button, Table, StatusMessage } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type { AccountArchiveView } from '#lib/machines/account-archive.js'
	import { m } from '#lib/paraglide/messages.js'
	import { formatSignedMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'

	let {
		view,
		onArchive,
		balances
	}: {
		view: AccountArchiveView
		onArchive: (accountId: string) => void
		balances: ReadonlyMap<string, bigint> | null
	} = $props()
	const feedbackText = $derived(
		view.feedback?.outcome === 'succeeded'
			? m['status.archived_subject_name']({
					subject: m['nouns.account']({ count: 1 }),
					name: view.feedback.request.name
				})
			: view.feedback?.settlement === 'locallyPersisted'
				? m['accounts.archive_interrupted_saved']()
				: view.feedback?.outcome === 'scopeChanged'
					? m['accounts.archive_scope_changed']()
					: view.feedback?.outcome === 'denied'
						? m['accounts.archive_restricted']()
						: m['errors.archive_subject']({ subject: m['nouns.account']({ count: 1 }) })
	)
</script>

{#if view.kind === 'sessionUnavailable'}
	<p role="status">{m['accounts.archive_session_unavailable']()}</p>
{:else if view.kind === 'loading'}
	<StatusMessage
		variant="loading"
		text={m['status.loading_subject']({ subject: m['nouns.account']({ count: 2 }) })}
	/>
{:else if view.kind === 'selectWorkspace'}
	<p>{m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</p>
{:else if view.kind === 'loadFailed'}
	<StatusMessage
		variant="error"
		text={m['errors.load_subject']({ subject: m['nouns.account']({ count: 2 }) })}
	/>
{:else if view.kind === 'ready'}
	{#if view.feedback}
		<StatusMessage
			variant={view.feedback.settlement === 'locallyPersisted' ? 'success' : 'error'}
			text={feedbackText}
		/>
	{/if}
	{#if view.rows.length === 0}
		<p>{m['accounts.empty.title']()}</p>
	{:else}
		<Table caption={m['nouns.account']({ count: 2 })}>
			<thead>
				<tr>
					<th scope="col"
						>{m['labels.subject_name']({ subject: m['nouns.account']({ count: 1 }) })}</th
					>
					<th scope="col"
						>{m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })}</th
					>
					<th scope="col">{m['labels.currency']()}</th>
					<th scope="col">{m['labels.calculated_balance']()}</th>
					<th scope="col">{m['labels.actions']()}</th>
				</tr>
			</thead>
			<tbody>
				{#each view.rows as row (row.account.id)}
					{@const account = row.account}
					<tr>
						<td>{account.name}</td>
						<td>
							{account.kind === ACCOUNT_KIND.CASH
								? m['labels.cash']()
								: account.kind === ACCOUNT_KIND.BANK
									? m['accounts.type.bank']()
									: m['accounts.type.card']()}
						</td>
						<td>{account.currency}</td>
						<td>
							{balances === null
								? '—'
								: formatSignedMoney(balances.get(account.id) ?? 0n, account.currency, getLocale())}
						</td>
						<td>
							{#if row.action !== 'unavailable'}
								<Button
									type="button"
									disabled={row.action !== 'available'}
									aria-label={m['actions.archive_subject']({ subject: account.name })}
									onclick={() => onArchive(account.id)}
								>
									{#if row.action === 'archiving'}
										{m['status.archiving_subject']({ subject: m['nouns.account']({ count: 1 }) })}
									{:else}
										<Icon style="width: 1em; height: 1em;" icon={ArchiveIcon} />
										{m['actions.archive_button']()}
									{/if}
								</Button>
							{:else}
								<span>{m['accounts.archive_restricted']()}</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{/if}
{/if}
