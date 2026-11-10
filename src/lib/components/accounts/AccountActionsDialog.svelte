<script lang="ts">
	import { Button, ButtonContent, Dialog, StatusMessage } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import type {
		AccountDeletePresentation,
		AccountPermissionControl
	} from '#lib/contracts/account-presentation-contract.js'
	import { grantNoticeText } from './account-messages.js'
	import type { Account, AccountMembership, OrganizationMember } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import type { ComponentProps, Snippet } from 'svelte'
	import QueryContent from '../shared/QueryContent.svelte'

	let {
		account,
		archiveAction,
		deleteGrantView,
		grantQueries,
		open = $bindable(false),
		onArchive,
		onDeleteGrant,
		permissionControls
	}: {
		account: Account | undefined
		archiveAction: 'available' | 'archiving' | 'disabled' | 'unavailable' | undefined
		deleteGrantView: AccountDeletePresentation & {
			permissions?: readonly AccountPermissionControl[]
			canManage: boolean
			members: readonly OrganizationMember[]
			grants: readonly AccountMembership[]
		}
		grantQueries: ComponentProps<typeof QueryContent>['queries']
		open?: boolean
		onArchive: () => void
		permissionControls?: Snippet | undefined
		onDeleteGrant: (accountId: string, userId: string, canDelete: boolean) => void
	} = $props()
	const accountGrantNotice = $derived(
		deleteGrantView.notice?.accountId === account?.id ? deleteGrantView.notice : undefined
	)
	const accountGrantFeedback = $derived(
		accountGrantNotice ? grantNoticeText(accountGrantNotice) : undefined
	)
	const permissions = $derived(
		(deleteGrantView.permissions === undefined
			? undefined
			: deleteGrantView.permissionAccountId === account?.id
				? deleteGrantView.permissions
				: []) ??
			deleteGrantView.members.map((member) => ({
				id: member.id,
				userId: member.userId,
				canDelete: deleteGrantView.grants.some(
					(grant) =>
						grant.accountId === account?.id && grant.userId === member.userId && grant.canDelete
				)
			}))
	)
	const permissionQueries = $derived(
		deleteGrantView.permissions !== undefined && deleteGrantView.permissionAccountId !== account?.id
			? [{ isLoading: true, error: null }]
			: grantQueries
	)
</script>

<Dialog heading={account?.name ?? m['nouns.account']({ count: 1 })} bind:open closedby="any">
	{#if account}
		<section>
			<h3>{m['labels.actions']()}</h3>
			{#if archiveAction && archiveAction !== 'unavailable'}
				<Button
					type="button"
					disabled={archiveAction !== 'available'}
					aria-busy={archiveAction === 'archiving'}
					onclick={onArchive}
				>
					<ButtonContent
						icon={ArchiveIcon}
						loading={archiveAction === 'archiving'}
						text={archiveAction === 'archiving'
							? m['status.archiving_subject']({ subject: m['nouns.account']({ count: 1 }) })
							: m['actions.archive_button']()}
					/>
				</Button>
			{:else}
				<p>{m['accounts.archive_restricted']()}</p>
			{/if}
			{#if deleteGrantView.canManage}
				<QueryContent
					queries={permissionQueries}
					loadingMessage={m['status.loading_subject']({
						subject: m['nouns.permission']({ count: 2 })
					})}
					errorMessage={m['errors.load_subject']({
						subject: m['nouns.permission']({ count: 2 })
					})}
				>
					<fieldset>
						<legend
							>{m['actions.delete_subject']({
								subject: m['nouns.transaction']({ count: 2 })
							})}</legend
						>
						<p>{m['accounts.delete_access_description']()}</p>
						{#each permissions as member (member.id)}
							<label>
								<input
									type="checkbox"
									checked={member.canDelete}
									disabled={deleteGrantView.busy}
									onchange={(event) =>
										onDeleteGrant(account.id, member.userId, event.currentTarget.checked)}
								/>
								{m['accounts.delete_access_for_name']({ name: member.userId })}
							</label>
						{/each}
					</fieldset>
					{@render permissionControls?.()}
				</QueryContent>
			{:else}
				<p>{m['permissions.manage_restricted']()}</p>
			{/if}
			{#if accountGrantFeedback}
				<StatusMessage
					variant={accountGrantNotice?.variant ?? 'error'}
					text={accountGrantFeedback}
				/>
			{/if}
		</section>
	{/if}
</Dialog>
