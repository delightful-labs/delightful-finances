import type { FormPresentation } from '../form-contract.js'
import { assign, raise, sendTo, setup, stateIn } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import {
	workspaceCreationOperation,
	type CreationBinding,
	type CreationRequest,
	type CreationResult
} from './workspace-creation-operation.js'
import type { WorkspaceJournalRecord } from './workspace-creation-journal.js'
import type { Organization } from '../schema.js'
type Context = {
	binding: CreationBinding | undefined
	operation: CreationBinding | undefined
	request: CreationRequest
	record: WorkspaceJournalRecord | undefined
	result: CreationResult | undefined
}
export type WorkspaceCreationCommand =
	{ type: 'SUBMIT'; name: string } | { type: 'RETRY' | 'NEW' | 'CANCEL' }
type Event =
	| { type: 'OBSERVED'; binding: CreationBinding | undefined }
	| { type: 'SUBMIT'; name: string }
	| { type: 'REEVALUATE' | 'RETRY' | 'NEW' | 'CANCEL' | 'SHUTDOWN' }
export type WorkspaceCreationView = {
	mode:
		| 'unavailable'
		| 'working'
		| 'editing'
		| 'invalid'
		| 'recovered'
		| 'complete'
		| 'conflict'
		| 'failed'
		| 'unresolved'
	name: string
	workspace: Organization | undefined
	canSubmit: boolean
	canRetry: boolean
	canCreateAnother: boolean
}
export function createWorkspaceCreationMachine(
	db: Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction'>
) {
	return setup<
		Context,
		Event,
		{ operation: typeof workspaceCreationOperation },
		{},
		{},
		{ changed: undefined; replacing: undefined; closing: undefined },
		never,
		string,
		{ binding: CreationBinding | undefined }
	>({
		actors: { operation: workspaceCreationOperation },
		guards: {
			changed: ({ context }) =>
				context.binding?.key !== context.operation?.key ||
				context.binding?.profileId !== context.operation?.profileId,
			replacing: stateIn({ operating: 'replacing' }),
			closing: stateIn({ operating: 'closing' })
		}
	}).createMachine({
		id: 'workspace-creation',
		initial: 'checking',
		context: ({ input }) => ({
			...input,
			operation: undefined,
			request: { mode: 'load' },
			record: undefined,
			result: undefined
		}),
		on: {
			OBSERVED: {
				actions: [assign({ binding: ({ event }) => event.binding }), raise({ type: 'REEVALUATE' })]
			},
			REEVALUATE: { guard: 'changed', target: '.checking' },
			SHUTDOWN: '.closed',
			RETRY: [
				{
					guard: ({ context }) => context.binding !== undefined && context.record !== undefined,
					target: '.operating',
					actions: assign({
						request: ({ context }): CreationRequest => {
							if (!context.record) throw new Error('Missing retry attempt')
							return { mode: 'retry', record: context.record }
						}
					})
				},
				{ target: '.checking' }
			]
		},
		states: {
			checking: {
				entry: assign({ record: undefined, result: undefined, request: { mode: 'load' } }),
				always: [
					{ guard: ({ context }) => context.binding !== undefined, target: 'operating' },
					{ target: 'unavailable' }
				]
			},
			unavailable: { entry: assign({ operation: undefined }) },
			editing: {
				on: {
					SUBMIT: {
						target: 'operating',
						actions: assign({ request: ({ event }) => ({ mode: 'create', name: event.name }) })
					}
				}
			},
			invalid: {
				on: {
					SUBMIT: {
						target: 'operating',
						actions: assign({ request: ({ event }) => ({ mode: 'create', name: event.name }) })
					}
				}
			},
			operating: {
				initial: 'active',
				entry: assign({ operation: ({ context }) => context.binding }),
				on: {
					REEVALUATE: {
						guard: 'changed',
						target: '.replacing',
						actions: sendTo('operation', { type: 'SHUTDOWN' })
					},
					SHUTDOWN: { target: '.closing', actions: sendTo('operation', { type: 'SHUTDOWN' }) },
					CANCEL: { actions: sendTo('operation', { type: 'CANCEL' }) },
					RETRY: {},
					SUBMIT: {},
					NEW: {}
				},
				states: {
					active: {},
					replacing: { on: { REEVALUATE: {}, RETRY: {}, CANCEL: {} } },
					closing: { on: { REEVALUATE: {}, RETRY: {}, CANCEL: {}, SHUTDOWN: {} } }
				},
				invoke: {
					id: 'operation',
					src: 'operation',
					input: ({ context }) => {
						if (!context.operation) throw new Error('Missing creation binding')
						return { db, binding: context.operation, request: context.request }
					},
					onDone: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'checking' },
						{
							target: 'classifying',
							actions: assign({
								result: ({ event }) => event.output,
								record: ({ event }) => event.output.record
							})
						}
					],
					onError: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'checking' },
						{ target: 'unresolved' }
					]
				}
			},
			classifying: {
				always: [
					{ guard: ({ context }) => context.result?.outcome === 'complete', target: 'complete' },
					{ guard: ({ context }) => context.result?.outcome === 'editing', target: 'editing' },
					{ guard: ({ context }) => context.result?.outcome === 'invalid', target: 'invalid' },
					{
						guard: ({ context }) =>
							context.result?.outcome === 'recovered' ||
							(context.result?.outcome === 'cancelled' && context.record !== undefined),
						target: 'recovered'
					},
					{
						guard: ({ context }) =>
							context.result?.outcome === 'cancelled' && context.request.mode === 'load',
						target: 'checking'
					},
					{ guard: ({ context }) => context.result?.outcome === 'cancelled', target: 'editing' },
					{ guard: ({ context }) => context.result?.outcome === 'conflict', target: 'conflict' },
					{
						guard: ({ context }) => context.result?.outcome === 'unresolved',
						target: 'unresolved'
					},
					{ target: 'failed' }
				]
			},
			complete: {
				on: {
					NEW: {
						target: 'operating',
						actions: assign({
							request: ({ context }): CreationRequest => {
								if (!context.record) throw new Error('Missing completed attempt')
								return { mode: 'clear', record: context.record }
							}
						})
					}
				}
			},
			recovered: {},
			conflict: { on: { RETRY: 'checking' } },
			failed: {},
			unresolved: {},
			closed: { type: 'final', on: { OBSERVED: {}, REEVALUATE: {}, RETRY: {}, SHUTDOWN: {} } }
		}
	})
}
export function selectWorkspaceCreationView(
	snapshot: import('xstate').SnapshotFrom<ReturnType<typeof createWorkspaceCreationMachine>>
): WorkspaceCreationView {
	const value = snapshot.value
	const mode =
		typeof value === 'object'
			? 'working'
			: value === 'checking' || value === 'classifying'
				? 'working'
				: value === 'closed'
					? 'unavailable'
					: value
	const replacing =
		snapshot.matches({ operating: 'replacing' }) || snapshot.matches({ operating: 'closing' })
	return {
		mode,
		name: replacing ? '' : (snapshot.context.record?.attempt.workspace.name ?? ''),
		workspace:
			!replacing && snapshot.context.result?.outcome === 'complete'
				? snapshot.context.result.workspace
				: undefined,
		canSubmit: mode === 'editing' || mode === 'invalid',
		canRetry: ['recovered', 'failed', 'unresolved', 'conflict'].includes(mode),
		canCreateAnother: mode === 'complete'
	}
}

export const unavailableWorkspaceCreationView: WorkspaceCreationView = {
	mode: 'unavailable',
	name: '',
	workspace: undefined,
	canSubmit: false,
	canRetry: false,
	canCreateAnother: false
}

/** Public identity-bound projection; consumers do not inspect creation context themselves. */
export function selectWorkspaceCreationReport(
	snapshot: import('xstate').SnapshotFrom<ReturnType<typeof createWorkspaceCreationMachine>>
) {
	return { binding: snapshot.context.binding, view: selectWorkspaceCreationView(snapshot) }
}

/** Adapt the public creation result to the shared modal's presentation contract. */
export function workspaceCreationFormView(view: WorkspaceCreationView): FormPresentation {
	return {
		activity: { kind: view.mode === 'working' ? 'operating' : 'idle' },
		content:
			view.mode === 'complete' ? { kind: 'success', value: view.workspace } : { kind: 'fields' },
		canSubmit: view.canSubmit,
		canReset: view.canSubmit,
		canOpen: view.mode !== 'unavailable',
		fieldsEditable: view.canSubmit,
		draftRevision: 0
	}
}
