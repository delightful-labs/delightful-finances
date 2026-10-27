import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import {
	findInternalTransferCounterparts,
	type InternalTransferCandidate
} from '#lib/domain/internal-transfer.js'
import type { InternalTransfer } from '#lib/schema.js'
import type {
	TransactionEntryObservation,
	TransactionEntryScope,
	TransactionEntryView
} from '#lib/transaction-entry-contract.js'
import type { FormObservation } from '#lib/form-contract.js'
import {
	and,
	assign,
	enqueueActions,
	or,
	raise,
	setup,
	stateIn,
	type EventFrom,
	type SnapshotFrom
} from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'
import {
	createTransactionEditFormOptions,
	sameTransactionEntryScope,
	transactionEntryScope
} from './transaction-entry.js'
import {
	type InternalTransferLinkInput,
	type InternalTransferLinkResult,
	type InternalTransferUnlinkInput,
	type InternalTransferUnlinkResult,
	type InternalTransferDeleteChoice,
	type InternalTransferDeleteInput,
	type InternalTransferDeleteResult,
	type TransferWriteTracking
} from './internal-transfer.js'
import {
	type TransferMutationGateway,
	type TransferMutationRequestInput
} from './internal-transfer-mutation-request.js'
import { createTransferMutationRequestMachine } from './internal-transfer-mutation-request.js'
import type { TransferMutationResult } from './internal-transfer-mutation-owner.js'

export type TransactionEditOptions = ReturnType<typeof createTransactionEditFormOptions>
export type TransactionEditTransferState =
	'unselected' | 'searching' | 'matches' | 'empty' | 'failed' | 'linked' | 'conflicted'
type TransferObservation = {
	rows: readonly InternalTransferCandidate[]
	scope: TransactionEntryScope
	scopeGeneration: number
	linkedTransactionIds: readonly string[]
	linkedTransfer: InternalTransfer | null
	linked: boolean
	conflicted: boolean
	searchEnabled: boolean
	pendingUnlink: boolean
	loading: boolean
	failed: boolean
}

const observingFormView: TransactionEntryView = {
	readiness: { kind: 'observing' },
	content: { kind: 'fields' },
	activity: { kind: 'idle' },
	feedback: { kind: 'none' },
	canSubmit: false,
	canReset: false,
	canOpen: false,
	canCancel: false,
	fieldsEditable: false,
	canRetryReadiness: false,
	draftRevision: 0
}
const failedFormView: TransactionEntryView = {
	...observingFormView,
	readiness: { kind: 'failed' }
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transaction edit data')
	return value
}

function linkResult(result: TransferMutationResult): InternalTransferLinkResult {
	return result.operation === 'link'
		? result.result
		: { outcome: 'unavailable', settlement: 'unresolved' }
}

function unlinkResult(result: TransferMutationResult): InternalTransferUnlinkResult {
	return result.operation === 'unlink'
		? result.result
		: { outcome: 'unavailable', settlement: 'unresolved' }
}

function deleteResult(result: TransferMutationResult): InternalTransferDeleteResult {
	return result.operation === 'delete'
		? result.result
		: { outcome: 'unavailable', settlement: 'unresolved' }
}

