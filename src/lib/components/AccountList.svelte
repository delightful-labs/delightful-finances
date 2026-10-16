<script lang="ts">
	import { Button, Icon, Table, StatusMessage } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
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
	<StatusMessage variant="success" text={m['accounts.archived']({ name: archivedName })} />
{:else if archiveFailed}
	<StatusMessage variant="error" text={m['errors.archive']({ subject: m['labels.account']() })} />
{/if}

{#if accounts.length === 0}
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
								{#if archiving && archivingAccountId === account.id}
									{m['status.archiving']({ subject: m['labels.account']() })}
								{:else}
									<Icon style="width: 1em; height: 1em;"><ArchiveIcon /></Icon>
									{m['actions.archive']()}
								{/if}
							</Button>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</Table>
{/if}
