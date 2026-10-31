<script lang="ts">
	import { Button, Details } from 'delightful-ui'
	import type { SyncAttempt, SyncAccountResult } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import { getLocale } from '#lib/paraglide/runtime.js'

	let {
		attempts,
		accounts,
		profiles,
		userId,
		hasEarlier,
		onEarlier
	}: {
		attempts: readonly SyncAttempt[]
		accounts: readonly SyncAccountResult[]
		profiles: readonly { userId: string; displayName: string | null }[]
		userId: string | undefined
		hasEarlier: boolean
		onEarlier: () => void
	} = $props()

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
	function date(value: Date) {
		return new Intl.DateTimeFormat(getLocale(), {
			dateStyle: 'medium',
			timeStyle: 'medium'
		}).format(value)
	}
	function count(value: number | null) {
		return value === null
			? m['bank.log_unknown']()
			: new Intl.NumberFormat(getLocale()).format(value)
	}
	function initiator(id: string) {
		return id === userId
			? m['bank.log_you']()
			: profiles.find((profile) => profile.userId === id)?.displayName ||
					m['bank.log_unknown_user']()
	}
</script>

<section aria-label={m['bank.log_title']()}>
	<h2>{m['bank.log_title']()}</h2>
	{#if attempts.length === 0}
		<p>{m['bank.log_empty']()}</p>
	{/if}
	{#each attempts as attempt (attempt.id)}
		<Details summary={`${date(attempt.startedAt)} — ${outcomes[attempt.outcome]}`}>
			<dl>
				<dt>{m['bank.log_started']()}</dt>
				<dd>
					<time datetime={attempt.startedAt.toISOString()}>{date(attempt.startedAt)}</time>
				</dd>
				<dt>{m['bank.log_finished']()}</dt>
				<dd>{attempt.finishedAt === null ? m['bank.log_unknown']() : date(attempt.finishedAt)}</dd>
				<dt>{m['bank.log_initiator']()}</dt>
				<dd>{initiator(attempt.initiatedBy)}</dd>
				<dt>{m['bank.log_imported']()}</dt>
				<dd>{count(attempt.importedCount)}</dd>
				<dt>{m['bank.log_existing']()}</dt>
				<dd>{count(attempt.existingCount)}</dd>
				<dt>{m['bank.log_omitted']()}</dt>
				<dd>{count(attempt.omittedCount)}</dd>
				<dt>{m['bank.log_settlement']()}</dt>
				<dd>{settlements[attempt.importSettlement]}</dd>
				{#if attempt.failureCode}<dt>{m['bank.log_reason']()}</dt>
					<dd>{reasons[attempt.failureCode]}</dd>{/if}
			</dl>
			{#each accounts.filter((row) => row.attemptId === attempt.id) as account (account.id)}
				<Details summary={`${account.accountName} — ${outcomes[account.outcome]}`}>
					<dl>
						<dt>{m['bank.log_imported']()}</dt>
						<dd>{count(account.importedCount)}</dd>
						<dt>{m['bank.log_existing']()}</dt>
						<dd>{count(account.existingCount)}</dd>
						<dt>{m['bank.log_omitted']()}</dt>
						<dd>{count(account.omittedCount)}</dd>
						{#if account.failureCode}<dt>{m['bank.log_reason']()}</dt>
							<dd>{reasons[account.failureCode]}</dd>{/if}
					</dl>
				</Details>
			{/each}
		</Details>
	{/each}
	{#if hasEarlier}<Button onclick={onEarlier}>{m['bank.log_earlier']()}</Button>{/if}
</section>