export function createTransactionEditMachine(
	options: TransactionEditOptions,
	db: ReturnType<typeof getDb>,
	trackTransferWrite: (write: TransferWriteTracking) => void,
	mutationGateway: TransferMutationGateway
) {
	const formMachine = createScopedFormMachine(options)
	type FormEvent = EventFrom<typeof formMachine>
	type LinkActorInput = InternalTransferLinkInput
	type UnlinkActorInput = InternalTransferUnlinkInput
	type Context = {
		observation: FormObservation<TransactionEntryObservation>
		scopeGeneration: number
		formView: TransactionEntryView
		transferObservation: TransferObservation | undefined
		candidates: readonly InternalTransferCandidate[]
		selectedCandidateId: string | null
		writableCandidateIds: ReadonlySet<string>
		linkedTransfer: InternalTransfer | null
		unlinkWritable: boolean
		linkInput: LinkActorInput | undefined
		linkResult: InternalTransferLinkResult | null
		unlinkInput: UnlinkActorInput | undefined
		unlinkResult: InternalTransferUnlinkResult | null
		deleteInput: InternalTransferDeleteInput | undefined
		deleteResult: InternalTransferDeleteResult | null
	}
	type Event =
		| { type: 'OBSERVE'; observation: TransactionEntryObservation }
		| { type: 'FORM'; event: FormEvent }
		| { type: 'ENABLE_SEARCH' }
		| { type: 'DISABLE_SEARCH' }
		| { type: 'TRANSFER_OBSERVATION'; observation: TransferObservation }
		| { type: 'SELECT_COUNTERPART'; candidateId: string }
		| { type: 'LINK_COUNTERPART'; candidateId: string }
		| { type: 'UNLINK_TRANSFER' }
		| { type: 'DELETE_LINKED_TRANSFER'; choice: InternalTransferDeleteChoice }
		| { type: 'SCOPE_CHANGED' }
		| { type: 'LINK_SUCCEEDED' }
		| { type: 'UNLINK_SUCCEEDED' }
		| { type: 'SHUTDOWN' }
	const mutationRequest = createTransferMutationRequestMachine(mutationGateway)
	const actors = {
		form: formMachine,
		linkOperation: mutationRequest,
		unlinkOperation: mutationRequest,
		deleteOperation: mutationRequest
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{
			scopedForm: 'form'
			linkOperation: 'linkOperation'
			unlinkOperation: 'unlinkOperation'
			deleteOperation: 'deleteOperation'
		},
		{},
		{
			conflictedObservation: undefined
			linkedObservation: undefined
			searchDisabledObservation: undefined
			searchLoading: undefined
			searchFailed: undefined
			currentTransferObservation: undefined
			workflowActive: undefined
			transferSearchActive: undefined
			canDisableSearch: undefined
			canForwardForm: undefined
			formSubmit: undefined
			hasCandidates: undefined
			canLink: undefined
			canUnlink: undefined
			canDelete: undefined
			selectCounterpart: undefined
			transferMatches: undefined
			transferLinked: undefined
			linkIsClosing: undefined
			linkIsReplacing: undefined
			unlinkIsClosing: undefined
			unlinkIsReplacing: undefined
			deleteIsClosing: undefined
			deleteIsReplacing: undefined
		},
		never,
		string,
		TransactionEntryObservation
	>({
		actors,
		guards: {
			conflictedObservation: ({ event }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.conflicted,
			linkedObservation: ({ context, event }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.linked,
			searchDisabledObservation: ({ event }) =>
				event.type === 'TRANSFER_OBSERVATION' && !event.observation.searchEnabled,
			searchLoading: ({ event }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.loading,
			searchFailed: ({ event }) =>
				event.type === 'TRANSFER_OBSERVATION' && event.observation.failed,
			currentTransferObservation: ({ context, event }) =>
				event.type === 'TRANSFER_OBSERVATION' &&
				sameTransactionEntryScope(
					transactionEntryScope(context.observation.facts),
					event.observation.scope
				) &&
				context.scopeGeneration === event.observation.scopeGeneration,
			workflowActive: stateIn({ running: { lifecycle: 'active' } }),
			transferSearchActive: or([
				stateIn({ running: { transfer: 'searching' } }),
				stateIn({ running: { transfer: 'matches' } }),
				stateIn({ running: { transfer: 'empty' } }),
				stateIn({ running: { transfer: 'failed' } })
			]),
			canDisableSearch: ({ context }) =>
				context.linkInput === undefined &&
				context.unlinkInput === undefined &&
				context.deleteInput === undefined,
			canForwardForm: ({ context }) =>
				context.linkInput === undefined &&
				context.unlinkInput === undefined &&
				context.deleteInput === undefined,
			formSubmit: ({ event }) => event.type === 'FORM' && event.event.type === 'SUBMIT',
			hasCandidates: ({ context, event }) =>
				event.type === 'TRANSFER_OBSERVATION' &&
				transferCandidates(context.observation.facts, event.observation).length > 0,
			canLink: ({ context, event }) =>
				event.type === 'LINK_COUNTERPART' &&
				context.selectedCandidateId === event.candidateId &&
				context.candidates.some(({ id }) => id === event.candidateId) &&
				context.writableCandidateIds.has(event.candidateId) &&
				context.formView.fieldsEditable &&
				Boolean(context.observation.facts.identityId) &&
				Boolean(context.observation.facts.organizationId) &&
				Boolean(context.observation.facts.binding) &&
				!context.observation.facts.transaction?.internalTransferId,
			canUnlink: ({ context }) =>
				Boolean(
					context.linkedTransfer &&
					context.unlinkWritable &&
					context.formView.fieldsEditable &&
					(context.observation.facts.transaction?.internalTransferId ===
						context.linkedTransfer.id ||
						context.transferObservation?.pendingUnlink) &&
					context.observation.facts.identityId &&
					context.observation.facts.organizationId &&
					context.observation.facts.binding
				),
			canDelete: ({ context, event }) =>
				event.type === 'DELETE_LINKED_TRANSFER' &&
				Boolean(
					context.linkedTransfer &&
					context.formView.fieldsEditable &&
					context.observation.facts.transaction &&
					(context.observation.facts.transaction.id ===
						context.linkedTransfer.expenseTransactionId ||
						context.observation.facts.transaction.id ===
							context.linkedTransfer.incomeTransactionId) &&
					(event.choice.kind === 'both' ||
						event.choice.transactionId === context.observation.facts.transaction.id) &&
					context.observation.facts.identityId &&
					context.observation.facts.organizationId &&
					context.observation.facts.binding &&
					context.deleteInput === undefined &&
					context.linkInput === undefined &&
					context.unlinkInput === undefined
				),
			selectCounterpart: ({ context, event }) =>
				event.type === 'SELECT_COUNTERPART' &&
				context.candidates.some(({ id }) => id === event.candidateId) &&
				context.linkInput === undefined &&
				context.unlinkInput === undefined &&
				context.deleteInput === undefined,
			transferMatches: stateIn({ running: { transfer: 'matches' } }),
			transferLinked: stateIn({ running: { transfer: 'linked' } }),
			linkIsClosing: stateIn({ running: { link: { operating: 'closing' } } }),
			linkIsReplacing: stateIn({ running: { link: { operating: 'replacing' } } }),
			unlinkIsClosing: stateIn({ running: { unlink: { operating: 'closing' } } }),
			unlinkIsReplacing: stateIn({ running: { unlink: { operating: 'replacing' } } }),
			deleteIsClosing: stateIn({ running: { deletion: { operating: 'closing' } } }),
			deleteIsReplacing: stateIn({ running: { deletion: { operating: 'replacing' } } })
		}
	})
	const updateTransferObservation = workflow.assign(({ context, event }) => {
		if (event.type !== 'TRANSFER_OBSERVATION') return {}
		const candidates = transferCandidates(context.observation.facts, event.observation)
		return {
			transferObservation: event.observation,
			candidates,
			selectedCandidateId: candidates.some(({ id }) => id === context.selectedCandidateId)
				? context.selectedCandidateId
				: (candidates[0]?.id ?? null),
			linkedTransfer: event.observation.linkedTransfer,
			unlinkResult: event.observation.pendingUnlink
				? {
						outcome: 'recoveryRequired',
						transferId: required(event.observation.linkedTransfer?.id),
						settlement: 'locallyPersisted'
					}
				: !event.observation.linked && context.unlinkResult?.outcome === 'recoveryRequired'
					? null
					: event.observation.linked && context.unlinkResult?.outcome === 'succeeded'
						? null
						: context.unlinkResult,
			writableCandidateIds: writableCandidates(context.observation.facts, candidates),
			unlinkWritable: writableLinkedTransfer(
				context.observation.facts,
				event.observation.linkedTransfer
			)
		}
	})
	const clearTransferResults = workflow.assign({
		transferObservation: undefined,
		candidates: [],
		selectedCandidateId: null,
		writableCandidateIds: new Set<string>(),
		linkedTransfer: null,
		unlinkWritable: false,
		linkResult: null,
		unlinkResult: null,
		deleteInput: undefined,
		deleteResult: null
	})
	const storeObservation = workflow.enqueueActions(({ context, event, enqueue }) => {
		if (event.type !== 'OBSERVE') return
		const changed = !sameTransactionEntryScope(
			transactionEntryScope(context.observation.facts),
			transactionEntryScope(event.observation)
		)
		enqueue.assign(({ context }) => {
			const transferObservation = changed ? undefined : context.transferObservation
			const candidates = transferObservation
				? transferCandidates(event.observation, transferObservation)
				: []
			return {
				observation: {
					revision: context.observation.revision + 1,
					facts: event.observation
				},
				scopeGeneration: context.scopeGeneration + (changed ? 1 : 0),
				transferObservation,
				candidates,
				selectedCandidateId: candidates.some(({ id }) => id === context.selectedCandidateId)
					? context.selectedCandidateId
					: (candidates[0]?.id ?? null),
				writableCandidateIds: writableCandidates(event.observation, candidates),
				linkedTransfer: transferObservation?.linkedTransfer ?? null,
				unlinkWritable: writableLinkedTransfer(
					event.observation,
					transferObservation?.linkedTransfer ?? null
				),
				...(changed ? { linkResult: null, unlinkResult: null, deleteResult: null } : {})
			}
		})
		enqueue.sendTo('scopedForm', { type: 'OBSERVE', observation: event.observation })
		if (changed) enqueue.raise({ type: 'SCOPE_CHANGED' })
	})
	const resetLinkRequest = workflow.assign(({ context, event }) => {
		if (event.type !== 'LINK_COUNTERPART') return {}
		const source = context.observation.facts.transaction
		const candidate = context.candidates.find(({ id }) => id === context.selectedCandidateId)
		const identityId = context.observation.facts.identityId
		const organizationId = context.observation.facts.organizationId
		if (!source || !candidate || !identityId || !organizationId) return {}
		return {
			linkInput: {
				db,
				identityId,
				organizationId,
				expenseTransactionId: source.kind === 'expense' ? source.id : candidate.id,
				incomeTransactionId: source.kind === 'income' ? source.id : candidate.id,
				trackWrite: trackTransferWrite
			},
			linkResult: null
		}
	})
	const resetUnlinkRequest = workflow.assign(({ context, event }) => {
		if (event.type !== 'UNLINK_TRANSFER' || !context.linkedTransfer) return {}
		const identityId = context.observation.facts.identityId
		const organizationId = context.observation.facts.organizationId
		if (!identityId || !organizationId) return {}
		return {
			unlinkInput: {
				db,
				identityId,
				organizationId,
				transferId: context.linkedTransfer.id,
				expenseTransactionId: context.linkedTransfer.expenseTransactionId,
				incomeTransactionId: context.linkedTransfer.incomeTransactionId,
				trackWrite: trackTransferWrite
			},
			unlinkResult: null
		}
	})
	const resetDeleteRequest = workflow.assign(({ context, event }) => {
		if (event.type !== 'DELETE_LINKED_TRANSFER' || !context.linkedTransfer) return {}
		const identityId = context.observation.facts.identityId
		const organizationId = context.observation.facts.organizationId
		if (!identityId || !organizationId) return {}
		return {
			deleteInput: {
				db,
				identityId,
				organizationId,
				transferId: context.linkedTransfer.id,
				expenseTransactionId: context.linkedTransfer.expenseTransactionId,
				incomeTransactionId: context.linkedTransfer.incomeTransactionId,
				choice: event.choice,
				trackWrite: trackTransferWrite
			},
			deleteResult: null
		}
	})
	const stopForm = workflow.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.scopedForm
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
	})
	const stopLinkOperation = workflow.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.linkOperation
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
	})
	const stopUnlinkOperation = workflow.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.unlinkOperation
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
	})
	const stopDeleteOperation = workflow.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.deleteOperation
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
	})
	const logic = workflow.createMachine({
		id: 'transaction-edit-form',
		context: ({ input }) => ({
			observation: { revision: 0, facts: input },
			scopeGeneration: 0,
			formView: observingFormView,
			transferObservation: undefined,
			candidates: [],
			selectedCandidateId: null,
			writableCandidateIds: new Set<string>(),
			linkedTransfer: null,
			unlinkWritable: false,
			linkInput: undefined,
			linkResult: null,
			unlinkInput: undefined,
			unlinkResult: null,
			deleteInput: undefined,
			deleteResult: null
		}),
		initial: 'running',
		states: {
			closed: { type: 'final' },
			running: {
				type: 'parallel',
				onDone: '#transaction-edit-form.closed',
				on: {
					OBSERVE: { guard: 'workflowActive', actions: storeObservation },
					SELECT_COUNTERPART: {
						guard: and(['workflowActive', 'transferSearchActive', 'selectCounterpart']),
						actions: assign({ selectedCandidateId: ({ event }) => event.candidateId })
					},
					FORM: [
						{
							guard: and(['workflowActive', 'formSubmit', 'canForwardForm']),
							actions: workflow.enqueueActions(({ event, enqueue }) => {
								if (event.type === 'FORM') enqueue.sendTo('scopedForm', event.event)
							})
						},
						{ guard: and(['workflowActive', 'formSubmit']) },
						{
							guard: and(['workflowActive', 'canForwardForm']),
							actions: workflow.enqueueActions(({ event, enqueue }) => {
								if (event.type === 'FORM') enqueue.sendTo('scopedForm', event.event)
							})
						}
					]
				},
				states: {
					lifecycle: {
						initial: 'active',
						states: {
							active: { on: { SHUTDOWN: 'closed' } },
							closed: { type: 'final' }
						}
					},
					form: {
						initial: 'attached',
						states: {
							attached: {
								invoke: {
									id: 'scopedForm',
									src: 'form',
									input: ({ context }) => context.observation.facts,
									onSnapshot: {
										actions: assign({
											formView: ({ event }) => selectScopedFormView(event.snapshot, options)
										})
									},
									onDone: 'formClosed',
									onError: {
										target: 'formClosed',
										actions: assign({ formView: failedFormView })
									}
								},
								on: { SHUTDOWN: { actions: stopForm } }
							},
							formClosed: { type: 'final' }
						}
					},
					transfer: {
						initial: 'unselected',
						on: {
							SHUTDOWN: '.transferClosed',
							SCOPE_CHANGED: { target: '.unselected', actions: clearTransferResults },
							TRANSFER_OBSERVATION: [
								{
									guard: and(['currentTransferObservation', 'conflictedObservation']),
									target: '.conflicted',
									actions: updateTransferObservation
								},
								{
									guard: and(['currentTransferObservation', 'linkedObservation']),
									target: '.linked',
									actions: updateTransferObservation
								},
								{
									guard: and([
										'currentTransferObservation',
										'transferSearchActive',
										'searchLoading'
									]),
									target: '.searching',
									actions: updateTransferObservation
								},
								{
									guard: and([
										'currentTransferObservation',
										'transferSearchActive',
										'searchFailed'
									]),
									target: '.failed',
									actions: updateTransferObservation
								},
								{
									guard: and([
										'currentTransferObservation',
										'transferSearchActive',
										'hasCandidates'
									]),
									target: '.matches',
									actions: updateTransferObservation
								},
								{
									guard: and(['currentTransferObservation', 'transferSearchActive']),
									target: '.empty',
									actions: updateTransferObservation
								},
								{
									guard: and(['currentTransferObservation', 'searchDisabledObservation']),
									target: '.unselected',
									actions: updateTransferObservation
								}
							],
							LINK_SUCCEEDED: { target: '.linked' },
							UNLINK_SUCCEEDED: { target: '.matches' }
						},
						states: {
							unselected: { on: { ENABLE_SEARCH: 'searching' } },
							conflicted: {},
							searching: {
								on: { DISABLE_SEARCH: { guard: 'canDisableSearch', target: 'unselected' } }
							},
							matches: {
								on: { DISABLE_SEARCH: { guard: 'canDisableSearch', target: 'unselected' } }
							},
							empty: {
								on: { DISABLE_SEARCH: { guard: 'canDisableSearch', target: 'unselected' } }
							},
							failed: {
								on: { DISABLE_SEARCH: { guard: 'canDisableSearch', target: 'unselected' } }
							},
							linked: {},
							transferClosed: { type: 'final' }
						}
					},
					link: {
						initial: 'idle',
						states: {
							idle: {
								on: {
									LINK_COUNTERPART: {
										guard: and(['canLink', 'transferMatches']),
										target: 'operating.active',
										actions: resetLinkRequest
									},
									SCOPE_CHANGED: { actions: clearTransferResults },
									SHUTDOWN: 'linkClosed'
								}
							},
							operating: {
								initial: 'active',
								invoke: {
									id: 'linkOperation',
									src: 'linkOperation',
									input: ({
										context
									}): Extract<TransferMutationRequestInput, { operation: 'link' }> => ({
										workspaceId: required(context.linkInput).organizationId,
										operation: 'link',
										input: required(context.linkInput)
									}),
									onDone: [
										{
											guard: 'linkIsClosing',
											target: '#transaction-edit-form.running.link.linkClosed'
										},
										{
											guard: 'linkIsReplacing',
											target: '#transaction-edit-form.running.link.idle',
											actions: assign({ linkInput: undefined, linkResult: null })
										},
										{
											guard: ({ event }) =>
												event.output.operation === 'link' &&
												event.output.result.outcome === 'succeeded',
											target: '#transaction-edit-form.running.link.succeeded',
											actions: [
												assign({
													linkResult: ({ event }) => linkResult(event.output),
													linkInput: undefined
												}),
												raise({ type: 'LINK_SUCCEEDED' })
											]
										},
										{
											target: '#transaction-edit-form.running.link.rejected',
											actions: assign({
												linkResult: ({ event }) => linkResult(event.output),
												linkInput: undefined
											})
										}
									],
									onError: [
										{
											guard: 'linkIsClosing',
											target: '#transaction-edit-form.running.link.linkClosed'
										},
										{
											guard: 'linkIsReplacing',
											target: '#transaction-edit-form.running.link.idle',
											actions: assign({ linkInput: undefined, linkResult: null })
										},
										{
											target: '#transaction-edit-form.running.link.rejected',
											actions: assign({
												linkResult: ({ event }): InternalTransferLinkResult => ({
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: event.error
												}),
												linkInput: undefined
											})
										}
									]
								},
								states: {
									active: {
										on: {
											SCOPE_CHANGED: {
												target: 'replacing',
												actions: stopLinkOperation
											},
											SHUTDOWN: {
												target: 'closing',
												actions: stopLinkOperation
											}
										}
									},
									closing: {},
									replacing: {
										on: { SHUTDOWN: { target: 'closing', actions: stopLinkOperation } }
									}
								}
							},
							succeeded: {
								on: {
									LINK_COUNTERPART: {
										guard: and(['canLink', 'transferMatches']),
										target: 'operating.active',
										actions: resetLinkRequest
									},
									SCOPE_CHANGED: { target: 'idle', actions: clearTransferResults },
									SHUTDOWN: 'linkClosed'
								}
							},
							rejected: {
								on: {
									LINK_COUNTERPART: {
										guard: and(['canLink', 'transferMatches']),
										target: 'operating.active',
										actions: resetLinkRequest
									},
									SCOPE_CHANGED: { target: 'idle', actions: clearTransferResults },
									SHUTDOWN: 'linkClosed'
								}
							},
							linkClosed: { type: 'final' }
						}
					},
					unlink: {
						initial: 'idle',
						states: {
							idle: {
								on: {
									UNLINK_TRANSFER: {
										guard: and(['canUnlink', 'transferLinked']),
										target: 'operating.active',
										actions: resetUnlinkRequest
									},
									SCOPE_CHANGED: { actions: clearTransferResults },
									SHUTDOWN: 'unlinkClosed'
								}
							},
							operating: {
								initial: 'active',
								invoke: {
									id: 'unlinkOperation',
									src: 'unlinkOperation',
									input: ({
										context
									}): Extract<TransferMutationRequestInput, { operation: 'unlink' }> => ({
										workspaceId: required(context.unlinkInput).organizationId,
										operation: 'unlink',
										input: required(context.unlinkInput)
									}),
									onDone: [
										{
											guard: 'unlinkIsClosing',
											target: '#transaction-edit-form.running.unlink.unlinkClosed'
										},
										{
											guard: 'unlinkIsReplacing',
											target: '#transaction-edit-form.running.unlink.idle',
											actions: assign({ unlinkInput: undefined, unlinkResult: null })
										},
										{
											guard: ({ event }) =>
												event.output.operation === 'unlink' &&
												event.output.result.outcome === 'succeeded',
											target: '#transaction-edit-form.running.unlink.succeeded',
											actions: [
												assign({
													unlinkResult: ({ event }) => unlinkResult(event.output),
													unlinkInput: undefined
												}),
												raise({ type: 'UNLINK_SUCCEEDED' })
											]
										},
										{
											target: '#transaction-edit-form.running.unlink.rejected',
											actions: assign({
												unlinkResult: ({ event }) => unlinkResult(event.output),
												unlinkInput: undefined
											})
										}
									],
									onError: [
										{
											guard: 'unlinkIsClosing',
											target: '#transaction-edit-form.running.unlink.unlinkClosed'
										},
										{
											guard: 'unlinkIsReplacing',
											target: '#transaction-edit-form.running.unlink.idle',
											actions: assign({ unlinkInput: undefined, unlinkResult: null })
										},
										{
											target: '#transaction-edit-form.running.unlink.rejected',
											actions: assign({
												unlinkResult: ({ event }): InternalTransferUnlinkResult => ({
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: event.error
												}),
												unlinkInput: undefined
											})
										}
									]
								},
								states: {
									active: {
										on: {
											SCOPE_CHANGED: {
												target: 'replacing',
												actions: stopUnlinkOperation
											},
											SHUTDOWN: {
												target: 'closing',
												actions: stopUnlinkOperation
											}
										}
									},
									closing: {},
									replacing: {
										on: { SHUTDOWN: { target: 'closing', actions: stopUnlinkOperation } }
									}
								}
							},
							succeeded: {
								on: {
									UNLINK_TRANSFER: {
										guard: and(['canUnlink', 'transferLinked']),
										target: 'operating.active',
										actions: resetUnlinkRequest
									},
									SCOPE_CHANGED: { target: 'idle', actions: clearTransferResults },
									SHUTDOWN: 'unlinkClosed'
								}
							},
							rejected: {
								on: {
									UNLINK_TRANSFER: {
										guard: and(['canUnlink', 'transferLinked']),
										target: 'operating.active',
										actions: resetUnlinkRequest
									},
									SCOPE_CHANGED: { target: 'idle', actions: clearTransferResults },
									SHUTDOWN: 'unlinkClosed'
								}
							},
							unlinkClosed: { type: 'final' }
						}
					},
					deletion: {
						initial: 'idle',
						states: {
							idle: {
								on: {
									DELETE_LINKED_TRANSFER: {
										guard: 'canDelete',
										target: 'operating.active',
										actions: resetDeleteRequest
									},
									SCOPE_CHANGED: { actions: clearTransferResults },
									SHUTDOWN: 'deletionClosed'
								}
							},
							operating: {
								initial: 'active',
								invoke: {
									id: 'deleteOperation',
									src: 'deleteOperation',
									input: ({
										context
									}): Extract<TransferMutationRequestInput, { operation: 'delete' }> => ({
										workspaceId: required(context.deleteInput).organizationId,
										operation: 'delete',
										input: required(context.deleteInput)
									}),
									onDone: [
										{
											guard: 'deleteIsClosing',
											target: '#transaction-edit-form.running.deletion.deletionClosed'
										},
										{
											guard: 'deleteIsReplacing',
											target: '#transaction-edit-form.running.deletion.idle',
											actions: assign({ deleteInput: undefined, deleteResult: null })
										},
										{
											guard: ({ event }) =>
												event.output.operation === 'delete' &&
												event.output.result.outcome === 'succeeded',
											target: '#transaction-edit-form.running.deletion.succeeded',
											actions: assign({
												deleteResult: ({ event }) => deleteResult(event.output),
												deleteInput: undefined
											})
										},
										{
											target: '#transaction-edit-form.running.deletion.rejected',
											actions: assign({
												deleteResult: ({ event }) => deleteResult(event.output),
												deleteInput: undefined
											})
										}
									],
									onError: [
										{
											guard: 'deleteIsClosing',
											target: '#transaction-edit-form.running.deletion.deletionClosed'
										},
										{
											guard: 'deleteIsReplacing',
											target: '#transaction-edit-form.running.deletion.idle',
											actions: assign({ deleteInput: undefined, deleteResult: null })
										},
										{
											target: '#transaction-edit-form.running.deletion.rejected',
											actions: assign({
												deleteResult: ({ event }): InternalTransferDeleteResult => ({
													outcome: 'unavailable',
													settlement: 'unresolved',
													error: event.error
												}),
												deleteInput: undefined
											})
										}
									]
								},
								states: {
									active: {
										on: {
											SCOPE_CHANGED: { target: 'replacing', actions: stopDeleteOperation },
											SHUTDOWN: { target: 'closing', actions: stopDeleteOperation }
										}
									},
									closing: {},
									replacing: {
										on: { SHUTDOWN: { target: 'closing', actions: stopDeleteOperation } }
									}
								}
							},
							succeeded: {
								on: {
									DELETE_LINKED_TRANSFER: {
										guard: 'canDelete',
										target: 'operating.active',
										actions: resetDeleteRequest
									},
									SCOPE_CHANGED: { target: 'idle', actions: clearTransferResults },
									SHUTDOWN: 'deletionClosed'
								}
							},
							rejected: {
								on: {
									DELETE_LINKED_TRANSFER: {
										guard: 'canDelete',
										target: 'operating.active',
										actions: resetDeleteRequest
									},
									SCOPE_CHANGED: { target: 'idle', actions: clearTransferResults },
									SHUTDOWN: 'deletionClosed'
								}
							},
							deletionClosed: { type: 'final' }
						}
					}
				}
			}
		}
	})
	type EditSnapshot = SnapshotFrom<typeof logic>
	const selectFormView = (snapshot: EditSnapshot): TransactionEntryView => {
		const operationPending =
			snapshot.context.linkInput !== undefined ||
			snapshot.context.unlinkInput !== undefined ||
			snapshot.context.deleteInput !== undefined
		return operationPending
			? {
					...snapshot.context.formView,
					canSubmit: false,
					canReset: false,
					canCancel: false,
					fieldsEditable: false
				}
			: snapshot.context.formView
	}
	const selectTransferState = (snapshot: EditSnapshot): TransactionEditTransferState => {
		const state = snapshot.value
		if (!isRecord(state) || !isRecord(state.running)) return 'unselected'
		const transfer = state.running.transfer
		if (transfer === 'conflicted') return 'conflicted'
		if (transfer === 'linked') return 'linked'
		if (transfer === 'searching') return 'searching'
		if (transfer === 'matches') return 'matches'
		if (transfer === 'empty') return 'empty'
		if (transfer === 'failed') return 'failed'
		return 'unselected'
	}
	return {
		logic,
		selectFormView,
		selectTransferState,
		isLinkPending: (snapshot: EditSnapshot) => snapshot.context.linkInput !== undefined,
		isUnlinkPending: (snapshot: EditSnapshot) => snapshot.context.unlinkInput !== undefined,
		isDeletePending: (snapshot: EditSnapshot) => snapshot.context.deleteInput !== undefined,
		writableCandidateIds: (snapshot: EditSnapshot) =>
			selectFormView(snapshot).fieldsEditable && snapshot.context.linkInput === undefined
				? snapshot.context.writableCandidateIds
				: new Set<string>(),
		unlinkWritable: (snapshot: EditSnapshot) =>
			selectFormView(snapshot).fieldsEditable && snapshot.context.unlinkInput === undefined
				? snapshot.context.unlinkWritable
				: false
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function transferCandidates(facts: TransactionEntryObservation, observation: TransferObservation) {
	return facts.transaction
		? findInternalTransferCounterparts(
				facts.transaction,
				observation.rows,
				new Set(observation.linkedTransactionIds)
			)
		: []
}

function writableCandidates(
	facts: TransactionEntryObservation,
	candidates: readonly InternalTransferCandidate[]
) {
	const transaction = facts.transaction
	return new Set(
		candidates
			.filter(
				(candidate) =>
					transaction &&
					canWriteAccount(
						facts.membership,
						facts.organizationId,
						transaction.accountId,
						facts.grants
					) &&
					canWriteAccount(facts.membership, facts.organizationId, candidate.accountId, facts.grants)
			)
			.map(({ id }) => id)
	)
}

function writableLinkedTransfer(
	facts: TransactionEntryObservation,
	transfer: InternalTransfer | null
) {
	return Boolean(
		transfer?.expenseAccountId &&
		transfer.incomeAccountId &&
		canWriteAccount(
			facts.membership,
			facts.organizationId,
			transfer.expenseAccountId,
			facts.grants
		) &&
		canWriteAccount(facts.membership, facts.organizationId, transfer.incomeAccountId, facts.grants)
	)
}
