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
	const feedback = $derived(
		(view.feedbackLabels ?? []).flatMap((meta) =>
			section === 'all' || meta.section === section
				? meta.label({
						view,
						subject,
						reasonText,
						validationMessages,
						successMessage,
						action,
						messages,
						blockedRole
					})
				: []
		)
	)
</script>

{#each feedback as message}
	{#if message.role === 'alert'}
		<div role="alert">
			{#each message.text.split('\u0000') as text}<p>{text}</p>{/each}
		</div>
	{:else}
		<p role={message.role}>{message.text}</p>
	{/if}
{/each}
{#if section !== 'result' && view.canRetryReadiness && onRetryReadiness}
	<Button type="button" onclick={onRetryReadiness}>{m['actions.retry']()}</Button>
{/if}
