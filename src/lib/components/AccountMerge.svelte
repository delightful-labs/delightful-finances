<script lang="ts">
	import { Button } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import type { AccountMergePresentation } from '#lib/machines/account-merge/presentation.js'
	import type { MergeDestinationError } from '#lib/schema/account-merge-destination.js'
	let {
		view,
		onCheck,
		onCancel
	}: {
		view: AccountMergePresentation
		onCheck: () => void
		onCancel: () => void
	} = $props()
	const errors = {
		'invalid-input': () => m['account_merge.check_failed'](),
		'session-unavailable': () => m['account_merge.session_unavailable'](),
		'identity-changed': () => m['account_merge.session_changed'](),
		'workspace-changed': () => m['account_merge.session_changed'](),
		'binding-changed': () => m['account_merge.session_changed'](),
		'not-owned-personal': () => m['account_merge.owned_personal_required'](),
		'membership-required': () => m['account_merge.admin_required'](),
		'invalid-observation': () => m['account_merge.check_failed'](),
		'remote-read-failed': () => m['account_merge.remote_failed'](),
		'session-observation-failed': () => m['account_merge.check_failed'](),
		timeout: () => m['account_merge.check_timeout']()
	} satisfies Record<MergeDestinationError, () => string>
</script>

<p>{m['account_merge.description']()}</p>
<p>{m['account_merge.capture_unavailable']()}</p>
<p>{m['account_merge.reconnection_notice']()}</p>
<Button disabled>{m['account_merge.merge_action']()}</Button>

<h2>{m['account_merge.destination_heading']()}</h2>
<p>{m['account_merge.destination_description']()}</p>
{#if view.kind === 'waiting'}
	<p role="status">{m['account_merge.waiting']()}</p>
{:else if view.kind === 'session-unavailable'}
	<p role="status">{m['account_merge.session_unavailable']()}</p>
{:else if view.kind === 'select-workspace'}
	<p role="status">{m['workspace.select_workspace']()}</p>
{:else if view.kind === 'checking'}
	<p role="status">{m['account_merge.checking']()}</p>
	<Button onclick={onCancel}>{m['actions.cancel']()}</Button>
{:else if view.kind === 'available'}
	<Button onclick={onCheck}>{m['account_merge.check_destination']()}</Button>
{:else if view.kind === 'eligible'}
	<p role="status">{m['account_merge.destination_eligible']()}</p>
	<Button onclick={onCheck}>{m['account_merge.check_again']()}</Button>
{:else if view.kind === 'denied'}
	<p role="alert">{errors[view.code]()}</p>
	<Button onclick={onCheck}>{m['account_merge.check_again']()}</Button>
{/if}
