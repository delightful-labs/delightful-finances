<script lang="ts">
	import { Button, StatusMessage } from 'delightful-ui'
	import type { BankSyncControls } from '#lib/bank-sync.js'
	import { m } from '#lib/paraglide/messages.js'
	import Icon from './AppIcon.svelte'
	import SyncIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import AppDrawerContentSection from './AppDrawerContentSection.svelte'
	import PwaUpdateIntegration from './PwaUpdateIntegration.svelte'
	let {
		bankSync,
		browserOffline,
		syncConfigured,
		onNavigate
	}: {
		onNavigate: () => void
		bankSync: BankSyncControls
		syncConfigured: boolean
		browserOffline: boolean
	} = $props()
</script>

<AppDrawerContentSection>
	{#if bankSync.visible}
		<Button
			disabled={browserOffline || bankSync.disabled}
			aria-describedby={browserOffline ? 'sidebar-bank-sync-offline' : undefined}
			onclick={() => {
				onNavigate()
				bankSync.sync()
			}}><Icon navigation icon={SyncIcon} />{m['bank.sync']()}</Button
		>
		{#if browserOffline}
			<p id="sidebar-bank-sync-offline">{m['bank.sync_offline']()}</p>
		{/if}
	{/if}

	<div class="sidebar-status">
		<PwaUpdateIntegration />
		<StatusMessage
			compact
			text={!syncConfigured
				? m['database.local']()
				: browserOffline
					? m['database.offline']()
					: m['database.online']()}
		/>
	</div>
</AppDrawerContentSection>

<style>
	.sidebar-status {
		margin-block-start: auto;
	}
	p {
		margin: 0;
	}
</style>
