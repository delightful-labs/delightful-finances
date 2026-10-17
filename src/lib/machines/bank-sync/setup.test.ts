import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createActor,
	createMachine,
	fromCallback,
	fromPromise,
	setup,
	toPromise,
	waitFor,
	type ActorRefFrom,
	type InputFrom,
	type OutputFrom
} from 'xstate'
import * as passkeys from '#lib/integrations/passkey.js'
import * as provider from '#lib/integrations/simplefin.js'
import { createBankTrace } from '#lib/integrations/diagnostics.js'
import { createBankSetupMachine } from './setup.js'
import type { Dependencies, LockEvent } from './types.js'
import type { bankLock } from './lock.js'
import type { createPreparationMachine } from './preparation.js'
import type { createSetupPersistenceMachine } from './setup-persist.js'

vi.mock('#lib/integrations/passkey.js', () => ({
	createPasskey: vi.fn(),
	encryptPasskeySample: vi.fn(),
	verifyPasskeySample: vi.fn()
}))
vi.mock('#lib/integrations/simplefin.js', () => ({
	validateSetupToken: vi.fn(),
	claimToken: vi.fn(),
	simplefinDemo: false
}))
vi.mock('#lib/integrations/diagnostics.js', () => ({ createBankTrace: vi.fn() }))

// Keep real setup effect actors; isolate authorization and database children.
vi.mock('./preparation.js', () => ({
	createPreparationMachine: () =>
		success({ ok: true, value: { scope, connection: undefined } } satisfies OutputFrom<
			ReturnType<typeof createPreparationMachine>
		>)
}))
vi.mock('./authorization.js', () => ({
	createAuthorizationMachine: () => success({ error: undefined })
}))
vi.mock('./setup-baseline.js', () => ({
	createSetupBaselineMachine: () => success({ error: undefined })
}))
vi.mock('./setup-persist.js', () => ({
	createSetupPersistenceMachine: () => {
		const save = fromPromise<{ error: undefined }, PersistInput>(persist)
		return setup<
			{ input: PersistInput },
			{ type: 'SAVE' },
			{ save: typeof save },
			{},
			{},
			{},
			never,
			string,
			PersistInput,
			{ error: undefined }
		>({ actors: { save } }).createMachine({
			context: ({ input }) => ({ input }),
			initial: 'saving',
			states: {
				saving: {
					invoke: { src: 'save', input: ({ context }) => context.input, onDone: 'complete' }
				},
				complete: { type: 'final' }
			},
			output: () => ({ error: undefined })
		})
	}
}))
function success<T>(output: T) {
	return createMachine({
		initial: 'complete',
		states: { complete: { type: 'final' } },
		output: () => output
	})
}
type PersistInput = InputFrom<ReturnType<typeof createSetupPersistenceMachine>>
type SetupActor = ActorRefFrom<ReturnType<typeof createBankSetupMachine>>

const scope = { ownerId: 'owner', organizationId: 'organization', connectionId: 'connection' }
const descriptor = { credentialId: 'credential', prfSalt: 'salt' }
const sample = { passkey: descriptor, iv: new Uint8Array(12), ciphertext: new ArrayBuffer(16) }
const envelope = {
	version: 1,
	...scope,
	credentialId: 'credential',
	prfSalt: 'salt',
	iv: 'iv',
	ciphertext: 'encrypted'
} satisfies Awaited<ReturnType<passkeys.CredentialSealer>>
const seal = vi.fn<passkeys.CredentialSealer>()
const failed = vi.fn()
const releaseLock = vi.fn()
const persist = vi.fn<({ input }: { input: PersistInput }) => Promise<{ error: undefined }>>()
const actors: SetupActor[] = []

function start(): SetupActor {
	// Database-bound children are replaced below; no Jazz runtime is opened.
	const db = vi.fn<() => Dependencies['db']>()()
	const machine = createBankSetupMachine({
		db,
		observe: () => ({
			...scope,
			userId: scope.ownerId,
			allowed: true,
			connected: false,
			sessionReady: true,
			connection: undefined
		}),
		passkeyName: () => 'Test'
	}).provide({
		actors: {
			lock: fromCallback<LockEvent, InputFrom<typeof bankLock>>(({ sendBack }) => {
				sendBack({ type: 'LOCK_ACQUIRED' })
				return releaseLock
			})
		}
	})
	const actor = createActor(machine, { input: { token: 'source-token' } }).start()
	actors.push(actor)
	return actor
}

