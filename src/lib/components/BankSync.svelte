<script lang="ts">
	import Icon from './AppIcon.svelte'
	import { Button, Details, InputText, LoadingSpinner, Select, Stepper } from 'delightful-ui'
	import SearchIcon from 'tdesign-icons-svg/src/search.svg?component'
	import RefreshIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import WifiNoIcon from 'tdesign-icons-svg/src/wifi-no.svg?component'
	import type { ComponentProps } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	import { bankSetupSteps, type BankStatus, type LastSync } from '#lib/machines/bank-sync/types.js'
	import type { ProviderAccountView } from '#lib/machines/bank-sync/account-options.js'
	let {
		browserOffline,
		status,
		setupView,
		setupStep,
		onTestEncryption,
		onVerifyDecryption,
		onSaveConnection,
		busy,
		loadingProvider,
		showSetup,
		showConnected,
		showRecovery,
		showRestricted,
		showStatus,
		providerAccounts,
		outcome,
		onConnect,
		onDiscover,
		onSync,
		onMap,
		onCreateAccount,
		onDisconnect,
		onCancel
	}: {
		browserOffline: boolean
		status: BankStatus | undefined
		setupStep: number
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
		loadingProvider: boolean
		showSetup: boolean
		showConnected: boolean
		showRecovery: boolean
		showRestricted: boolean
		showStatus: boolean
		providerAccounts: readonly ProviderAccountView[]
		outcome: LastSync | undefined
		onConnect: (token: string) => void
		onDiscover: () => void
		onSync: () => void
		onMap: (providerId: string, accountId: string) => void
		onCreateAccount: (providerId: string) => void
		onDisconnect: () => void
		onCancel: () => void
	} = $props()
	let token = $state('')
	const statusText = $derived(
		status?.key === 'bank.idle'
			? m[status.key]({ step: m[status.stepKey]() })
			: status
				? m[status.key]()
				: ''
	)
	const outcomeText = $derived(
		outcome
			? m['bank.result']({
					time: outcome.time.toLocaleString(),
					outcome: m[outcome.outcomeKey](),
					imported: outcome.imported,
					existing: outcome.existing,
					omitted: outcome.omitted
				})
			: ''
	)
	const setupSteps = $derived<ComponentProps<typeof Stepper>['steps']>(
		bankSetupSteps.map((step, index) => ({
			...step,
			label: m[step.labelKey](),
			status: index < setupStep ? 'completed' : index === setupStep ? 'current' : 'upcoming'
		}))
	)
</script>

