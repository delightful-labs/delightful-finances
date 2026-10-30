import { assign, fromPromise, setup } from 'xstate'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'delete'>
export type TransactionAttachmentRemovalInput = {
	db: Db
	transactionId: string
	attachmentId: string
}
export type TransactionAttachmentRemovalResult = { outcome: 'removed' | 'failed' }
type Output = TransactionAttachmentRemovalResult
type Context = TransactionAttachmentRemovalInput & { output: Output | undefined }

/** Removes the authorized link while retaining file data for shared references and future recovery. */
export const transactionAttachmentRemovalMachine = setup({
	types: {
		context: {} as Context,
		input: {} as TransactionAttachmentRemovalInput,
		output: {} as Output
	},
	actors: {
		readAttachment: fromPromise(async ({ input }: { input: TransactionAttachmentRemovalInput }) =>
			input.db.all(
				app.transactionAttachments.where({
					id: input.attachmentId,
					transactionId: input.transactionId
				}),
				{ tier: ReadTier.LocalFirst }
			)
		),
		deleteLink: fromPromise(async ({ input }: { input: TransactionAttachmentRemovalInput }) => {
			const result = input.db.delete(app.transactionAttachments, input.attachmentId)
			await result.wait({ tier: 'local' })
		})
	},
	actions: {
		fail: assign({ output: () => ({ outcome: 'failed' as const }) }),
		removed: assign({ output: () => ({ outcome: 'removed' as const }) })
	},
	guards: { found: ({ event }) => event.output.length === 1 }
}).createMachine({
	id: 'transaction-attachment-removal',
	initial: 'checkingAttachment',
	context: ({ input }) => ({ ...input, output: undefined }),
	output: ({ context }) => context.output ?? { outcome: 'failed' },
	states: {
		checkingAttachment: {
			invoke: {
				src: 'readAttachment',
				input: ({ context }) => context,
				onDone: [
					{ guard: 'found', target: 'deletingLink' },
					{ target: 'failed', actions: 'fail' }
				],
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		deletingLink: {
			invoke: {
				src: 'deleteLink',
				input: ({ context }) => context,
				onDone: { target: 'removed', actions: 'removed' },
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		removed: { type: 'final' },
		failed: { type: 'final' }
	}
})