async function advance(actor: ReturnType<typeof start>) {
	await waitFor(actor, (state) => state.matches('readyToEncrypt') || state.status === 'done')
	if (actor.getSnapshot().status === 'done') return
	actor.send({ type: 'TEST_ENCRYPTION' })
	await waitFor(actor, (state) => state.matches('readyToVerify') || state.status === 'done')
	if (actor.getSnapshot().status === 'done') return
	actor.send({ type: 'VERIFY_DECRYPTION' })
	await waitFor(actor, (state) => state.matches('readyToSave') || state.status === 'done')
	if (actor.getSnapshot().status === 'done') return
	actor.send({ type: 'SAVE_CONNECTION' })
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(createBankTrace).mockReturnValue({
		id: 'trace',
		log: vi.fn(),
		failed,
		step: async (_stage, work) => work()
	})
	vi.mocked(provider.validateSetupToken).mockResolvedValue('claim-url')
	vi.mocked(passkeys.createPasskey).mockResolvedValue(descriptor)
	vi.mocked(passkeys.encryptPasskeySample).mockResolvedValue(sample)
	vi.mocked(passkeys.verifyPasskeySample).mockResolvedValue(seal)
	vi.mocked(provider.claimToken).mockResolvedValue('secret-access-url')
	seal.mockResolvedValue(envelope)
	persist.mockResolvedValue({ error: undefined })
})
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})

describe('setup actor failure boundaries', () => {
	it.each([
		{
			stage: 'token',
			effect: () => vi.mocked(provider.validateSetupToken),
			code: 'invalid_setup_token'
		},
		{ stage: 'creation', effect: () => vi.mocked(passkeys.createPasskey), code: 'passkey_failure' },
		{
			stage: 'encryption',
			effect: () => vi.mocked(passkeys.encryptPasskeySample),
			code: 'passkey_failure'
		},
		{
			stage: 'verification',
			effect: () => vi.mocked(passkeys.verifyPasskeySample),
			code: 'passkey_failure'
		},
		{ stage: 'claim', effect: () => vi.mocked(provider.claimToken), code: 'claim_failure' },
		{ stage: 'sealing', effect: () => seal, code: 'save_failure' }
	])(
		'classifies $stage failures in the transition and clears transient material',
		async ({ effect, code }) => {
			const raw = new Error('unsafe provider details: source-token secret-access-url')
			effect().mockRejectedValueOnce(raw)
			const actor = start()
			await advance(actor)
			const result = await toPromise(actor)
			expect(result).toEqual({ kind: 'failed', error: new Error(code) })
			expect(actor.getSnapshot().context).toMatchObject({
				token: undefined,
				accessUrl: undefined,
				base: undefined,
				material: undefined
			})
			expect(failed).toHaveBeenCalledExactlyOnceWith('setup.failed', new Error(code))
			expect(failed).not.toHaveBeenCalledWith('setup.failed', raw)
			expect(releaseLock).toHaveBeenCalled()
			expect(persist).not.toHaveBeenCalled()
			expect(JSON.stringify(result)).not.toContain('secret-access-url')
		}
	)

	it('continues through all explicit steps and persists only the encrypted envelope', async () => {
		const actor = start()
		await advance(actor)
		expect(await toPromise(actor)).toEqual({ kind: 'complete' })
		expect(persist).toHaveBeenCalledOnce()
		expect(persist.mock.calls[0]?.[0]).toMatchObject({ input: { scope, encrypted: envelope } })
		expect(failed).not.toHaveBeenCalled()
		expect(releaseLock).toHaveBeenCalledTimes(4)
		expect(actor.getSnapshot().context).toMatchObject({
			token: undefined,
			accessUrl: undefined,
			material: undefined,
			base: undefined
		})
	})

	it('cancels pending encryption and ignores its late rejection', async () => {
		const pending = Promise.withResolvers<passkeys.PasskeySample>()
		let signal: AbortSignal | undefined
		vi.mocked(passkeys.encryptPasskeySample).mockImplementationOnce(
			(_scope, _passkey, received) => {
				signal = received
				return pending.promise
			}
		)
		const actor = start()
		await waitFor(actor, (state) => state.matches('readyToEncrypt'))
		actor.send({ type: 'TEST_ENCRYPTION' })
		await waitFor(actor, (state) => state.matches({ encrypting: 'encryptingSample' }))
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toEqual({ kind: 'cancelled' })
		expect(signal?.aborted).toBe(true)
		pending.reject(new Error('late secret-access-url'))
		await pending.promise.catch(() => undefined)
		await Promise.resolve()
		expect(actor.getSnapshot().matches('cancelled')).toBe(true)
		expect(failed).not.toHaveBeenCalled()
		expect(passkeys.verifyPasskeySample).not.toHaveBeenCalled()
		expect(provider.claimToken).not.toHaveBeenCalled()
		expect(persist).not.toHaveBeenCalled()
		expect(releaseLock).toHaveBeenCalledTimes(2)
		expect(actor.getSnapshot().context).toMatchObject({
			token: undefined,
			accessUrl: undefined,
			material: undefined,
			base: undefined
		})
	})
})
