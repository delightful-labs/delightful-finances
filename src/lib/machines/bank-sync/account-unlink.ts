import { assign, fromPromise, setup } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createAuthorizationMachine } from './authorization.js'
import { required } from './identity.js'
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
		{ type: 'UNLINK' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		Result<undefined>
	>({ actors }).createMachine({
		id: 'bank-account-unlink',
		context: ({ input }) => ({ ...input, links: [], index: 0, error: undefined }),
		initial: 'loadingLinks',
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
				invoke: {
					src: 'remove',
					input: ({ context }) => required(context.links[context.index]),
					onDone: {
						target: 'choosingLink',
						actions: assign({ index: ({ context }) => context.index + 1 })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			complete: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
