<script lang="ts">
	import { Button } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import type { AccountMergeView } from '#lib/machines/account-merge/coordinator.js'
	let {
		view,
		onCapture,
		onSave,
		onDiscard,
		onRetry,
		onCancel
	}: {
		view: AccountMergeView
		onCapture: () => void
		onSave: () => void
		onDiscard: () => void
		onRetry: () => void
		onCancel: () => void
	} = $props()
	const errors = {
		capture: () => m['account_merge.capture_failed'](),
		'invalid-source': () => m['account_merge.invalid_source'](),
		storage: () => m['account_merge.storage_failed'](),
		conflict: () => m['account_merge.copy_conflict']()
	}
</script>

<p>{m['account_merge.description']()}</p>
<p>{m['account_merge.copy_scope']()}</p>
<p>{m['account_merge.reconnection_notice']()}</p>
{#if view.kind === 'available'}
	<Button onclick={onCapture}>{m['account_merge.capture_action']()}</Button>
{:else if view.kind === 'unavailable'}
	<p role="status">{m['account_merge.session_unavailable']()}</p>
	<Button onclick={onRetry}>{m['account_merge.retry_action']()}</Button>
{:else if view.kind === 'capturing' || view.kind === 'working'}
	<p role="status">
		{view.kind === 'capturing' ? m['account_merge.capturing']() : m['account_merge.working']()}
	</p>
	<Button onclick={onCancel}>{m['actions.cancel']()}</Button>
{:else if view.kind === 'review' || view.kind === 'saved'}
	<h2>{view.snapshot.sourceOrganization.name}</h2>
	<dl>
		<dt>{m['account_merge.accounts_count']()}</dt>
		<dd>{view.snapshot.accounts.length}</dd>
		<dt>{m['account_merge.transactions_count']()}</dt>
		<dd>{view.snapshot.transactions.length}</dd>
		<dt>{m['account_merge.categories_count']()}</dt>
		<dd>{view.snapshot.categories.length}</dd>
		<dt>{m['account_merge.tags_count']()}</dt>
		<dd>{view.snapshot.tags.length}</dd>
		<dt>{m['account_merge.connections_count']()}</dt>
		<dd>{view.snapshot.excludedConnectionCount}</dd>
	</dl>
	{#if view.kind === 'review'}
		<p>{m['account_merge.review_copy']()}</p>
		<Button onclick={onSave}>{m['account_merge.save_action']()}</Button>
		<Button onclick={onCancel}>{m['actions.cancel']()}</Button>
	{:else}
		<p role="status">{m['account_merge.copy_saved']()}</p>
		<p>{m['account_merge.import_pending']()}</p>
		<p>{m['account_merge.discard_notice']()}</p>
		<Button onclick={onDiscard}>{m['account_merge.discard_action']()}</Button>
	{/if}
{:else if view.kind === 'failed'}
	<p role="alert">{errors[view.problem]()}</p>
	<Button onclick={onRetry}>{m['account_merge.retry_action']()}</Button>
{/if}
