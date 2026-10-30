import { assign, fromPromise, setup } from 'xstate'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import { TRANSACTION_ATTACHMENT_TYPES } from '#lib/domain/transaction-attachments.js'

const PART_BYTES = 256 * 1024
type Db = Pick<ReturnType<typeof getDb>, 'all' | 'insert' | 'insertStreaming' | 'delete'>
export type TransactionAttachmentInput = {
	db: Db
	transaction: { id: string; accountId: string; organizationId: string }
	file: Pick<File, 'name' | 'type' | 'size'>
	bytes: Uint8Array
}
export type TransactionAttachmentUploadResult = { outcome: 'attached' | 'failed'; fileId?: string }
type Output = TransactionAttachmentUploadResult
type Context = TransactionAttachmentInput & {
	fileId: string | undefined
	partIndex: number
	partIds: string[]
	output: Output | undefined
}
type Event = { type: 'SHUTDOWN' }

function required(value: string | undefined): string {
	if (value === undefined) throw new Error('Attachment file is not registered')
	return value
}

export const transactionAttachmentUploadMachine = setup({
	types: {
		context: {} as Context,
		events: {} as Event,
		input: {} as TransactionAttachmentInput,
		output: {} as Output
	},
	actors: {
		registerFile: fromPromise(async ({ input }: { input: TransactionAttachmentInput }) => {
			const result = input.db.insert(app.files, {
				transactionId: input.transaction.id,
				fileName: input.file.name,
				mimeType: input.file.type,
				sizeBytes: input.file.size
			})
			return (await result.wait({ tier: 'local' })).id
		}),
		writePart: fromPromise(
			async ({
				input
			}: {
				input: { db: Db; fileId: string; bytes: Uint8Array; partIndex: number }
			}) => {
				const start = input.partIndex * PART_BYTES
				const end = Math.min(input.bytes.byteLength, start + PART_BYTES)
				const chunkBuffer = new ArrayBuffer(end - start)
				new Uint8Array(chunkBuffer).set(input.bytes.subarray(start, end))
				const result = await input.db.insertStreaming(app.fileParts, {
					fileId: input.fileId,
					partIndex: input.partIndex,
					sizeBytes: end - start,
					data: new Blob([chunkBuffer]).stream()
				})
				await result.wait({ tier: 'local' })
				return result.value.id
			}
		),
		linkAttachment: fromPromise(
			async ({ input }: { input: TransactionAttachmentInput & { fileId: string } }) => {
				const result = input.db.insert(app.transactionAttachments, {
					transactionId: input.transaction.id,
					fileId: input.fileId
				})
				await result.wait({ tier: 'local' })
			}
		),
		deletePart: fromPromise(async ({ input }: { input: { db: Db; id: string } }) => {
			const result = input.db.delete(app.fileParts, input.id)
			await result.wait({ tier: 'local' })
		}),
		deleteFile: fromPromise(async ({ input }: { input: { db: Db; id: string } }) => {
			const result = input.db.delete(app.files, input.id)
			await result.wait({ tier: 'local' })
		}),
		readParts: fromPromise(async ({ input }: { input: { db: Db; fileId: string } }) =>
			input.db.all(app.fileParts.where({ fileId: input.fileId }), { tier: ReadTier.LocalFirst })
		)
	}
}).createMachine({
	id: 'transaction-attachment-upload',
	initial: 'validating',
	context: ({ input }) => ({
		...input,
		fileId: undefined,
		partIndex: 0,
		partIds: [],
		output: undefined
	}),
	output: ({ context }) => context.output ?? { outcome: 'failed' },
	states: {
		validating: {
			always: [
				{
					guard: ({ context }) =>
						TRANSACTION_ATTACHMENT_TYPES.some((type) => type === context.file.type),
					target: 'registeringFile'
				},
				{ target: 'failed' }
			]
		},
		registeringFile: {
			invoke: {
				src: 'registerFile',
				input: ({ context }) => context,
				onDone: {
					target: 'writingPart',
					actions: assign({ fileId: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({ output: () => ({ outcome: 'failed' }) })
				}
			}
		},
		writingPart: {
			invoke: {
				src: 'writePart',
				input: ({ context }) => {
					return {
						db: context.db,
						bytes: context.bytes,
						fileId: required(context.fileId),
						partIndex: context.partIndex
					}
				},
				onDone: {
					target: 'checkingParts',
					actions: assign({
						partIds: ({ context, event }) => [...context.partIds, event.output],
						partIndex: ({ context }) => context.partIndex + 1
					})
				},
				onError: 'cleaningParts'
			}
		},
		checkingParts: {
			always: [
				{
					guard: ({ context }) => context.partIndex * PART_BYTES < context.bytes.byteLength,
					target: 'writingPart'
				},
				{ target: 'linkingAttachment' }
			]
		},
		linkingAttachment: {
			invoke: {
				src: 'linkAttachment',
				input: ({ context }) => {
					return { ...context, fileId: required(context.fileId) }
				},
				onDone: {
					target: 'attached',
					actions: assign({
						output: ({ context }) => ({ outcome: 'attached', fileId: required(context.fileId) })
					})
				},
				// A rejected local wait may have created the link. Keep the file intact
				// so a link that did commit cannot point at deleted file data.
				onError: {
					target: 'failed',
					actions: assign({ output: () => ({ outcome: 'failed' }) })
				}
			}
		},
		cleaningParts: {
			initial: 'readingParts',
			onDone: 'failed',
			states: {
				readingParts: {
					invoke: {
						src: 'readParts',
						input: ({ context }) => ({ db: context.db, fileId: required(context.fileId) }),
						onDone: {
							target: 'checking',
							actions: assign({ partIds: ({ event }) => event.output.map(({ id }) => id) })
						},
						onError: '#transaction-attachment-upload.failed'
					}
				},
				checking: {
					always: [
						{ guard: ({ context }) => context.partIds.length > 0, target: 'deletingPart' },
						{ target: 'deletingFile' }
					]
				},
				deletingPart: {
					invoke: {
						src: 'deletePart',
						input: ({ context }) => ({ db: context.db, id: context.partIds.at(-1) ?? '' }),
						onDone: {
							target: 'checking',
							actions: assign({ partIds: ({ context }) => context.partIds.slice(0, -1) })
						},
						onError: {
							target: 'checking',
							actions: assign({ partIds: ({ context }) => context.partIds.slice(0, -1) })
						}
					}
				},
				deletingFile: {
					always: [
						{ guard: ({ context }) => context.fileId !== undefined, target: 'deleting' },
						{ target: 'done' }
					]
				},
				deleting: {
					invoke: {
						src: 'deleteFile',
						input: ({ context }) => ({ db: context.db, id: context.fileId ?? '' }),
						onDone: 'done',
						onError: 'done'
					}
				},
				done: { type: 'final' }
			}
		},
		attached: {
			type: 'final'
		},
		failed: {
			type: 'final',
			entry: assign({ output: () => ({ outcome: 'failed' }) })
		}
	}
})
