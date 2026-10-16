<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	let {
		phase,
		onStart,
		onEncrypt,
		onVerify,
		onReset
	}: {
		phase:
			| 'idle'
			| 'creating'
			| 'readyToEncrypt'
			| 'encrypting'
			| 'readyToVerify'
			| 'verifying'
			| 'complete'
			| 'failed'
		onStart: (text: string) => void
		onEncrypt: () => void
		onVerify: () => void
		onReset: () => void
	} = $props()
	let text = $state('')
</script>

<h1>{m['passkey_demo.title']()}</h1>
<p>{m['passkey_demo.description']()}</p>
<section aria-live="polite" aria-atomic="true">
	{#if phase === 'idle'}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				const value = text
				text = ''
				onStart(value)
			}}
		>
			<label for="passkey-demo-text">{m['passkey_demo.text']()}</label>
			<input id="passkey-demo-text" type="text" autocomplete="off" bind:value={text} />
			<p>{m['passkey_demo.start_help']()}</p>
			<button type="submit" disabled={!text.trim()}>{m['bank.setup_start']()}</button>
		</form>
	{:else if phase === 'creating'}
		<h2>{m['bank.setup_creating_title']()}</h2>
		<p>{m['passkey_demo.creating']()}</p>
	{:else if phase === 'readyToEncrypt'}
		<h2>{m['bank.setup_encrypt_title']()}</h2>
		<p>{m['passkey_demo.encrypt_help']()}</p>
		<button type="button" onclick={onEncrypt}>{m['bank.setup_encrypt_action']()}</button>
	{:else if phase === 'encrypting'}
		<h2>{m['bank.setup_encrypt_title']()}</h2>
		<p>{m['passkey_demo.encrypting']()}</p>
	{:else if phase === 'readyToVerify'}
		<h2>{m['bank.setup_verify_title']()}</h2>
		<p>{m['passkey_demo.verify_help']()}</p>
		<button type="button" onclick={onVerify}>{m['bank.setup_verify_action']()}</button>
	{:else if phase === 'verifying'}
		<h2>{m['bank.setup_verify_title']()}</h2>
		<p>{m['passkey_demo.verifying']()}</p>
	{:else if phase === 'complete'}
		<h2>{m['passkey_demo.complete']()}</h2>
		<p>{m['passkey_demo.complete_help']()}</p>
		<button type="button" onclick={onReset}>{m['passkey_demo.restart']()}</button>
	{:else}
		<p role="alert">{m['passkey_demo.failure']()}</p>
		<button type="button" onclick={onReset}>{m['passkey_demo.restart']()}</button>
	{/if}
</section>
{#if phase !== 'idle' && phase !== 'complete' && phase !== 'failed'}
	<button type="button" onclick={onReset}>{m['bank.cancel']()}</button>
{/if}
