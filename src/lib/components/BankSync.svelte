<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import type { Account } from '#lib/schema.js'
	let {
		status,
		setupView,
		onTestEncryption,
		onVerifyDecryption,
		onSaveConnection,
		busy,
		allowed,
		connected,
		accounts,
		providerAccounts,
		mappings,
		outcome,
		onConnect,
		onDiscover,
		onSync,
		onMap,
		onCreateAccount,
		onDisconnect,
		onCancel
	}: {
		status: string
		setupView:
			| 'creating'
			| 'test-encryption'
			| 'encrypting'
			| 'test-decryption'
			| 'verifying'
			| 'save'
			| 'saving'
			| null
		onTestEncryption: () => void
		onVerifyDecryption: () => void
		onSaveConnection: () => void
		busy: boolean
		allowed: boolean
		connected: boolean
		accounts: readonly Account[]
		providerAccounts: readonly { id: string; name: string }[]
		mappings: ReadonlyMap<string, string>
		outcome: string
		onConnect: (token: string) => void
		onDiscover: () => void
		onSync: () => void
		onMap: (providerId: string, accountId: string) => void
		onCreateAccount: (providerId: string) => void
		onDisconnect: () => void
		onCancel: () => void
	} = $props()
	let token = $state('')
</script>

<h1>{m['bank.title']()}</h1>
<p>{m['bank.manual_only']()}</p>
<a href="/settings/passkey-demo">{m['passkey_demo.open']()}</a>
{#if !setupView}<p role="status" aria-live="polite">{status}</p>{/if}
{#if outcome}<p>{outcome}</p>{/if}
{#if !allowed}
	<p>{m['bank.restricted']()}</p>
{:else if setupView}
	<section aria-live="polite" aria-atomic="true">
		{#if setupView === 'creating'}
			<h2>{m['bank.setup_creating_title']()}</h2>
			<p>{m['bank.setup_creating_body']()}</p>
		{:else if setupView === 'test-encryption'}
			<h2>{m['bank.setup_encrypt_title']()}</h2>
			<p>{m['bank.setup_encrypt_body']()}</p>
			<button type="button" onclick={onTestEncryption}>{m['bank.setup_encrypt_action']()}</button>
		{:else if setupView === 'encrypting'}
			<h2>{m['bank.setup_encrypt_title']()}</h2>
			<p>{m['bank.setup_encrypt_waiting']()}</p>
		{:else if setupView === 'test-decryption'}
			<h2>{m['bank.setup_verify_title']()}</h2>
			<p>{m['bank.setup_verify_body']()}</p>
			<button type="button" onclick={onVerifyDecryption}>{m['bank.setup_verify_action']()}</button>
		{:else if setupView === 'verifying'}
			<h2>{m['bank.setup_verify_title']()}</h2>
			<p>{m['bank.setup_verify_waiting']()}</p>
		{:else if setupView === 'save'}
			<h2>{m['bank.setup_save_title']()}</h2>
			<p>{m['bank.setup_save_body']()}</p>
			<button type="button" onclick={onSaveConnection}>{m['bank.setup_save_action']()}</button>
		{:else}
			<h2>{m['bank.setup_saving_title']()}</h2>
			<p>{m['bank.setup_saving_body']()}</p>
		{/if}
	</section>
	<button type="button" onclick={onCancel}>{m['bank.cancel']()}</button>
{:else}
	<form
		onsubmit={(event) => {
			event.preventDefault()
			const value = token
			token = ''
			onConnect(value)
		}}
	>
		<label for="simplefin-token">{m['bank.token']()}</label>
		<input id="simplefin-token" type="text" autocomplete="off" bind:value={token} disabled={busy} />
		<button type="submit" disabled={busy || !token.trim()}
			>{connected ? m['bank.reconnect']() : m['bank.setup_start']()}</button
		>
	</form>
	<p>{m['bank.passkey_help']()}</p>
	{#if connected}
		<button type="button" onclick={onDiscover} disabled={busy || !connected}
			>{m['bank.discover']()}</button
		>
		<button type="button" onclick={onSync} disabled={busy || !connected}>{m['bank.sync']()}</button>
		{#if busy}<button type="button" onclick={onCancel}>{m['bank.cancel']()}</button>{/if}
		<ul>
			{#each providerAccounts as provider (provider.id)}
				{@const linkedAccount = accounts.find(
					(account) => account.id === mappings.get(provider.id)
				)}
				{@const availableAccounts = accounts.filter(
					(account) =>
						!Array.from(mappings).some(
							([otherProviderId, linkedAccountId]) =>
								otherProviderId !== provider.id && linkedAccountId === account.id
						)
				)}
				<li>
					<p>{provider.name}</p>
					{#if linkedAccount}
						<p>{m['bank.linked_account']({ name: linkedAccount.name })}</p>
					{:else if mappings.has(provider.id)}
						<p>{m['bank.mapping_failure']()}</p>
					{:else}
						<button type="button" disabled={busy} onclick={() => onCreateAccount(provider.id)}
							>{m['bank.add_account']({ name: provider.name })}</button
						>
					{/if}
					{#if availableAccounts.some((account) => account.id !== mappings.get(provider.id))}
						<label>
							{m['bank.use_existing']()}
							<select
								value={mappings.get(provider.id) ?? ''}
								disabled={busy}
								onchange={(event) => {
									if (event.currentTarget.value) onMap(provider.id, event.currentTarget.value)
								}}
							>
								<option value="" disabled>{m['bank.choose_existing']()}</option>
								{#each availableAccounts as account (account.id)}<option value={account.id}
										>{account.name}</option
									>{/each}
							</select>
						</label>
					{/if}
				</li>
			{/each}
		</ul>
		<button type="button" onclick={onDisconnect} disabled={busy || !connected}
			>{m['bank.disconnect']()}</button
		>
	{/if}
	<p>{m['bank.recovery']()}</p>
{/if}
