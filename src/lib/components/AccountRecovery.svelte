<script lang="ts">
	import { Button, Textarea, Checkbox, Dialog } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'

	import type { RecoveryPhraseView } from '#lib/recovery-phrase-contract.js'
	let {
		view,
		onReveal,
		onHide,
		onConfirm
	}: {
		view: RecoveryPhraseView
		onReveal: () => void
		onHide: () => void
		onConfirm: (value: boolean) => void
	} = $props()
</script>

<p>{m['recovery.description']()}</p>

<Button
	type="button"
	disabled={view.kind === 'revealing' || view.kind === 'closed'}
	onclick={onReveal}>{m['actions.show_subject']({ subject: m['login.recovery_phrase']() })}</Button
>

<Dialog
	heading={m['labels.subject_recovery']({ subject: m['nouns.account']({ count: 1 }) })}
	aria-describedby="recovery-warning"
	open={view.kind === 'revealed'}
	closedby="any"
	oncancel={onHide}
	onclose={onHide}
>
	{#if view.kind === 'revealed'}
		<div class="recovery-content">
			<p id="recovery-warning">{m['recovery.warning']()}</p>
			<Textarea
				label={m['recovery.phrase_label']()}
				id="account-recovery-phrase"
				rows={4}
				readonly
				value={view.phrase}
			></Textarea>
			<Checkbox
				label={m['recovery.confirm']()}
				checked={view.confirmation === 'confirmed'}
				onchange={(event) => onConfirm(event.currentTarget.checked)}
			/>
			<div class="recovery-controls">
				<Button type="button" disabled={view.confirmation !== 'confirmed'} onclick={onHide}>
					{m['recovery.hide']()}
				</Button>
				<Button type="button" onclick={onHide}>{m['actions.close']()}</Button>
			</div>
		</div>
	{/if}
</Dialog>

{#if view.kind === 'failed'}
	<p role="alert">{m['recovery.error']()}</p>
{/if}

<style>
	.recovery-content {
		display: grid;
		gap: var(--dui-space-sm, 1rem);
	}

	.recovery-content p {
		margin: 0;
	}

	.recovery-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
