import type { EventObject } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'
import type { ErrorActorEvent } from 'xstate'
import { createBankTrace, type BankTrace } from '#lib/integrations/diagnostics.js'
import {
	createPasskey,
	encryptPasskeySample,
	verifyPasskeySample,
	type PasskeyDescriptor,
	type PasskeySample,
	type CredentialSealer
} from '#lib/integrations/passkey.js'
import { claimToken, validateSetupToken } from '#lib/integrations/simplefin.js'
import type { CredentialEnvelope } from '#lib/validation/integrations.js'
import { createAuthorizationMachine } from './authorization.js'
import { createSetupBaselineMachine, type SetupBaseline } from './setup-baseline.js'
import { createSetupPersistenceMachine } from './setup-persist.js'
import { createPreparationMachine } from './preparation.js'
import { required } from './identity.js'
import { bankLock } from './lock.js'
import { bankEnvironment } from './types.js'
import type {
	AuthorizationRequest,
	BankEvent,
	Dependencies,
	LockEvent,
	RequestIdentity,
	BankViewMeta
} from './types.js'

type Base = SetupBaseline & { trace: BankTrace }
type Material =
	| { passkey: PasskeyDescriptor }
	| { sample: PasskeySample }
	| { seal: CredentialSealer }
	| { encrypted: CredentialEnvelope }
type Input = { token: string }
type Context = {
	identity: RequestIdentity
	credentialFingerprint: string
	token: string | undefined
	base: Base | undefined
	material: Material | undefined
	accessUrl: string | undefined
	error: unknown
	completion: Output | undefined
}
type Output = { kind: 'complete' | 'cancelled' } | { kind: 'failed'; error: unknown }
type Event =
	BankEvent | LockEvent | ErrorActorEvent | { type: 'CREDENTIAL_CHANGED'; fingerprint: string }
function baseFor(context: Context) {
	return required(context.base)
}
function authorizationFor(context: Context): AuthorizationRequest {
	return { scope: baseFor(context).scope, requireConnection: false, expectedCiphertext: undefined }
}

