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
		hasEarlier,
		onEarlier
	}: {
		connections: readonly Pick<Connection, 'id' | 'ownerId' | 'claimedAt' | 'status'>[]
		connectionId: string | undefined
		onConnection: (id: string) => void
		attempts: readonly SyncAttempt[]
		accounts: readonly SyncAccountResult[]
		profiles: readonly { userId: string; displayName: string | null }[]
		hasEarlier: boolean
		onEarlier: () => void
	} = $props()

	const connectionStatuses = $derived({
		active: m['bank.succeeded'](),
		error: m['bank.failed'](),
		revoked: m['status.unavailable_subject']({ subject: m['bank.title']() })
	})
	const outcomes = $derived({
		unfinished: m['labels.unspecified'](),
		succeeded: m['bank.succeeded'](),
		partial: m['bank.partial'](),
		failed: m['bank.failed'](),
		cancelled: m['status.cancelled']()
	})
	const settlements = $derived({
		notStarted: m['bank.step_upcoming'](),
		locallyPersisted: m['status.saved'](),
		confirmed: m['bank.log_confirmed'](),
		unresolved: m['bank.log_unresolved']()
	})
	const reasons = $derived({
		authorization: m['developer.unavailable'](),
		passkey: m['bank.unlock_failure'](),
		provider: m['bank.provider_failure'](),
		mapping: m['bank.mapping_failure'](),
		import: m['errors.save_subject']({ subject: m['nouns.transaction']({ count: 2 }) }),
		interrupted: m['bank.other_tab'](),
		unexpected: m['errors.unexpected_title']()
	})
	const dates = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'medium' })
	)
	const numbers = $derived(new Intl.NumberFormat(getLocale()))
	function count(value: number | null) {
		return value === null ? m['labels.unspecified']() : numbers.format(value)
	}
	function initiator(id: string) {
		return (
			profiles.find((profile) => profile.userId === id)?.displayName || m['developer.unavailable']()
		)
	}
</script>

{#snippet counts(result: Pick<SyncAttempt, 'importedCount' | 'existingCount' | 'omittedCount'>)}
	<dt>{m['actions.imported']()}</dt>
	<dd>{count(result.importedCount)}</dd>
	<dt>{m['actions.existing']()}</dt>
	<dd>{count(result.existingCount)}</dd>
	<dt>{m['actions.omitted']()}</dt>
	<dd>{count(result.omittedCount)}</dd>
{/snippet}

{#snippet failure(code: SyncAttempt['failureCode'])}
	{#if code}<dt>{m['labels.description']()}</dt>
		<dd>{reasons[code]}</dd>{/if}
{/snippet}

<section aria-label={m['bank.log_title']()}>
	<h2>{m['bank.log_title']()}</h2>
	{#if connections.length > 0}
		<label>
			{m['bank.title']()}
			<select value={connectionId} onchange={(event) => onConnection(event.currentTarget.value)}>
				{#each connections as connection (connection.id)}
					<option value={connection.id}
						>{`${dates.format(connection.claimedAt)} — ${connection.ownerId ? initiator(connection.ownerId) : m['developer.unavailable']()} (${connectionStatuses[connection.status]})`}</option
					>
				{/each}
			</select>
		</label>
	{/if}
	{#if attempts.length === 0}
		<p>{m['labels.no_subjects_yet']({ subjects: m['bank.log_title']() })}</p>
	{/if}
	{#each attempts as attempt (attempt.id)}
		<Details summary={`${dates.format(attempt.startedAt)} — ${outcomes[attempt.outcome]}`}>
			<dl>
				<dt>{m['labels.start_subject']({ subject: m['nouns.date']({ count: 1 }) })}</dt>
				<dd>
					<time datetime={attempt.startedAt.toISOString()}>{dates.format(attempt.startedAt)}</time>
				</dd>
				<dt>{m['labels.end_subject']({ subject: m['nouns.date']({ count: 1 }) })}</dt>
				<dd>
					{attempt.finishedAt === null
						? m['labels.unspecified']()
						: dates.format(attempt.finishedAt)}
				</dd>
				<dt>{m['transactions.created_by']()}</dt>
				<dd>{initiator(attempt.initiatedBy)}</dd>
				{@render counts(attempt)}
				<dt>{m['labels.status_subject']({ subject: m['bank.title']() })}</dt>
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
	{#if hasEarlier}<Button onclick={onEarlier}
			>{m['labels.more_subjects']({ subjects: m['bank.log_title']() })}</Button
		>{/if}
</section>

<style>
	select {
		max-inline-size: 100%;
	}
</style>
