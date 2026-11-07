import { z } from 'zod'
import {
	assign,
	fromCallback,
	fromPromise,
	sendTo,
	setup,
	stateIn,
	type SnapshotFrom
} from 'xstate'
import {
	prepareJazzArchiveExport,
	classifyJazzArchiveFailure,
	type JazzArchiveReaderInput,
	type JazzArchiveReaderResult,
	type JazzArchiveExportRequest,
	type JazzArchiveExportResult
} from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import {
	beginFinanceRead,
	clearFinanceRead,
	readFinanceAuthority,
	financeOwner,
	readFinanceMetadata,
	readFinanceRelations,
	readFinanceSources,
	readFinanceFiles,
	readFinanceParts,
	prepareFinanceFiles,
	hasFinanceFile,
	allocateFinanceFile,
	hasFinancePart,
	readFinancePart,
	hashFinanceFile,
	depositFinanceBackup,
	financeBackupProfile
} from '../../backup/workspace.js'

type ReaderContext = { read: JazzArchiveReaderInput; result: JazzArchiveReaderResult }
const fileCompletion = [
	{
		guard: ({ context }: { context: ReaderContext }) => hasFinanceFile(context.read),
		target: 'allocating'
	},
	{
		guard: ({ context }: { context: ReaderContext }) => context.read.mode === 'capture',
		target: 'depositing'
	},
	{ target: 'ready' }
]
const partCompletion = [
	{
		guard: ({ context }: { context: ReaderContext }) => hasFinancePart(context.read),
		target: 'readingPart',
		reenter: true
	},
	{ target: 'hashing' }
]
const leaf = (run: (input: JazzArchiveReaderInput) => void | Promise<void>) =>
	fromPromise<void, JazzArchiveReaderInput>(({ input }) => Promise.resolve().then(() => run(input)))
const readerActors = {
	resources: fromCallback<{ type: string }, JazzArchiveReaderInput>(({ input }) => {
		beginFinanceRead(input)
		const clear = () => clearFinanceRead(input)
		input.signal.addEventListener('abort', clear, { once: true })
		return () => {
			input.signal.removeEventListener('abort', clear)
			clear()
		}
	}),
	authority: leaf(readFinanceAuthority),
	metadata: leaf(readFinanceMetadata),
	relations: leaf((input) =>
		Promise.all([readFinanceRelations(input), readFinanceSources(input)]).then(() => {})
	),
	files: leaf(readFinanceFiles),
	parts: leaf(readFinanceParts),
	validate: leaf(prepareFinanceFiles),
	allocate: leaf(allocateFinanceFile),
	readPart: leaf(readFinancePart),
	hash: leaf(hashFinanceFile),
	deposit: leaf(depositFinanceBackup)
}
/** One finite domain reader, invoked separately for hydration and exclusive capture. */
export const financeBackupReader = setup<
	ReaderContext,
	{ type: 'CANCEL' | 'SHUTDOWN' },
	typeof readerActors,
	{},
	{ fail: undefined },
	{},
	never,
	string,
	JazzArchiveReaderInput,
	JazzArchiveReaderResult