export function createBankSetupMachine(dependencies: Dependencies) {
	const { observe, passkeyName } = dependencies
	const validateToken = fromPromise<void, { token: string; base: Base }>(
		async ({ input, signal }) => {
			signal.throwIfAborted()
			await validateSetupToken(input.token, input.base.trace)
		}
	)
	const create = fromPromise<PasskeyDescriptor, Base>(({ input, signal }) =>
		createPasskey(input.scope, signal, passkeyName(), input.trace)
	)
	const encrypt = fromPromise<PasskeySample, { base: Base; passkey: PasskeyDescriptor }>(
		({ input, signal }) =>
			encryptPasskeySample(input.base.scope, input.passkey, signal, input.base.trace)
	)
	const verify = fromPromise<CredentialSealer, { base: Base; sample: PasskeySample }>(
		({ input, signal }) =>
			verifyPasskeySample(input.base.scope, input.sample, signal, input.base.trace)
	)
	const claim = fromPromise<string, { token: string; base: Base }>(({ input, signal }) =>
		claimToken(input.token, signal, input.base.trace)
	)
	const seal = fromPromise<CredentialEnvelope, { seal: CredentialSealer; accessUrl: string }>(
		({ input, signal }) => input.seal(input.accessUrl, signal)
	)
	const actors = {
		lock: bankLock,
		prepare: createPreparationMachine(dependencies),
		authorize: createAuthorizationMachine(dependencies),
		checkBaseline: createSetupBaselineMachine(dependencies),
		validateToken,
		create,
		encrypt,
		verify,
		claim,
		seal,
		persist: createSetupPersistenceMachine(dependencies)
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		Output,
		EventObject,
		BankViewMeta
	>({
		actors
	})
	const failure = (context: Context, error: unknown) => {
		context.base?.trace.failed('setup.failed', error)
		return { error, accessUrl: undefined, token: undefined }
	}
	const fail = workflow.assign(({ context, event }) =>
		failure(context, 'error' in event ? event.error : new Error('failure'))
	)
	const failWith = (
		code: 'invalid_setup_token' | 'passkey_failure' | 'claim_failure' | 'save_failure'
	) => workflow.assign(({ context }) => failure(context, new Error(code)))
	const clear = workflow.assign({
		base: undefined,
		material: undefined,
		token: undefined,
		accessUrl: undefined
	})
	return workflow.createMachine({
		id: 'bank-setup',
		initial: 'creating',
		context: ({ input }) => ({
			credentialFingerprint: bankEnvironment(observe()).credentialFingerprint,
			identity: { userId: observe().userId, organizationId: observe().organizationId },
			token: input.token,
			base: undefined,
			material: undefined,
			accessUrl: undefined,
			error: undefined,
			completion: undefined
		}),
		output: ({ context }) => required(context.completion),
		on: {
			CANCEL: { target: '.cancelled' },
			CREDENTIAL_CHANGED: {
				guard: ({ context, event }) => context.credentialFingerprint !== event.fingerprint,
				target: '.cancelled'
			}
		},
		states: {
			creating: {
				initial: 'locking',
				meta: { setupView: 'creating', setupStep: 1 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: { target: '#bank-setup.settlingFailure', actions: fail }
				},
				on: { LOCK_FAILED: { target: '#bank-setup.settlingFailure', actions: fail } },
				states: {
					locking: { on: { LOCK_ACQUIRED: 'preparing' } },
					preparing: {
						invoke: {
							src: 'prepare',
							input: ({ context }) => ({ identity: context.identity, requireConnection: false }),
							onDone: [
								{
									guard: ({ event }) => !event.output.ok,
									target: '#bank-setup.settlingFailure',
									actions: assign({
										error: ({ event }) => (event.output.ok ? undefined : event.output.error)
									})
								},
								{
									target: 'authorizingCreate',
									actions: assign({
										base: ({ event }) => {
											const prepared = required(event.output.ok ? event.output.value : undefined)
											return {
												scope: prepared.scope,
												baselineCiphertext: prepared.connection?.ciphertext ?? null,
												baselineStatus: prepared.connection?.status ?? null,
												trace: createBankTrace('CONNECT')
											}
										}
									})
								}
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					authorizingCreate: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'checkingCreateBaseline' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					checkingCreateBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'validatingToken' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					validatingToken: {
						invoke: {
							src: 'validateToken',
							input: ({ context }) => {
								if (!context.token) throw new Error('missing-token')
								return { token: context.token, base: baseFor(context) }
							},
							onDone: 'creatingPasskey',
							onError: {
								target: '#bank-setup.settlingFailure',
								actions: failWith('invalid_setup_token')
							}
						}
					},
					creatingPasskey: {
						invoke: {
							src: 'create',
							input: ({ context }) => baseFor(context),
							onDone: {
								target: '#bank-setup.readyToEncrypt',
								actions: assign({ material: ({ event }) => ({ passkey: event.output }) })
							},
							onError: {
								target: '#bank-setup.settlingFailure',
								actions: failWith('passkey_failure')
							}
						}
					}
				}
			},
			encrypting: {
				initial: 'locking',
				meta: { setupView: 'encrypting', setupStep: 2 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: { target: '#bank-setup.settlingFailure', actions: fail }
				},
				on: { LOCK_FAILED: { target: '#bank-setup.settlingFailure', actions: fail } },
				states: {
					locking: { on: { LOCK_ACQUIRED: 'authorizingEncrypt' } },
					authorizingEncrypt: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'checkingEncryptBaseline' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					checkingEncryptBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'encryptingSample' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					encryptingSample: {
						invoke: {
							src: 'encrypt',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('passkey' in material)) throw new Error('invalid-machine-context')
								return { base: baseFor(context), passkey: material.passkey }
							},
							onDone: {
								target: '#bank-setup.readyToVerify',
								actions: assign({ material: ({ event }) => ({ sample: event.output }) })
							},
							onError: {
								target: '#bank-setup.settlingFailure',
								actions: failWith('passkey_failure')
							}
						}
					}
				}
			},
			verifying: {
				initial: 'locking',
				meta: { setupView: 'verifying', setupStep: 3 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: { target: '#bank-setup.settlingFailure', actions: fail }
				},
				on: { LOCK_FAILED: { target: '#bank-setup.settlingFailure', actions: fail } },
				states: {
					locking: { on: { LOCK_ACQUIRED: 'authorizingVerify' } },
					authorizingVerify: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'checkingVerifyBaseline' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					checkingVerifyBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'verifyingSample' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					verifyingSample: {
						invoke: {
							src: 'verify',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('sample' in material)) throw new Error('invalid-machine-context')
								return { base: baseFor(context), sample: material.sample }
							},
							onDone: {
								target: '#bank-setup.readyToSave',
								actions: assign({ material: ({ event }) => ({ seal: event.output }) })
							},
							onError: {
								target: '#bank-setup.settlingFailure',
								actions: failWith('passkey_failure')
							}
						}
					}
				}
			},
			saving: {
				initial: 'locking',
				meta: { setupView: 'saving', setupStep: 4 },
				invoke: {
					src: 'lock',
					input: ({ context }) => ({
						ownerId: context.identity.userId,
						organizationId: context.identity.organizationId
					}),
					onError: { target: '#bank-setup.settlingFailure', actions: fail }
				},
				on: {
					CREDENTIAL_CHANGED: {},
					LOCK_FAILED: { target: '#bank-setup.settlingFailure', actions: fail }
				},
				states: {
					locking: { on: { LOCK_ACQUIRED: 'authorizingClaim' } },
					authorizingClaim: {
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'checkingClaimBaseline' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					checkingClaimBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: 'claiming' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					},
					claiming: {
						invoke: {
							src: 'claim',
							input: ({ context }) => {
								if (!context.token) throw new Error('missing-token')
								return { token: context.token, base: baseFor(context) }
							},
							onDone: {
								target: 'sealing',
								actions: assign({ accessUrl: ({ event }) => event.output, token: undefined })
							},
							onError: { target: '#bank-setup.settlingFailure', actions: failWith('claim_failure') }
						}
					},
					sealing: {
						meta: { setupView: 'saving', setupStep: 4 },
						invoke: {
							src: 'seal',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('seal' in material)) throw new Error('invalid-machine-context')
								return { seal: material.seal, accessUrl: required(context.accessUrl) }
							},
							onDone: {
								target: 'authorizingSave',
								actions: assign({
									material: ({ event }) => ({ encrypted: event.output }),
									accessUrl: undefined
								})
							},
							onError: { target: '#bank-setup.settlingFailure', actions: failWith('save_failure') }
						}
					},
					authorizingSave: {
						meta: { setupView: 'saving', setupStep: 4 },
						invoke: {
							src: 'authorize',
							input: ({ context }) => authorizationFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: () => new Error('save_failure') })
								},
								{ target: 'checkingSaveBaseline' }
							],
							onError: {
								target: '#bank-setup.settlingFailure',
								actions: assign({ error: () => new Error('save_failure') })
							}
						}
					},
					checkingSaveBaseline: {
						invoke: {
							src: 'checkBaseline',
							input: ({ context }) => baseFor(context),
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: () => new Error('save_failure') })
								},
								{ target: 'persisting' }
							],
							onError: {
								target: '#bank-setup.settlingFailure',
								actions: assign({ error: () => new Error('save_failure') })
							}
						}
					},
					persisting: {
						invoke: {
							src: 'persist',
							input: ({ context }) => {
								const material = required(context.material)
								if (!('encrypted' in material)) throw new Error('invalid-machine-context')
								const base = baseFor(context)
								return {
									scope: base.scope,
									baselineStatus: base.baselineStatus,
									encrypted: material.encrypted
								}
							},
							onDone: [
								{
									guard: ({ event }) => event.output.error !== undefined,
									target: '#bank-setup.settlingFailure',
									actions: assign({ error: ({ event }) => event.output.error })
								},
								{ target: '#bank-setup.complete' }
							],
							onError: { target: '#bank-setup.settlingFailure', actions: fail }
						}
					}
				}
			},
			readyToEncrypt: {
				meta: { setupView: 'test-encryption', setupStep: 2 },
				on: { TEST_ENCRYPTION: 'encrypting' }
			},
			readyToVerify: {
				meta: { setupView: 'test-decryption', setupStep: 3 },
				on: { VERIFY_DECRYPTION: 'verifying' }
			},
			readyToSave: {
				meta: { setupView: 'save', setupStep: 4 },
				on: { SAVE_CONNECTION: 'saving' }
			},
			complete: { type: 'final', entry: [assign({ completion: { kind: 'complete' } }), clear] },
			cancelled: {
				type: 'final',
				entry: [assign({ completion: { kind: 'cancelled' } }), clear]
			},
			settlingFailure: {
				always: [
					{
						guard: ({ context }) =>
							context.error instanceof Error && context.error.message === 'disconnected',
						target: 'cancelled'
					},
					{ target: 'failed' }
				]
			},
			failed: {
				type: 'final',
				entry: [
					assign({ completion: ({ context }) => ({ kind: 'failed', error: context.error }) }),
					clear
				]
			}
		}
	})
}
