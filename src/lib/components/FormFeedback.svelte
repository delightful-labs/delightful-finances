<script lang="ts" generics="Result, Reason">
	import { Button } from 'delightful-ui'
	import type { ScopedFormView } from '#lib/form-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		view,
		subject,
		reasonText,
		invalidMessage,
		successMessage,
		section = 'all',
		onRetryReadiness,
		action = 'save'
	}: {
		view: ScopedFormView<Result, Reason>
		subject: string
		reasonText: (reason: Reason) => string
		invalidMessage: string
		successMessage?: (value: Result) => string
		section?: 'all' | 'readiness' | 'result'
		onRetryReadiness?: () => void
		action?: 'save' | 'archive'
	} = $props()
</script>

{#if section !== 'result'}
	{#if view.readiness.kind === 'observing'}<p role="status">{m['status.loading']({ subject })}</p>
	{:else if view.readiness.kind === 'blocked'}<p role="status">
			{reasonText(view.readiness.reason)}
		</p>
	{:else if view.readiness.kind === 'failed'}<p role="alert">{m['errors.load']({ subject })}</p>
	{:else if view.readiness.kind === 'closed'}<p role="status">
			{m['forms.session_unavailable']()}
		</p>{/if}
	{#if view.canRetryReadiness && onRetryReadiness}<Button type="button" onclick={onRetryReadiness}
			>{m['actions.retry']()}</Button
		>{/if}
	{#if view.activity.kind === 'settling'}<p role="status">{m['forms.settling']()}</p>{/if}
{/if}
{#if section !== 'readiness' && view.feedback.kind === 'result'}
	{@const result = view.feedback.result}
	{#if result.outcome === 'succeeded'}
		<p role="status">
			{successMessage ? successMessage(result.value) : m['actions.saved']({ subject })}
		</p>
	{:else if result.outcome === 'invalid' || (result.outcome === 'failed' && result.code === 'validationFailed')}<p
			role="alert"
		>
			{invalidMessage}
		</p>
	{:else if result.outcome === 'denied' || result.outcome === 'unavailable'}<p role="alert">
			{reasonText(result.reason)}
		</p>
	{:else if result.outcome === 'scopeChanged' || result.outcome === 'cancelled' || result.outcome === 'closed'}
		<p role="status">
			{result.outcome === 'scopeChanged'
				? m['forms.scope_changed']()
				: result.outcome === 'cancelled'
					? m['forms.cancelled']()
					: m['forms.closed']()}
		</p>
		{#if result.settlement === 'locallyPersisted'}<p role="status">
				{m['forms.interrupted_saved']()}
			</p>
		{:else if result.settlement === 'unknown'}<p role="alert">{m['forms.unknown']()}</p>{/if}
	{:else}
		<p role="alert">
			{action === 'archive' ? m['errors.archive']({ subject }) : m['errors.save']({ subject })}
		</p>
		{#if result.settlement === 'unknown'}<p role="alert">{m['forms.unknown']()}</p>{/if}
	{/if}
{/if}
