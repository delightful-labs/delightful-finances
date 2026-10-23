<script lang="ts">
	import { onMount } from 'svelte'
	import { fromStore, readable } from 'svelte/store'
	import { createActor } from 'xstate'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { RecoveryPhrase } from 'jazz-tools/passphrase'
	import { exportLocalFirstSecret } from 'jazz-tools'
	import {
		createRecoveryPhraseMachine,
		selectRecoveryPhraseView
	} from '#lib/machines/recovery-phrase.js'
	import AccountRecovery from './AccountRecovery.svelte'
	const session = fromStore(getJazzSession())
	const identity = () => ({
		identityId: session.current.account?.id ?? null,
		binding: session.current.account ?? null
	})
	const actor = createActor(
		createRecoveryPhraseMachine(async (captured) => {
			const account = session.current.account
			if (!account || account !== captured.binding || account.id !== captured.identityId)
				throw new Error('Recovery identity changed')
			return RecoveryPhrase.fromSecret(exportLocalFirstSecret(account))
		}),
		{ input: identity() }
	)
	const snapshot = fromStore(
		readable(actor.getSnapshot(), (set) => {
			const subscription = actor.subscribe(set)
			return () => subscription.unsubscribe()
		})
	)
	const view = $derived(selectRecoveryPhraseView(snapshot.current))
	$effect(() => {
		actor.send({ type: 'OBSERVE', identity: identity() })
	})
	onMount(() => {
		actor.start()
		return () => {
			actor.send({ type: 'SHUTDOWN' })
			actor.stop()
		}
	})
</script>

<AccountRecovery
	{view}
	onReveal={() => actor.send({ type: 'REVEAL' })}
	onHide={() => actor.send({ type: 'HIDE' })}
	onConfirm={(value) => actor.send({ type: 'CONFIRM', value })}
/>
