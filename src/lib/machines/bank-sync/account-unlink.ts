import { assign, fromPromise, setup, stateIn } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createAuthorizationMachine } from './authorization.js'
import { required } from './identity.js'
import type { MappingInterruption } from './account-write-transaction.js'
import {
	credentialAuthorization,
	type Dependencies,
	type OperationWork,
	type Result
} from './types.js'

type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Input = { work: OperationWork; providerId: string }
type Context = Input & { links: Link[]; index: number; error: unknown }

export function createAccountUnlinkMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		links: fromPromise(({ input }: { input: Input }) =>
			db.all(
				app.simplefinAccountLinks.where({
					organizationId: input.work.scope.organizationId,
					simplefinAccountId: input.providerId
				})
			)
		),
		authorize: createAuthorizationMachine(dependencies),
		remove: fromPromise<void, Link>(async ({ input, signal }) => {
			signal.throwIfAborted()
			await db.delete(app.simplefinAccountLinks, input.id).wait({ tier: 'local' })
		})
	}
	return setup<
		Context,
		{ type: 'UNLINK' } | MappingInterruption,
		typeof actors,
		{},
		{},
		{ isDraining: undefined },
		never,
		string,
		Input,
		Result<undefined>
	>({ actors, guards: { isDraining: stateIn({ removingLink: 'draining' }) } }).createMachine({
		id: 'bank-account-unlink',
		context: ({ input }) => ({ ...input, links: [], index: 0, error: undefined }),
		initial: 'loadingLinks',
		on: {
			CANCEL: { target: '.failed', actions: assign({ error: () => new Error('disconnected') }) },
			SHUTDOWN: { target: '.failed', actions: assign({ error: () => new Error('disconnected') }) }
		},
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			loadingLinks: {
				invoke: {
					src: 'links',
					input: ({ context }) => context,
					onDone: {
						target: 'choosingLink',
						actions: assign({ links: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			choosingLink: {
				always: [
					{ guard: ({ context }) => context.index >= context.links.length, target: 'complete' },
					{ target: 'authorizingRemoval' }
				]
			},
			authorizingRemoval: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.work),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'removingLink' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			removingLink: {
				initial: 'working',
				states: {
					working: {},
					draining: { on: { CANCEL: {}, SHUTDOWN: {} } }
				},
				on: {
					CANCEL: {
						target: '.draining',
						actions: assign({ error: () => new Error('disconnected') })
					},
					SHUTDOWN: {
						target: '.draining',
						actions: assign({ error: () => new Error('disconnected') })
					}
				},
				invoke: {
					src: 'remove',
					input: ({ context }) => required(context.links[context.index]),
					onDone: [
						{ guard: 'isDraining', target: 'failed' },
						{
							target: 'choosingLink',
							actions: assign({ index: ({ context }) => context.index + 1 })
						}
					],
					onError: [
						{ guard: 'isDraining', target: 'failed' },
						{ target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
					]
				}
			},
			complete: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
