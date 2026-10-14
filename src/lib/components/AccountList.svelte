<script lang="ts">
	import { Button } from 'delightful-ui'
	import type { Account } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		accounts,
		archivableAccountIds,
		archiving,
		archivingAccountId,
		archivedName,
		archiveFailed,
		onArchive
	}: {
		accounts: readonly Account[]
		archivableAccountIds: readonly string[]
		archiving: boolean
		archivingAccountId: string | undefined
		archivedName: string | undefined
		archiveFailed: boolean
		onArchive: (accountId: string) => void
	} = $props()
</script>

{#if archivedName}
	<p role="status">{m['accounts.archived']({ name: archivedName })}</p>
{:else if archiveFailed}
	<p role="alert">{m['errors.archive']({ subject: m['labels.account']() })}</p>
{/if}

{#if accounts.length === 0}
	<p>{m['accounts.empty.title']()}</p>
{:else}
	<!-- Future DataTable: docs/delightful-ui-integration.md#tables -->
	<table>
		<thead>
			<tr>
				<th scope="col">{m['labels.account_name']()}</th>
				<th scope="col">{m['labels.account_type']()}</th>
				<th scope="col">{m['labels.currency']()}</th>
				<th scope="col">{m['labels.actions']()}</th>
			</tr>
		</thead>
		<tbody>
			{#each accounts as account (account.id)}
				<tr>
					<td>{account.name}</td>
					<td>
						{account.kind === 'cash'
							? m['accounts.type.cash']()
							: account.kind === 'bank'
								? m['accounts.type.bank']()
								: m['accounts.type.card']()}
					</td>
					<td>{account.currency}</td>
					<td>
						{#if archivableAccountIds.includes(account.id)}
							<Button
								type="button"
								disabled={archiving}
								aria-label={m['actions.archive_account']({ name: account.name })}
								onclick={() => onArchive(account.id)}
							>
								{archiving && archivingAccountId === account.id
									? m['status.archiving']({ subject: m['labels.account']() })
									: m['actions.archive']()}
							</Button>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
