<script lang="ts">
	import { onDestroy } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { useMachine } from '@xstate/svelte'
	import { assign, fromPromise, setup } from 'xstate'
	import {
		createPasskey,
		encryptPasskeySample,
		verifyPasskeySample,
		type PasskeyDescriptor,
		type PasskeySample
	} from '#lib/integrations/passkey.js'
	import { createBankTrace } from '#lib/integrations/diagnostics.js'
	import type { CredentialScope } from '#lib/validation/integrations.js'
	import { m } from '#lib/paraglide/messages.js'
	import PasskeyDemo from '#lib/components/PasskeyDemo.svelte'

	// This page has no provider adapter, relay client, Jazz queries or writes.
	type Base = { text: string; scope: CredentialScope }
	type Created = Base & { stage: 'created'; passkey: PasskeyDescriptor }
	type Encrypted = Base & { stage: 'encrypted'; sample: PasskeySample }
	type Context = { text: string; work: Created | Encrypted | undefined }
	type Event =
		{ type: 'START'; text: string } | { type: 'ENCRYPT' } | { type: 'VERIFY' } | { type: 'RESET' }
	function contextTypes(): Context {
		return { text: '', work: undefined }
	}
	function eventTypes(): Event {
		return { type: 'RESET' }
	}
	const trace = createBankTrace('workflow', crypto.randomUUID(), 'passkey-demo')
	const machine = setup({
		types: { context: contextTypes(), events: eventTypes() },
		actors: {
			create: fromPromise(
				async ({ input, signal }: { input: string; signal: AbortSignal }): Promise<Created> => {
					const scope = {
						ownerId: crypto.randomUUID(),
						organizationId: crypto.randomUUID(),
						connectionId: crypto.randomUUID()
					}
					const passkey = await createPasskey(scope, signal, m['passkey_demo.title'](), trace)
					return { stage: 'created', text: input, scope, passkey }
				}
			),
			encrypt: fromPromise(
				async ({ input, signal }: { input: Created; signal: AbortSignal }): Promise<Encrypted> => {
					const sample = await encryptPasskeySample(
						input.scope,
						input.passkey,
						signal,
						trace,
						input.text
					)
					return { stage: 'encrypted', text: input.text, scope: input.scope, sample }
				}
			),
			verify: fromPromise(async ({ input, signal }: { input: Encrypted; signal: AbortSignal }) => {
				// Discard the returned sealing function: no key or credential is saved.
				await verifyPasskeySample(input.scope, input.sample, signal, trace, input.text)
			})
		}
	}).createMachine({
		id: 'passkey-demo',
		initial: 'idle',
		context: contextTypes(),
		on: { RESET: { target: '.idle', actions: assign({ text: '', work: undefined }) } },
		states: {
			idle: {
				on: {
					START: {
						target: 'creating',
						guard: ({ event }) => Boolean(event.text.trim()),
						actions: assign({ text: ({ event }) => event.text })
					}
				}
			},
			creating: {
				invoke: {
					src: 'create',
					input: ({ context }) => context.text,
					onDone: {
						target: 'readyToEncrypt',
						actions: assign({ work: ({ event }) => event.output, text: '' })
					},
					onError: {
						target: 'failed',
						actions: [
							({ event }) => trace.failed('create.failed', event.error),
							assign({ text: '', work: undefined })
						]
					}
				}
			},
			readyToEncrypt: { on: { ENCRYPT: 'encrypting' } },
			encrypting: {
				invoke: {
					src: 'encrypt',
					input: ({ context }) => {
						if (context.work?.stage !== 'created') throw new Error('invalid-credential')
						return context.work
					},
					onDone: {
						target: 'readyToVerify',
						actions: assign({ work: ({ event }) => event.output })
					},
					onError: {
						target: 'failed',
						actions: [
							({ event }) => trace.failed('encrypt.failed', event.error),
							assign({ work: undefined })
						]
					}
				}
			},
			readyToVerify: { on: { VERIFY: 'verifying' } },
			verifying: {
				invoke: {
					src: 'verify',
					input: ({ context }) => {
						if (context.work?.stage !== 'encrypted') throw new Error('invalid-credential')
						return context.work
					},
					onDone: { target: 'complete', actions: assign({ work: undefined, text: '' }) },
					onError: {
						target: 'failed',
						actions: [
							({ event }) => trace.failed('verify.failed', event.error),
							assign({ work: undefined })
						]
					}
				}
			},
			complete: {},
			failed: {}
		}
	})
	const { snapshot, send } = useMachine(machine)
	const demoState = fromStore(snapshot)
	$effect(() => {
		trace.log(`view.${demoState.current.value}`)
	})
	onDestroy(() => send({ type: 'RESET' }))
</script>

<svelte:head><title>{m['passkey_demo.title']()} · {m['app.name']()}</title></svelte:head>
<PasskeyDemo
	phase={demoState.current.value}
	onStart={(text) => send({ type: 'START', text })}
	onEncrypt={() => send({ type: 'ENCRYPT' })}
	onVerify={() => send({ type: 'VERIFY' })}
	onReset={() => send({ type: 'RESET' })}
/>
