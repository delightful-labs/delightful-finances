import { assign, fromPromise, setup } from 'xstate'
import { app } from '#lib/schema.js'
import type { CredentialEnvelope, CredentialScope } from '#lib/validation/integrations.js'
import type { Connection, Dependencies } from './types.js'

type Input = {
	scope: CredentialScope
	baselineStatus: Connection['status'] | null
	encrypted: CredentialEnvelope
}
function connectionValues(input: Input) {
	return {
		organizationId: input.scope.organizationId,
		ownerId: input.scope.ownerId,
		accessUrl: '',
		credentialVersion: input.encrypted.version,
		credentialId: input.encrypted.credentialId,
		prfSalt: input.encrypted.prfSalt,
		iv: input.encrypted.iv,
		ciphertext: input.encrypted.ciphertext,
		status: 'active',
		claimedAt: new Date()
	} satisfies Pick<
		Connection,
		| 'organizationId'
		| 'ownerId'
		| 'accessUrl'
		| 'credentialVersion'
		| 'credentialId'
		| 'prfSalt'
		| 'iv'
		| 'ciphertext'
		| 'status'
		| 'claimedAt'
	>
}
type Write = { scope: CredentialScope; values: ReturnType<typeof connectionValues> }
type Context = Input & { values: Write['values']; error: Error | undefined }
type Output =
	{ settlement: 'locallyPersisted'; error: undefined } | { settlement: 'unresolved'; error: Error }

export function createSetupPersistenceMachine({ db }: Dependencies) {
	const actors = {
		insert: fromPromise<void, Write>(async ({ input, signal }) => {
			signal.throwIfAborted()
			await db
				.insert(app.simplefinConnections, input.values, { id: input.scope.connectionId })
				.wait({ tier: 'local' })
		}),
		update: fromPromise<void, Write>(async ({ input, signal }) => {
			signal.throwIfAborted()
			await db
				.update(app.simplefinConnections, input.scope.connectionId, input.values)
				.wait({ tier: 'local' })
		})
	}
	return setup<Context, { type: 'SAVE' }, typeof actors, {}, {}, {}, never, string, Input, Output>({
		actors
	}).createMachine({
		id: 'bank-setup-persistence',
		context: ({ input }) => ({ ...input, values: connectionValues(input), error: undefined }),
		initial: 'choosingWrite',
		output: ({ context }): Output =>
			context.error
				? { settlement: 'unresolved', error: context.error }
				: { settlement: 'locallyPersisted', error: undefined },
		states: {
			choosingWrite: {
				always: [
					{ guard: ({ context }) => context.baselineStatus !== null, target: 'updating' },
					{ target: 'inserting' }
				]
			},
			inserting: {
				invoke: {
					src: 'insert',
					input: ({ context }) => ({ scope: context.scope, values: context.values }),
					onDone: 'saved',
					onError: 'failed'
				}
			},
			updating: {
				invoke: {
					src: 'update',
					input: ({ context }) => ({ scope: context.scope, values: context.values }),
					onDone: 'saved',
					onError: 'failed'
				}
			},
			saved: { type: 'final' },
			failed: { type: 'final', entry: assign({ error: () => new Error('save_failure') }) }
		}
	})
}
