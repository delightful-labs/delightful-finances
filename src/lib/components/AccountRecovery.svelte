<script lang="ts">
	import { Button, Textarea, Checkbox, Dialog } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'

	let {
		phrase,
		revealed,
		savedConfirmed,
		loadError,
		onReveal,
		onHide,
		onConfirm
	}: {
		phrase: string
		revealed: boolean
		savedConfirmed: boolean
		loadError: boolean
		onReveal: () => void
		onHide: () => void
		onConfirm: (value: boolean) => void
	} = $props()
</script>

<p>{m['recovery.description']()}</p>

<Button type="button" onclick={onReveal}>{m['recovery.show']()}</Button>

<Dialog
	heading={m['recovery.heading']()}
	aria-describedby="recovery-warning"
	open={revealed}
	closedby="any"
	oncancel={onHide}
	onclose={onHide}
>
	{#if revealed}
		<div class="recovery-content">
			<p id="recovery-warning">{m['recovery.warning']()}</p>
			<Textarea
				label={m['recovery.phrase_label']()}
				id="account-recovery-phrase"
				rows={4}
				readonly
				value={phrase}
			></Textarea>
			<Checkbox
				label={m['recovery.confirm']()}
				checked={savedConfirmed}
				onchange={(event) => onConfirm(event.currentTarget.checked)}
			/>
			<div class="recovery-controls">
				<Button type="button" disabled={!savedConfirmed} onclick={onHide}>
					{m['recovery.hide']()}
				</Button>
				<Button type="button" onclick={onHide}>{m['recovery.close']()}</Button>
			</div>
		</div>
	{/if}
</Dialog>

{#if loadError}
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
