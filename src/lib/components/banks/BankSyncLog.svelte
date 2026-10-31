<script lang="ts">
	import { Button, Details } from 'delightful-ui'
	import type { SyncAttempt, SyncAccountResult } from '#lib/schema.js'
	import type { Connection } from '#lib/machines/bank-sync/types.js'
	import { m } from '#lib/paraglide/messages.js'
	import { getLocale } from '#lib/paraglide/runtime.js'

	let {
		connections,
		connectionId,
		onConnection,
		attempts,
		accounts,
		profiles,
		userId,
		hasEarlier,
		onEarlier
	}: {
		connections: readonly Pick<Connection, 'id' | 'ownerId' | 'claimedAt' | 'status'>[]
		connectionId: string | undefined
		onConnection: (id: string) => void
		attempts: readonly SyncAttempt[]
		accounts: readonly SyncAccountResult[]
		profiles: readonly { userId: string; displayName: string | null }[]
		userId: string | undefined
		hasEarlier: boolean
		onEarlier: () => void
	} = $props()

	const connectionStatuses = $derived({
		active: m['bank.log_connection_active'](),
		error: m['bank.log_connection_error'](),
		revoked: m['bank.log_connection_revoked']()
	})
	const outcomes = $derived({
		unfinished: m['bank.log_unfinished'](),
		succeeded: m['bank.succeeded'](),
		partial: m['bank.partial'](),
		failed: m['bank.failed'](),
		cancelled: m['bank.log_cancelled']()
	})
	const settlements = $derived({
		notStarted: m['bank.log_notStarted'](),
		locallyPersisted: m['bank.log_locallyPersisted'](),
		confirmed: m['bank.log_confirmed'](),
		unresolved: m['bank.log_unresolved']()
	})
	const reasons = $derived({
		authorization: m['bank.log_reason_authorization'](),
		passkey: m['bank.log_reason_passkey'](),
		provider: m['bank.log_reason_provider'](),
		mapping: m['bank.log_reason_mapping'](),
		import: m['bank.log_reason_import'](),
		interrupted: m['bank.log_reason_interrupted'](),
		unexpected: m['bank.log_reason_unexpected']()
	})
	const dates = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'medium' })
	)
	const numbers = $derived(new Intl.NumberFormat(getLocale()))
	function count(value: number | null) {
		return value === null ? m['bank.log_unknown']() : numbers.format(value)
	}
	function initiator(id: string) {
		return id === userId
			? m['bank.log_you']()
			: profiles.find((profile) => profile.userId === id)?.displayName ||
					m['bank.log_unknown_user']()
	}
</script>

{#snippet counts(result: Pick<SyncAttempt, 'importedCount' | 'existingCount' | 'omittedCount'>)}
	<dt>{m['bank.log_imported']()}</dt>
	<dd>{count(result.importedCount)}</dd>
	<dt>{m['bank.log_existing']()}</dt>
	<dd>{count(result.existingCount)}</dd>
	<dt>{m['bank.log_omitted']()}</dt>
	<dd>{count(result.omittedCount)}</dd>
{/snippet}

{#snippet failure(code: SyncAttempt['failureCode'])}
	{#if code}<dt>{m['bank.log_reason']()}</dt>
		<dd>{reasons[code]}</dd>{/if}
{/snippet}

<section aria-label={m['bank.log_title']()}>
	<h2>{m['bank.log_title']()}</h2>
	<p>{m['bank.log_availability']()}</p>
	{#if connections.length > 0}
		<label>
			{m['bank.log_connection']()}
			<select value={connectionId} onchange={(event) => onConnection(event.currentTarget.value)}>
				{#each connections as connection (connection.id)}
					<option value={connection.id}
						>{m['bank.log_connection_time_owner_status']({
							time: dates.format(connection.claimedAt),
							owner: connection.ownerId
								? initiator(connection.ownerId)
								: m['bank.log_unknown_user'](),
							status: connectionStatuses[connection.status]
						})}</option
					>
				{/each}
			</select>
		</label>
	{/if}
	{#if attempts.length === 0}
		<p>{m['bank.log_empty']()}</p>
	{/if}
	{#each attempts as attempt (attempt.id)}
		<Details summary={`${dates.format(attempt.startedAt)} — ${outcomes[attempt.outcome]}`}>
			<dl>
				<dt>{m['bank.log_started']()}</dt>
				<dd>
					<time datetime={attempt.startedAt.toISOString()}>{dates.format(attempt.startedAt)}</time>
				</dd>
				<dt>{m['bank.log_finished']()}</dt>
				<dd>
					{attempt.finishedAt === null ? m['bank.log_unknown']() : dates.format(attempt.finishedAt)}
				</dd>
				<dt>{m['bank.log_initiator']()}</dt>
				<dd>{initiator(attempt.initiatedBy)}</dd>
				{@render counts(attempt)}
				<dt>{m['bank.log_settlement']()}</dt>
				<dd>{settlements[attempt.importSettlement]}</dd>
				{@render failure(attempt.failureCode)}
			</dl>
			{#each accounts.filter((row) => row.attemptId === attempt.id) as account (account.id)}
				<Details summary={`${account.accountName} — ${outcomes[account.outcome]}`}>
					<dl>
						{@render counts(account)}
						{@render failure(account.failureCode)}
					</dl>
				</Details>
			{/each}
		</Details>
	{/each}
	{#if hasEarlier}<Button onclick={onEarlier}>{m['bank.log_earlier']()}</Button>{/if}
</section>

<style>
	select {
		max-inline-size: 100%;
	}
</style>