{#snippet connectionSetup()}
	{#if browserOffline}
		<div class="offline-message" role="status">
			<Icon icon={WifiNoIcon} style="width: 6rem; height: 6rem;" />
			<p>{m['bank.setup_offline']()}</p>
		</div>
	{:else}
		<div class="setup-flow">
			<Stepper
				steps={setupSteps}
				currentStep={setupSteps[setupStep]?.id ?? 'connect'}
				label={m['bank.setup_progress']()}
				completedLabel={m['bank.step_completed']()}
				upcomingLabel={m['bank.step_upcoming']()}
			/>
			<p>{m['bank.passkey_help']()}</p>
			{#if setupView}
				<section aria-live="polite" aria-atomic="true">
					{#if setupView === 'creating'}
						<h2>{m['bank.setup_creating_title']()}</h2>
						<p>{m['bank.setup_creating_body']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{:else if setupView === 'test-encryption'}
						<h2>{m['bank.setup_encrypt_title']()}</h2>
						<p>{m['bank.setup_encrypt_body']()}</p>
						<Button type="button" onclick={onTestEncryption}
							>{m['bank.setup_encrypt_action']()}</Button
						>
					{:else if setupView === 'encrypting'}
						<h2>{m['bank.setup_encrypt_title']()}</h2>
						<p>{m['bank.setup_encrypt_waiting']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{:else if setupView === 'test-decryption'}
						<h2>{m['bank.setup_verify_title']()}</h2>
						<p>{m['bank.setup_verify_body']()}</p>
						<Button type="button" onclick={onVerifyDecryption}
							>{m['bank.setup_verify_action']()}</Button
						>
					{:else if setupView === 'verifying'}
						<h2>{m['bank.setup_verify_title']()}</h2>
						<p>{m['bank.setup_verify_waiting']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{:else if setupView === 'save'}
						<h2>{m['bank.setup_save_title']()}</h2>
						<p>{m['bank.setup_save_body']()}</p>
						<Button type="button" onclick={onSaveConnection}>{m['bank.setup_save_action']()}</Button
						>
					{:else}
						<h2>{m['bank.setup_saving_title']()}</h2>
						<p>{m['bank.setup_saving_body']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{/if}
				</section>
				<Button type="button" onclick={onCancel}>{m['bank.cancel']()}</Button>
			{:else}
				<form
					onsubmit={(event) => {
						event.preventDefault()
						const value = token
						token = ''
						onConnect(value)
					}}
				>
					<div class="token-field">
						<InputText
							label={m['bank.token']()}
							id="simplefin-token"
							autocomplete="off"
							bind:value={token}
							disabled={busy}
						/>
					</div>
					<Button type="submit" disabled={busy || !token.trim()}>{m['bank.setup_start']()}</Button>
				</form>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="bank-flow">
	<h1>{m['bank.title']()}</h1>
	<p>{m['bank.manual_only']()}</p>
	{#if showStatus && !(browserOffline && status?.key === 'bank.idle')}
		<p role="status" aria-live="polite">{statusText}</p>
	{/if}
	{#if outcomeText}<p>{outcomeText}</p>{/if}
	{#if loadingProvider}<LoadingSpinner role="presentation" aria-hidden="true" />{/if}
	{#if showRestricted}
		<p>{m['bank.restricted']()}</p>
	{:else}
		{#if showSetup}
			{@render connectionSetup()}
		{/if}
		{#if showConnected}
			<Button type="button" onclick={onDiscover} disabled={busy}>
				<Icon style="width: 1em; height: 1em;" icon={SearchIcon} />
				{m['bank.discover']()}
			</Button>

			{#if busy}<Button type="button" onclick={onCancel}>{m['bank.cancel']()}</Button>{/if}
			<ul>
				{#each providerAccounts as provider (provider.id)}
					<li>
						<p>{provider.name}</p>
						{#if provider.mapping.kind === 'linked'}
							<p>{m['bank.linked_account']({ name: provider.mapping.account.name })}</p>
						{:else if provider.mapping.kind === 'broken'}
							<p>{m['bank.mapping_failure']()}</p>
						{:else}
							<Button type="button" disabled={busy} onclick={() => onCreateAccount(provider.id)}
								>{m['bank.add_account']({ name: provider.name })}</Button
							>
						{/if}
						{#if provider.showExisting}
							<Select
								label={m['bank.use_existing']()}
								value={provider.selectedAccountId}
								disabled={busy}
								onchange={(event) => {
									if (event.currentTarget.value) onMap(provider.id, event.currentTarget.value)
								}}
							>
								<option value="" disabled>{m['bank.choose_existing']()}</option>
								{#each provider.availableAccounts as account (account.id)}<option value={account.id}
										>{account.name}</option
									>{/each}
							</Select>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if showConnected}
			<div class="connection-actions">
				<Button
					type="button"
					onclick={onSync}
					disabled={browserOffline || busy}
					aria-describedby={browserOffline ? 'bank-sync-offline' : undefined}
				>
					<Icon style="width: 1em; height: 1em;" icon={RefreshIcon} />
					{m['bank.sync']()}
				</Button>
				<Button type="button" onclick={onDisconnect} disabled={busy}
					>{m['bank.disconnect']()}</Button
				>
			</div>
			{#if browserOffline}
				<p id="bank-sync-offline">{m['bank.sync_offline']()}</p>
			{/if}
			{#if showRecovery}
				<Details summary={m['bank.lost_passkey']()}>
					<div class="setup-flow">
						<p>{m['bank.recovery']()}</p>
						{@render connectionSetup()}
					</div>
				</Details>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.offline-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--dui-space-sm, 1rem);
		text-align: center;
	}

	.bank-flow,
	.setup-flow,
	section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--dui-space-sm, 1rem);
	}

	.bank-flow,
	.setup-flow {
		align-items: stretch;
	}

	.connection-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-space-sm, 1rem);
	}

	form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--dui-space-sm, 1rem);
	}

	.token-field {
		flex: 1 1 16rem;
		min-inline-size: 0;
	}

	h1,
	h2,
	p,
	ul {
		margin: 0;
	}
</style>
