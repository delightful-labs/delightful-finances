<script lang="ts" generics="Result, Reason">
	import { Button } from 'delightful-ui'
	import type { ScopedFormView } from '#lib/form-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		view,
		subject,
		reasonText,
		invalidMessage,
		invalidMessages,
		successMessage,
		section = 'all',
		onRetryReadiness,
		action = 'save',
		messages = {},
		blockedRole = () => 'status'
	}: {
		view: ScopedFormView<Result, Reason>
		subject: string
		reasonText: (reason: Reason) => string
		invalidMessage?: string
		invalidMessages?: readonly string[]
		successMessage?: (value: Result) => string
		section?: 'all' | 'readiness' | 'result'
		onRetryReadiness?: () => void
		action?: 'save' | 'archive'
		messages?: {
			sessionUnavailable?: string
			settling?: string
			scopeChanged?: string
			cancelled?: string
			closed?: string
			interruptedSaved?: string
			unknown?: string
		}
		blockedRole?: (reason: Reason) => 'alert' | 'status'
	} = $props()
	const validationMessages = $derived(
		invalidMessages ?? (invalidMessage === undefined ? [] : [invalidMessage])
	)
</script>

{#if section !== 'result'}
	{#if view.readiness.kind === 'observing'}<p role="status">
			{m['status.loading_subject']({ subject })}
		</p>
	{:else if view.readiness.kind === 'blocked'}<p role={blockedRole(view.readiness.reason)}>
			{reasonText(view.readiness.reason)}
		</p>
	{:else if view.readiness.kind === 'failed'}<p role="alert">
			{m['errors.load_subject']({ subject })}
		</p>
	{:else if view.readiness.kind === 'closed'}<p role="status">
			{messages.sessionUnavailable ?? m['forms.session_unavailable']()}
		</p>{/if}
	{#if view.canRetryReadiness && onRetryReadiness}<Button type="button" onclick={onRetryReadiness}
			>{m['actions.retry']()}</Button
		>{/if}
	{#if view.activity.kind === 'settling'}<p role="status">
			{messages.settling ?? m['forms.settling']()}
		</p>{/if}
{/if}
{#if section !== 'readiness' && view.feedback.kind === 'result'}
	{@const result = view.feedback.result}
	{#if result.outcome === 'succeeded'}
		<p role="status">
			{successMessage ? successMessage(result.value) : m['status.saved_subject']({ subject })}
		</p>
	{:else if result.outcome === 'failed' && result.code === 'completionFailed'}
		<p role="alert">{m['forms.completion_failed']()}</p>
	{:else if result.outcome === 'invalid' || (result.outcome === 'failed' && result.code === 'validationFailed')}<div
			role="alert"
		>
			{#each validationMessages as message}<p>{message}</p>{/each}
		</div>
	{:else if result.outcome === 'denied' || result.outcome === 'unavailable'}<p role="alert">
			{reasonText(result.reason)}
		</p>
	{:else if result.outcome === 'scopeChanged' || result.outcome === 'cancelled' || result.outcome === 'closed'}
		{#if result.settlement === 'locallyPersisted'}<p role="status">
				{messages.interruptedSaved ?? m['forms.interrupted_saved']()}
			</p>
		{:else if result.settlement === 'unknown'}<p role="alert">
				{messages.unknown ?? m['forms.unknown']()}
			</p>{/if}
	{:else}
		<p role="alert">
			{action === 'archive'
				? m['errors.archive_subject']({ subject })
				: m['errors.save_subject']({ subject })}
		</p>
		{#if result.settlement === 'unknown'}<p role="alert">
				{messages.unknown ?? m['forms.unknown']()}
			</p>{/if}
	{/if}
{/if}