>({
	actors: readerActors,
	actions: {
		fail: assign({
			result: ({ event }): JazzArchiveReaderResult => ({
				outcome: 'failed',
				code:
					'error' in event && event.error instanceof z.ZodError
						? 'invalidData'
						: classifyJazzArchiveFailure('error' in event ? event.error : undefined)
			})
		})
	}
}).createMachine({
	initial: 'authorizing',
	context: ({ input }) => ({ read: input, result: { outcome: 'ready' } }),
	output: ({ context }) => context.result,
	invoke: {
		src: 'resources',
		input: ({ context }) => context.read,
		onError: { target: '.failed', actions: 'fail' }
	},
	on: { CANCEL: { target: '.cancelled' }, SHUTDOWN: { target: '.cancelled' } },
	states: {
		authorizing: {
			invoke: {
				src: 'authority',
				input: ({ context }) => context.read,
				onDone: [
					{ guard: ({ context }) => financeOwner(context.read), target: 'metadata' },
					{ target: 'denied' }
				],
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		metadata: {
			invoke: {
				src: 'metadata',
				input: ({ context }) => context.read,
				onDone: 'relations',
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		relations: {
			invoke: {
				src: 'relations',
				input: ({ context }) => context.read,
				onDone: 'files',
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		files: {
			invoke: {
				src: 'files',
				input: ({ context }) => context.read,
				onDone: 'parts',
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		parts: {
			invoke: {
				src: 'parts',
				input: ({ context }) => context.read,
				onDone: 'validating',
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		validating: {
			invoke: {
				src: 'validate',
				input: ({ context }) => context.read,
				onDone: fileCompletion,
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		allocating: {
			invoke: {
				src: 'allocate',
				input: ({ context }) => context.read,
				onDone: partCompletion,
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		readingPart: {
			invoke: {
				src: 'readPart',
				input: ({ context }) => context.read,
				onDone: partCompletion,
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		hashing: {
			invoke: {
				src: 'hash',
				input: ({ context }) => context.read,
				onDone: fileCompletion,
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		depositing: {
			invoke: {
				src: 'deposit',
				input: ({ context }) => context.read,
				onDone: 'ready',
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		ready: { type: 'final' },
		failed: { type: 'final' },
		denied: {
			type: 'final',
			entry: assign({ result: { outcome: 'failed', code: 'permissionDenied' } })
		},
		cancelled: { type: 'final', entry: assign({ result: { outcome: 'cancelled' } }) }
	}
})

export type BackupObservation = {
	identityId: string | null
	workspaceId: string | null
	membershipId: string | null
	memberUserId: string | null
	ownerId: string | null
	role: string | null
	access: string | null
	sessionReady: boolean
	attached: boolean
	loading: boolean
	failed: boolean
}
function sameObservation(a: BackupObservation, b: BackupObservation) {
	return Object.entries(a).every(([key, value]) =>
		Object.entries(b).some(([other, item]) => key === other && value === item)
	)
}
function eligible(f: BackupObservation) {
	return (
		f.sessionReady &&
		f.attached &&
		!f.loading &&
		!f.failed &&
		Boolean(
			f.identityId &&
			f.workspaceId &&
			f.membershipId &&
			f.identityId === f.ownerId &&
			f.identityId === f.memberUserId &&
			f.role === 'owner'
		)
	)
}
type Options = Omit<
	Parameters<typeof prepareJazzArchiveExport>[0],
	'binding' | 'profile' | 'protection' | 'isCurrent'
> & { environment: string; observe(): BackupObservation }
type Event =
	| { type: 'OBSERVE'; facts: BackupObservation }
	| { type: 'SUBMIT'; protection: 'none' | 'password'; password: string }
	| { type: 'CANCEL' | 'SHUTDOWN' }
type Context = {
	facts: BackupObservation
	generation: number
	request: JazzArchiveExportRequest | undefined
	result: JazzArchiveExportResult | undefined
}
/** Settings owns eligibility and the invoked export lifetime; DLF owns the native resources. */
export function createWorkspaceBackupMachine(options: Options) {
	const actors = {
		export: createJazzArchiveExportMachine(financeBackupReader),
		release: fromPromise<void, { request: JazzArchiveExportRequest | undefined }>(
			({ input }) => input.request?.release() ?? Promise.resolve()
		)
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ observe: undefined; prepare: undefined },
		{ closing: undefined; invalidating: undefined; changed: undefined },
		never,
		string,
		{}
	>({
		actors,
		guards: {
			closing: stateIn({ exporting: 'closing' }),
			invalidating: stateIn({ exporting: 'invalidating' }),
			changed: ({ context, event }) =>
				event.type === 'OBSERVE' && !sameObservation(context.facts, event.facts)
		},
		actions: {
			observe: assign(({ context, event }) =>
				event.type === 'OBSERVE' ? { facts: event.facts, generation: context.generation + 1 } : {}
			),
			prepare: assign(({ context, event, self }) => {
				if (event.type !== 'SUBMIT' || !context.facts.identityId || !context.facts.workspaceId)
					return {}
				const generation = context.generation,
					facts = context.facts,
					identityId = context.facts.identityId,
					workspaceId = context.facts.workspaceId
				try {
					return {
						result: undefined,
						request: prepareJazzArchiveExport({
							db: options.db,
							handoff: options.handoff,
							...(options.limits ? { limits: options.limits } : {}),
							profile: financeBackupProfile,
							protection:
								event.protection === 'none'
									? { kind: 'none' }
									: { kind: 'password', password: event.password },
							binding: {
								applicationId: 'delightful-finances',
								environment: options.environment,
								workspaceId,
								identityId,
								operationId: crypto.randomUUID(),
								generation
							},
							isCurrent: () =>
								self.getSnapshot().context.generation === generation &&
								sameObservation(facts, options.observe())
						})
					}
				} catch {
					return { request: undefined, result: undefined }
				}
			})
		}
	})
	return model.createMachine({
		id: 'finance-workspace-backup',
		initial: 'checking',
		context: () => ({
			facts: options.observe(),
			generation: 0,
			request: undefined,
			result: undefined
		}),
		on: {
			OBSERVE: {
				guard: 'changed',
				target: '.checking',
				actions: ['observe', assign({ result: undefined })]
			},
			SHUTDOWN: '.closed'
		},
		states: {
			checking: {
				always: [
					{ guard: ({ context }) => eligible(context.facts), target: 'editing' },
					{ target: 'unavailable' }
				]
			},
			unavailable: {},
			editing: {
				initial: 'ready',
				on: {
					SUBMIT: [
						{
							guard: ({ event }) =>
								event.protection === 'password' &&
								(!event.password || new TextEncoder().encode(event.password).length > 1024),
							target: '.invalidPassword'
						},
						{ target: 'preparing' }
					]
				},
				states: { ready: {}, invalidPassword: {}, downloaded: {}, failed: {}, cancelled: {} }
			},
			preparing: {
				entry: 'prepare',
				always: [
					{ guard: ({ context }) => context.request !== undefined, target: 'exporting' },
					{ target: 'editing.failed' }
				]
			},
			exporting: {
				initial: 'working',
				invoke: {
					id: 'export',
					src: 'export',
					input: ({ context }) => {
						if (!context.request) throw new Error('Missing backup request')
						return { request: context.request }
					},
					onDone: [
						{
							guard: ({ event }) =>
								event.output.outcome === 'failed' && event.output.code === 'cleanupFailed',
							target: 'releaseBlocked'
						},
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({ request: undefined, result: undefined })
						},
						{
							guard: 'invalidating',
							target: 'checking',
							actions: assign({ request: undefined, result: undefined })
						},
						{
							guard: ({ event }) => event.output.outcome === 'exported',
							target: 'editing.downloaded',
							actions: assign({ request: undefined, result: ({ event }) => event.output })
						},
						{
							guard: ({ event }) => event.output.outcome === 'cancelled',
							target: 'editing.cancelled',
							actions: assign({ request: undefined, result: ({ event }) => event.output })
						},
						{
							target: 'editing.failed',
							actions: assign({ request: undefined, result: ({ event }) => event.output })
						}
					],
					onError: [
						{ guard: 'closing', target: 'releasing.closing' },
						{ guard: 'invalidating', target: 'releasing.changing' },
						{ target: 'releasing.working' }
					]
				},
				on: {
					OBSERVE: {
						guard: 'changed',
						target: '.invalidating',
						actions: ['observe', sendTo('export', { type: 'INVALIDATE' })]
					},
					CANCEL: { target: '.cancelling', actions: sendTo('export', { type: 'CANCEL' }) },
					SHUTDOWN: { target: '.closing', actions: sendTo('export', { type: 'SHUTDOWN' }) }
				},
				states: {
					working: {},
					cancelling: { on: { CANCEL: {} } },
					invalidating: { on: { CANCEL: {} } },
					closing: { on: { OBSERVE: { actions: 'observe' }, CANCEL: {}, SHUTDOWN: {} } }
				}
			},
			releasing: {
				initial: 'working',
				invoke: {
					src: 'release',
					input: ({ context }) => ({ request: context.request }),
					onDone: [
						{
							guard: stateIn({ releasing: 'closing' }),
							target: 'closed',
							actions: assign({ request: undefined, result: undefined })
						},
						{
							guard: stateIn({ releasing: 'changing' }),
							target: 'checking',
							actions: assign({ request: undefined, result: undefined })
						},
						{
							guard: ({ context }) => eligible(context.facts),
							target: 'editing.failed',
							actions: assign({ request: undefined })
						},
						{ target: 'checking', actions: assign({ request: undefined }) }
					],
					onError: 'releaseBlocked'
				},
				on: {
					OBSERVE: { guard: 'changed', target: '.changing', actions: 'observe' },
					SHUTDOWN: '.closing'
				},
				states: {
					working: {},
					changing: {},
					closing: { on: { OBSERVE: { actions: 'observe' }, SHUTDOWN: {} } }
				}
			},
			releaseBlocked: {
				on: { OBSERVE: { actions: 'observe' }, SHUTDOWN: {} }
			},
			closed: { type: 'final', entry: assign({ request: undefined, result: undefined }) }
		}
	})
}
export type WorkspaceBackupSnapshot = SnapshotFrom<ReturnType<typeof createWorkspaceBackupMachine>>
export type BackupMessage =
	| 'preparing'
	| 'downloaded'
	| 'cancelled'
	| 'permissionDenied'
	| 'dataChanged'
	| 'failed'
	| 'password'
	| undefined
export function selectWorkspaceBackup(snapshot: WorkspaceBackupSnapshot): {
	editable: boolean
	canDownload: boolean
	canCancel: boolean
	canReload: boolean
	message: BackupMessage
	alert: boolean
} {
	const busy = snapshot.matches('exporting') || snapshot.matches('releasing'),
		editing = snapshot.matches('editing'),
		result = snapshot.context.result
	const message: BackupMessage = snapshot.matches('releaseBlocked')
		? 'failed'
		: busy
			? 'preparing'
			: snapshot.matches({ editing: 'downloaded' })
				? 'downloaded'
				: snapshot.matches({ editing: 'cancelled' })
					? 'cancelled'
					: snapshot.matches({ editing: 'invalidPassword' })
						? 'password'
						: snapshot.matches({ editing: 'failed' })
							? result?.outcome === 'failed' && result.code === 'permissionDenied'
								? 'permissionDenied'
								: result?.outcome === 'failed' && result.code === 'sourceChanged'
									? 'dataChanged'
									: 'failed'
							: snapshot.matches('unavailable') && !snapshot.context.facts.loading
								? 'permissionDenied'
								: undefined
	return {
		editable: editing,
		canDownload: editing,
		canCancel: snapshot.matches({ exporting: 'working' }),
		canReload: snapshot.matches('releaseBlocked'),
		message,
		alert:
			message === 'failed' ||
			message === 'permissionDenied' ||
			message === 'dataChanged' ||
			message === 'password'
	}
}
