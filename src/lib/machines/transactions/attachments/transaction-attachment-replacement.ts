import { assign, fromPromise, setup, stateIn, or, type OutputFrom } from 'xstate'
import { PersistedWriteRejectedError } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	isTransactionAttachmentType
} from '#lib/domain/transaction-attachments.js'

type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
export type AttachmentReplacementInput = {
	db: Db
	transaction: { id: string; accountId: string; organizationId: string }
	attachment: { id: string; fileId: string }
	file: Pick<File, 'name' | 'type' | 'size'>
	bytes: Uint8Array
}
export type AttachmentReplacementOutput = {
	outcome: 'replaced' | 'conflict' | 'failed' | 'cancelled' | 'closed'
	settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
}
type Event = { type: 'CANCEL' | 'SHUTDOWN' }
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing attachment replacement resource')
	return value
}
const open = fromPromise(async ({ input }: { input: Db }) => input.beginTransaction())
const read = fromPromise(
	async ({ input }: { input: { tx: Transaction; request: AttachmentReplacementInput } }) => {
		const { tx, request } = input
		const [attachment, transaction, file] = await Promise.all([
			tx.one(
				app.transactionAttachments.where({
					id: request.attachment.id,
					transactionId: request.transaction.id
				}),
				{ tier: 'local' }
			),
			tx.one(app.transactions.where({ id: request.transaction.id }), { tier: 'local' }),
			tx.one(app.files.where({ id: request.attachment.fileId }), { tier: 'local' })
		])
		return { attachment, transaction, file }
	}
)
const stage = fromPromise(
	async ({ input }: { input: { tx: Transaction; request: AttachmentReplacementInput } }) => {
		const { tx, request } = input
		const file = tx.insert(app.files, {
			transactionId: request.transaction.id,
			fileName: request.file.name,
			mimeType: request.file.type,
			sizeBytes: request.bytes.byteLength
		})
		const partBytes = 256 * 1024
		for (let offset = 0; offset < request.bytes.byteLength; offset += partBytes) {
			const data = new Uint8Array(request.bytes.subarray(offset, offset + partBytes))
			tx.insert(app.fileParts, {
				fileId: file.id,
				partIndex: offset / partBytes,
				sizeBytes: data.byteLength,
				data
			})
		}
		tx.update(app.transactionAttachments, request.attachment.id, { fileId: file.id })
		return file.id
	}
)
const commit = fromPromise(async ({ input }: { input: Transaction }) => input.commit())
const settle = fromPromise(({ input }: { input: OutputFrom<typeof commit> }) =>
	input.wait({ tier: 'local' })
)
const rollback = fromPromise(({ input }: { input: Transaction }) => input.rollback())
type Context = {
	request: AttachmentReplacementInput
	tx: Transaction | undefined
	records: OutputFrom<typeof read> | undefined
	write: OutputFrom<typeof commit> | undefined
	settlement: AttachmentReplacementOutput['settlement'] | 'rejected'
	problem: 'conflict' | 'failed' | undefined
	result: AttachmentReplacementOutput | undefined
}
function settlement(context: Context): AttachmentReplacementOutput['settlement'] {
	return context.settlement === 'rejected' ? 'notStarted' : context.settlement
}

/** Atomically stages replacement bytes and the existing attachment link, retaining old files. */
export const transactionAttachmentReplacementMachine = setup<
	Context,
	Event,
	{
		open: typeof open
		read: typeof read
		stage: typeof stage
		commit: typeof commit
		settle: typeof settle
		rollback: typeof rollback
	},
	{},
	{},
	{ closing: undefined; cancelling: undefined; interrupted: undefined },
	never,
	string,
	AttachmentReplacementInput,
	AttachmentReplacementOutput
