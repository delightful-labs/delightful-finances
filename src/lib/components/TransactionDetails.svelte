<script lang="ts">
	import type { Snippet } from 'svelte'
	import { Details } from 'delightful-ui'
	import type { TransactionDetail } from '#lib/schema.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	import Avatar, { type AvatarImage } from './Avatar.svelte'

	type AttributionProfile = AvatarImage & { displayName?: string | null | undefined }

	let {
		transaction,
		form,
		actions,
		creatorProfile,
		editorProfile
	}: {
		transaction: TransactionDetail | undefined | null
		form: Snippet
		actions?: Snippet
		creatorProfile: AttributionProfile | null | undefined
		editorProfile: AttributionProfile | null | undefined
	} = $props()
	const timestamps = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' })
	)
</script>

{#if transaction}
	{@render form()}
	{#if actions}{@render actions()}{/if}
	<Details summary={m['transactions.metadata']()}>
		<dl>
			<dt>{m['transactions.created_by']()}</dt>
			<dd class="attribution">
				<Avatar
					avatarData={creatorProfile?.avatarData}
					avatarMimeType={creatorProfile?.avatarMimeType}
					alt=""
				/>
				<span>{creatorProfile?.displayName || transaction.$createdBy.account}</span>
			</dd>
			<dt>{m['transactions.created_at']()}</dt>
			<dd>
				<time datetime={transaction.$createdAt.toISOString()}
					>{timestamps.format(transaction.$createdAt)}</time
				>
			</dd>
			<dt>{m['transactions.updated_by']()}</dt>
			<dd class="attribution">
				<Avatar
					avatarData={editorProfile?.avatarData}
					avatarMimeType={editorProfile?.avatarMimeType}
					alt=""
				/>
				<span>{editorProfile?.displayName || transaction.$updatedBy.account}</span>
			</dd>
			<dt>{m['transactions.updated_at']()}</dt>
			<dd>
				<time datetime={transaction.$updatedAt.toISOString()}
					>{timestamps.format(transaction.$updatedAt)}</time
				>
			</dd>
		</dl>
	</Details>
{:else}
	<p>{m['transactions.unavailable']()}</p>
	{#if actions}{@render actions()}{/if}
{/if}

<style>
	.attribution {
		display: flex;
		align-items: center;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
