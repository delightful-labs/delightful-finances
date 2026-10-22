<script lang="ts">
	import Icon from './AppIcon.svelte'
	import { Button, Table, StatusMessage } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type { AccountArchiveView } from '#lib/machines/account-archive.js'
	import { m } from '#lib/paraglide/messages.js'

	let { view, onArchive }: { view: AccountArchiveView; onArchive: (accountId: string) => void } =
		$props()
	const feedbackText = $derived(
		view.feedback?.outcome === 'succeeded'
			? m['actions.archived']({ subject: m['labels.account'](), name: view.feedback.request.name })
			: view.feedback?.settlement === 'locallyPersisted'
				? m['accounts.archive_interrupted_saved']()
				: view.feedback?.outcome === 'scopeChanged'
					? m['accounts.archive_scope_changed']()
					: view.feedback?.outcome === 'denied'
						? m['accounts.archive_restricted']()
						: m['errors.archive']({ subject: m['labels.account']() })
	)
</script>

{#if view.kind === 'sessionUnavailable'}
	<p role="status">{m['accounts.archive_session_unavailable']()}</p>
{:else if view.kind === 'loading'}
	<StatusMessage
		variant="loading"
		text={m['status.loading']({ subject: m['labels.accounts']() })}
	/>
{:else if view.kind === 'selectWorkspace'}
	<p>{m['workspace.select_workspace']()}</p>
{:else if view.kind === 'loadFailed'}
	<StatusMessage variant="error" text={m['errors.load']({ subject: m['labels.accounts']() })} />
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
		<Table caption={m['labels.accounts']()}>
			<thead>
				<tr>
					<th scope="col">{m['labels.account_name']()}</th>
					<th scope="col">{m['labels.account_type']()}</th>
					<th scope="col">{m['labels.currency']()}</th>
					<th scope="col">{m['labels.actions']()}</th>
				</tr>
			</thead>
			<tbody>
				{#each view.rows as row (row.account.id)}
					{@const account = row.account}
					<tr>
						<td>{account.name}</td>
						<td>
							{account.kind === 'cash'
								? m['labels.cash']()
								: account.kind === 'bank'
									? m['accounts.type.bank']()
									: m['accounts.type.card']()}
						</td>
						<td>{account.currency}</td>
						<td>
							{#if row.action !== 'unavailable'}
								<Button
									type="button"
									disabled={row.action !== 'available'}
									aria-label={m['actions.archive']({ name: account.name })}
									onclick={() => onArchive(account.id)}
								>
									{#if row.action === 'archiving'}
										{m['status.archiving']({ subject: m['labels.account']() })}
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