>({
	actors: { open, read, stage, commit, settle, rollback },
	guards: {
		closing: stateIn({ running: { control: 'closed' } }),
		cancelling: stateIn({ running: { control: 'cancelled' } }),
		interrupted: or(['closing', 'cancelling'])
	}
}).createMachine({
	id: 'attachment-replacement',
	initial: 'validating',
	context: ({ input }) => ({
		request: input,
		tx: undefined,
		records: undefined,
		write: undefined,
		settlement: 'notStarted',
		problem: undefined,
		result: undefined
	}),
	output: ({ context }) => context.result ?? { outcome: 'failed', settlement: settlement(context) },
	states: {
		validating: {
			always: [
				{
					guard: ({ context }) =>
						isTransactionAttachmentType(context.request.file.type) &&
						context.request.bytes.byteLength > 0 &&
						context.request.bytes.byteLength <= MAX_TRANSACTION_ATTACHMENT_BYTES &&
						context.request.bytes.byteLength === context.request.file.size,
					target: 'running'
				},
				{ target: 'failed' }
			]
		},
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: { on: { CANCEL: 'cancelled', SHUTDOWN: 'closed' } },
						cancelled: { on: { CANCEL: {}, SHUTDOWN: 'closed' } },
						closed: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.request.db,
								onDone: [
									{
										guard: 'interrupted',
										target: 'rollingBack',
										actions: assign({ tx: ({ event }) => event.output })
									},
									{ target: 'reading', actions: assign({ tx: ({ event }) => event.output }) }
								],
								onError: { target: 'finishing', actions: assign({ problem: () => 'failed' }) }
							}
						},
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
								onDone: {
									target: 'checking',
									actions: assign({ records: ({ event }) => event.output })
								},
								onError: { target: 'rollingBack', actions: assign({ problem: () => 'failed' }) }
							}
						},
						checking: {
							always: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{
									guard: ({ context }) => {
										const { request, records } = context
										return (
											records?.attachment?.fileId === request.attachment.fileId &&
											records.transaction?.accountId === request.transaction.accountId &&
											records.transaction.organizationId === request.transaction.organizationId &&
											records.file?.fileName === request.file.name &&
											records.file.mimeType === request.file.type
										)
									},
									target: 'staging'
								},
								{ target: 'rollingBack', actions: assign({ problem: () => 'conflict' }) }
							]
						},
						staging: {
							invoke: {
								src: 'stage',
								input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
								onDone: [{ guard: 'interrupted', target: 'rollingBack' }, { target: 'committing' }],
								onError: { target: 'rollingBack', actions: assign({ problem: () => 'failed' }) }
							}
						},
						committing: {
							entry: assign({ settlement: () => 'unresolved' }),
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'settling',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										problem: () => 'failed',
										settlement: ({ context, event }) =>
											event.error instanceof PersistedWriteRejectedError
												? 'rejected'
												: context.settlement
									})
								}
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'finishing',
									actions: assign({ settlement: () => 'locallyPersisted' })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										problem: () => 'failed',
										settlement: ({ context, event }) =>
											event.error instanceof PersistedWriteRejectedError
												? 'rejected'
												: context.settlement
									})
								}
							}
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'finishing',
									actions: assign({
										settlement: ({ context, event }) =>
											context.settlement === 'rejected' ||
											(event.output && context.settlement === 'notStarted')
												? 'rejected'
												: 'unresolved'
									})
								},
								onError: {
									target: 'finishing',
									actions: assign({ settlement: () => 'unresolved', problem: () => 'failed' })
								}
							}
						},
						finishing: {
							always: [
								{
									guard: 'closing',
									target: '#attachment-replacement.closed',
									actions: assign({
										result: ({ context }): AttachmentReplacementOutput => ({
											outcome: 'closed',
											settlement: settlement(context)
										})
									})
								},
								{
									guard: 'cancelling',
									target: '#attachment-replacement.cancelled',
									actions: assign({
										result: ({ context }): AttachmentReplacementOutput => ({
											outcome: 'cancelled',
											settlement: settlement(context)
										})
									})
								},
								{
									guard: ({ context }) => context.settlement === 'locallyPersisted',
									target: '#attachment-replacement.replaced',
									actions: assign({
										result: (): AttachmentReplacementOutput => ({
											outcome: 'replaced',
											settlement: 'locallyPersisted'
										})
									})
								},
								{
									guard: ({ context }) =>
										context.problem === 'conflict' && settlement(context) === 'notStarted',
									target: '#attachment-replacement.conflict',
									actions: assign({
										result: (): AttachmentReplacementOutput => ({
											outcome: 'conflict',
											settlement: 'notStarted'
										})
									})
								},
								{
									target: '#attachment-replacement.failed',
									actions: assign({
										result: ({ context }): AttachmentReplacementOutput => ({
											outcome: 'failed',
											settlement: settlement(context)
										})
									})
								}
							]
						}
					}
				}
			}
		},
		replaced: { type: 'final' },
		conflict: { type: 'final' },
		failed: { type: 'final' },
		cancelled: { type: 'final' },
		closed: { type: 'final' }
	}
})
