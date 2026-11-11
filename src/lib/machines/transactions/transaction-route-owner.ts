import {
	emptyNewTagDraft,
	mergeNewTagDraft,
	type NewTagDraft
} from '../../contracts/transaction-new-tag-draft.js'
import { canReadAccount } from '../../domain/organization-permissions.js'
import { nativeTextStoreMachine, resolveNativeText } from '../runtime/native-text-store.js'
import { resolveNativeTextDraft } from '../../contracts/native-text-draft.js'
import type { NativeTextCommand, NativeTextReply } from '../../contracts/native-text-transfer.js'
import { mergeTransactionTextDraft } from '../../contracts/transaction-text-draft.js'
import { mergeTransactionTagDraft } from '../../contracts/transaction-tag-draft.js'
import {
	setup,
	types,
	matchesState,
	initialTransition,
	type ActorRefFrom,
	type SnapshotFrom
} from 'xstate'
import type {
	TransactionEntryObservation,
	TransactionEntryReason,
	TransactionEntryScope,
	TransactionEntryView
} from '../../contracts/transaction-entry-contract.js'
import type {
	TransactionCreateRoute,
	TransactionRoute,
	TransactionRouteFormCommand,
	TransactionRouteEditCommand,
	TransactionRouteTransferView,
	TransactionRouteView
} from '../../contracts/transaction-route-contract.js'
import type { WorkspaceResourceRelease } from '../../contracts/workspace-resource-release.js'
import {
	createTransactionEditMachine,
	type TransactionEditDb,
	type TransactionTransferObservation
} from './transaction-edit.js'
import type { TransferMutationGateway } from '../transfers/internal-transfer-mutation-request.js'
import type { TransferWriteTracking } from '../transfers/internal-transfer.js'
import {
	applicableTransactionTags,
	sameTransactionEntryObservation,
	sameTransactionEntryScope,
	createTransactionEntryAvailability,
	selectTransactionEntryAvailability,
	createTransactionEditFormOptions,
	createTransactionEntryFormOptions
} from './transaction-entry.js'
import type { TransactionSubmissionValues } from './transaction-submission.js'
import type { TransactionSaveDb } from './transaction-save.js'
import { createScopedFormMachine, selectScopedFormView } from '../forms/scoped-form.js'

export type TransactionRouteDependencies = {
	textScope?: () => string
	db: TransactionSaveDb
	edit?: {
		db: TransactionEditDb
		trackWrite: (write: TransferWriteTracking) => void
		gateway: TransferMutationGateway
		observeTransfers?: (
			kind: TransactionCreateRoute['kind'],
			scopeGeneration: number,
			searchEnabled: boolean
		) => TransactionTransferObservation
	}
	observe: (kind: TransactionCreateRoute['kind']) => TransactionEntryObservation
	navigate?: (destination: string, signal: AbortSignal, route: TransactionRoute) => Promise<void>
}
function requiredDependencies(
	value: TransactionRouteDependencies | undefined
): TransactionRouteDependencies {
	if (!value) throw new Error('Transaction runtime unavailable')
	return value
}
function createRouteForm(
	dependencies: TransactionRouteDependencies | undefined,
	kind: TransactionCreateRoute['kind']
) {
	type Options = ReturnType<typeof createTransactionEntryFormOptions>
	const options = createTransactionEntryFormOptions({
		binding: dependencies?.db ?? {},
		db: dependencies?.db ?? {
			beginTransaction(): never {
				throw new Error('Transaction runtime unavailable')
			},
			all(): never {
				throw new Error('Transaction runtime unavailable')
			}
		},
		observe: () => requiredDependencies(dependencies).observe(kind),
		...(dependencies?.navigate
			? {
					navigate: (destination: string, signal: AbortSignal) =>
						requiredDependencies(dependencies).navigate?.(
							destination,
							signal,
							kind === 'income'
								? { kind, pathname: '/income/new' }
								: { kind, pathname: '/expenses/new' }
						) ?? Promise.resolve()
				}
			: {})
	})
	return createScopedFormMachine<
		TransactionSubmissionValues,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<Options['availability']>,
		SnapshotFrom<Options['operation']>
	>(options)
}
function formView(
	snapshot: SnapshotFrom<ReturnType<typeof createRouteForm>>
): TransactionEntryView {
	type Options = ReturnType<typeof createTransactionEntryFormOptions>
	return selectScopedFormView<
		TransactionSubmissionValues,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<Options['availability']>,
		SnapshotFrom<Options['operation']>
	>(snapshot, { successContent: 'replace' })
}
function requiredRoute(route: TransactionRoute | null): TransactionRoute {
	if (!route) throw new Error('Missing transaction route lease')
	return route
}

function createRouteEdit(
	dependencies: TransactionRouteDependencies | undefined,
	kind: TransactionCreateRoute['kind']
) {
	const unavailable = (): never => {
		throw new Error('Transaction edit runtime unavailable')
	}
	const db = dependencies?.edit?.db ?? {
		beginTransaction: unavailable,
		all: unavailable,
		one: unavailable,
		transaction: unavailable,
		delete: unavailable
	}
	return createTransactionEditMachine(
		createTransactionEditFormOptions({
			binding: dependencies?.db ?? db,
			db,
			observe: () => requiredDependencies(dependencies).observe(kind)
		}),
		db,
		dependencies?.edit?.trackWrite ?? unavailable,
		dependencies?.edit?.gateway ?? { send: unavailable }
	)
}

/** Route exit closes admission before joining the form's real shutdown. Re-entry,
 * including A→B→A, gets a fresh generation after the old save and attachments drain. */
export function createTransactionRouteOwnerMachine(
	dependencies: TransactionRouteDependencies | undefined
) {
	const expenseEdit = createRouteEdit(dependencies, 'expense')
	const incomeEdit = createRouteEdit(dependencies, 'income')
	const actors = {
		text: nativeTextStoreMachine,
		expenseEdit: expenseEdit.logic,
		incomeEdit: incomeEdit.logic,
		expense: createRouteForm(dependencies, 'expense'),
		income: createRouteForm(dependencies, 'income')
	}
	return setup({
		schemas: {
			context: types<{
				current: TransactionRoute | null
				pending: TransactionRoute | null
				generation: number
				editScopeGeneration: number
				editSearchEnabled: boolean
				newTags: NewTagDraft
				removedTagIds: ReadonlySet<string>
				transfer: TransactionRouteTransferView | undefined
				view: TransactionEntryView | undefined
				release: WorkspaceResourceRelease
			}>(),
			events: {
				ROUTE: types<{ route: TransactionRoute | null }>(),
				FORM: types<{ generation: number; command: TransactionRouteFormCommand }>(),
				EDIT: types<{ generation: number; command: TransactionRouteEditCommand }>(),
				TEXT: types<{ generation: number; draftRevision: number; command: NativeTextCommand }>(),
				OBSERVE: types(),
				SHUTDOWN: types()
			},
			output: types<WorkspaceResourceRelease>(),
			children: {
				form: types<ActorRefFrom<typeof actors.expense>>(),
				edit: types<ActorRefFrom<typeof actors.expenseEdit>>(),
				text: types<ActorRefFrom<typeof actors.text>>()
			}
		},
		actors
	}).createMachine({
		id: 'transaction-route-owner',
		initial: 'idle',
		context: {
			current: null,
			pending: null,
			generation: 0,
			editScopeGeneration: 0,
			editSearchEnabled: false,
			newTags: emptyNewTagDraft(),
			removedTagIds: new Set(),
			transfer: undefined,
			view: undefined,
			release: { outcome: 'released' }
		},
		output: ({ context }) => context.release,
		states: {
			idle: {
				on: {
					ROUTE: ({ event }) =>
						dependencies && event.route && (!('transactionId' in event.route) || dependencies.edit)
							? { target: 'selecting', context: { pending: event.route } }
							: undefined,
					SHUTDOWN: { target: 'closed' }
				}
			},
			selecting: {
				id: 'transaction-route-selecting',
				always: ({ context }) =>
					context.pending && (!('transactionId' in context.pending) || dependencies?.edit)
						? {
								target: 'holding',
								context: {
									current: context.pending,
									pending: null,
									generation: context.generation + 1,
									newTags: emptyNewTagDraft(),
									removedTagIds: new Set(),
									editScopeGeneration: 0,
									editSearchEnabled: false,
									transfer: undefined,
									view: undefined
								}
							}
						: {
								target: 'idle',
								context: {
									current: null,
									view: undefined,
									transfer: undefined,
									newTags: emptyNewTagDraft(),
									removedTagIds: new Set<string>()
								}
							}
			},
			holding: {
				type: 'parallel',
				invoke: {
					id: 'text',
					src: 'text',
					input: ({ context, self }) => {
						const route = requiredRoute(context.current)
						const generation = context.generation
						const binding = requiredDependencies(dependencies).observe(route.kind)
						const availability = createTransactionEntryAvailability(
							requiredDependencies(dependencies).db
						)
						const admitted = (mode: 'read' | 'write') => {
							const snapshot = self.getSnapshot()
							const facts = requiredDependencies(dependencies).observe(route.kind)
							if (
								!snapshot.matches({ holding: { control: 'active' } }) ||
								snapshot.context.generation !== generation ||
								!facts.sessionReady ||
								facts.loading ||
								facts.failed ||
								!sameTransactionEntryScope(binding, facts)
							)
								return false
							if (mode === 'read' && 'transactionId' in route) {
								const transaction = facts.transaction
								return (
									!!transaction &&
									transaction.id === route.transactionId &&
									transaction.organizationId === facts.organizationId &&
									transaction.kind === route.kind &&
									facts.membership?.userId === facts.identityId &&
									canReadAccount(
										facts.membership,
										facts.organizationId,
										transaction.accountId,
										facts.grants
									)
								)
							}
							const [assessed] = initialTransition(availability, { revision: 0, facts })
							return (
								snapshot.context.view?.fieldsEditable === true &&
								selectTransactionEntryAvailability(assessed).readiness.kind === 'ready' &&
								(!('transactionId' in route) || facts.transaction?.id === route.transactionId)
							)
						}
						return {
							textScope: `${dependencies?.textScope?.() ?? 'unbound'}/${generation}`,
							canRead: (field) => field !== 'name' && admitted('read'),
							canWrite: () => admitted('write'),
							source: (field) => {
								if (!admitted('read')) return undefined
								const transaction = requiredDependencies(dependencies).observe(
									route.kind
								).transaction
								if (field === 'name') return undefined
								if (field === 'checkNumber') return transaction?.check?.checkNumber ?? ''
								return transaction?.[field] ?? ''
							}
						}
					}
				},
				on: {
					OBSERVE: ({ context, children }, enq) => {
						const transfer = dependencies?.edit?.observeTransfers?.(
							requiredRoute(context.current).kind,
							context.editScopeGeneration,
							context.editSearchEnabled
						)
						if (children.edit && transfer)
							enq.sendTo(children.edit, { type: 'TRANSFER_OBSERVATION', observation: transfer })
						if (children.edit) {
							const observation = requiredDependencies(dependencies).observe(
								requiredRoute(context.current).kind
							)
							if (
								!sameTransactionEntryObservation(
									children.edit.getSnapshot().context.observation.facts,
									observation
								)
							)
								enq.sendTo(children.edit, { type: 'OBSERVE', observation })
						}
						if (children.form)
							enq.sendTo(children.form, {
								type: 'OBSERVE',
								observation: requiredDependencies(dependencies).observe(
									requiredRoute(context.current).kind
								)
							})
					}
				},
				states: {
					control: {
						initial: 'active',
						states: {
							active: {
								on: {
									ROUTE: ({ context, event }) =>
										event.route?.pathname === context.current?.pathname
											? undefined
											: { target: 'replacing', context: { pending: event.route } },
									TEXT: ({ context, event, children }, enq) => {
										if (
											event.generation !== context.generation ||
											event.draftRevision !== context.view?.draftRevision
										)
											return
										if (children.text)
											enq.sendTo(children.text, { type: 'COMMAND', command: event.command })
									},
									EDIT: ({ context, event, children }, enq) => {
										if (context.generation !== event.generation || !children.edit) return
										const observation = requiredDependencies(dependencies).observe(
											requiredRoute(context.current).kind
										)
										enq.sendTo(children.edit, { type: 'OBSERVE', observation })
										const transfer = dependencies?.edit?.observeTransfers?.(
											requiredRoute(context.current).kind,
											context.editScopeGeneration,
											context.editSearchEnabled
										)
										if (transfer)
											enq.sendTo(children.edit, {
												type: 'TRANSFER_OBSERVATION',
												observation: transfer
											})
										enq.sendTo(children.edit, event.command)
									},
									FORM: ({ context, event, children }, enq) => {
										if (event.generation !== context.generation) return
										if (event.command.type === 'TAG_PAGE')
											return {
												context: { newTags: { ...context.newTags, offset: event.command.offset } }
											}
										if (
											(event.command.type === 'CHANGE' || event.command.type === 'SUBMIT') &&
											!context.view?.fieldsEditable
										)
											return
										const command = event.command
										const resolved =
											command.type === 'CHANGE' || command.type === 'SUBMIT'
												? resolveNativeTextDraft(
														command.values,
														['description', 'memo', 'checkNumber'],
														(field, reference) =>
															resolveNativeText(children.text?.getSnapshot(), field, reference)
													)
												: undefined
										if (resolved?.kind === 'invalid') return
										const facts = requiredDependencies(dependencies).observe(
											requiredRoute(context.current).kind
										)
										const newTags =
											resolved?.kind === 'valid'
												? mergeNewTagDraft(
														resolved.values,
														context.newTags,
														applicableTransactionTags(facts),
														facts.transaction?.tags?.flatMap((link) =>
															link.tag && !context.removedTagIds.has(link.tag.id)
																? [link.tag.name]
																: []
														) ?? [],
														(reference) =>
															resolveNativeText(children.text?.getSnapshot(), 'name', reference)
													)
												: undefined
										if (newTags?.kind === 'invalid') return
										if (newTags?.kind === 'valid' && !newTags.accepted)
											return { context: { newTags: newTags.draft } }

										const formCommand =
											(command.type === 'CHANGE' || command.type === 'SUBMIT') &&
											resolved?.kind === 'valid'
												? {
														...command,
														values: newTags?.kind === 'valid' ? newTags.values : resolved.values
													}
												: command
										if (children.edit) {
											const currentView = (
												context.current?.kind === 'income' ? incomeEdit : expenseEdit
											).selectFormView(children.edit.getSnapshot())
											if (event.command.type === 'RESET' && !currentView.canReset) return
											if (
												(event.command.type === 'CHANGE' || event.command.type === 'SUBMIT') &&
												!currentView.fieldsEditable
											)
												return

											enq.sendTo(children.edit, {
												type: 'OBSERVE',
												observation: requiredDependencies(dependencies).observe(
													requiredRoute(context.current).kind
												)
											})
											if (event.command.type === 'RESET') {
												if (children.text) enq.sendTo(children.text, { type: 'RESET' })
												enq.sendTo(children.edit, { type: 'FORM', event: event.command })
												return {
													context: {
														removedTagIds: new Set<string>(),
														newTags: emptyNewTagDraft(context.newTags.nextId)
													}
												}
											}
											if (event.command.type === 'CHANGE' || event.command.type === 'SUBMIT') {
												const observation = requiredDependencies(dependencies).observe(
													requiredRoute(context.current).kind
												)
												const tags =
													observation.transaction?.tags?.flatMap((link) =>
														link.tag ? [{ id: link.tag.id, name: link.tag.name }] : []
													) ?? []
												const merged = mergeTransactionTagDraft(
													newTags?.kind === 'valid'
														? newTags.values
														: resolved?.kind === 'valid'
															? resolved.values
															: event.command.values,
													tags,
													context.removedTagIds
												)
												if (merged.kind === 'invalid') return
												const textDraft = mergeTransactionTextDraft(
													merged.values,
													observation.transaction
												)
												if (textDraft.kind === 'invalid') return
												enq.sendTo(children.edit, {
													type: 'FORM',
													event: { ...event.command, values: textDraft.values }
												})
												return {
													context: {
														removedTagIds: merged.removedTagIds,
														newTags: newTags?.kind === 'valid' ? newTags.draft : context.newTags
													}
												}
											}
											enq.sendTo(children.edit, { type: 'FORM', event: event.command })
										}
										if (!children.form) return
										enq.sendTo(children.form, {
											type: 'OBSERVE',
											observation: requiredDependencies(dependencies).observe(
												requiredRoute(context.current).kind
											)
										})
										if (formCommand.type === 'RESET' && context.view?.canReset && children.text)
											enq.sendTo(children.text, { type: 'RESET' })
										enq.sendTo(children.form, formCommand)
										return {
											context: {
												newTags:
													formCommand.type === 'RESET' && context.view?.canReset
														? emptyNewTagDraft(context.newTags.nextId)
														: newTags?.kind === 'valid'
															? newTags.draft
															: context.newTags
											}
										}
									},
									SHUTDOWN: { target: 'draining', context: { pending: null } }
								}
							},
							replacing: {
								entry: ({ children }, enq) => {
									if (children.text) enq.sendTo(children.text, { type: 'SHUTDOWN' })
									if (children.form) enq.sendTo(children.form, { type: 'SHUTDOWN' })
									if (children.edit) enq.sendTo(children.edit, { type: 'SHUTDOWN' })
								},
								on: {
									ROUTE: ({ event }) => ({ context: { pending: event.route } }),
									FORM: {},
									EDIT: {},
									SHUTDOWN: { target: 'draining', context: { pending: null } }
								}
							},
							draining: {
								entry: ({ children }, enq) => {
									if (children.text) enq.sendTo(children.text, { type: 'SHUTDOWN' })
									if (children.form) enq.sendTo(children.form, { type: 'SHUTDOWN' })
									if (children.edit) enq.sendTo(children.edit, { type: 'SHUTDOWN' })
								},
								on: { ROUTE: {}, FORM: {}, EDIT: {}, SHUTDOWN: {} }
							}
						}
					},
					work: {
						initial: 'choosing',
						states: {
							choosing: {
								always: ({ context }) => ({
									target:
										context.current && 'transactionId' in context.current
											? context.current.kind === 'income'
												? 'incomeEdit'
												: 'expenseEdit'
											: context.current?.kind === 'income'
												? 'income'
												: 'expense'
								})
							},
							expenseEdit: {
								invoke: {
									id: 'edit',
									src: 'expenseEdit',
									input: () => requiredDependencies(dependencies).observe('expense'),
									onSnapshot: ({ event }) => ({
										context: {
											view: expenseEdit.selectFormView(event.snapshot),
											transfer: {
												state: expenseEdit.selectTransferState(event.snapshot),
												statusLabel: expenseEdit.selectTransferStatus(event.snapshot),
												deleteFeedback: expenseEdit.selectDeleteFeedback(event.snapshot),
												canDelete:
													event.snapshot.context.deleteResult?.outcome !== 'succeeded' &&
													!!event.snapshot.context.observation.facts.transactionId &&
													event.snapshot.can({
														type: 'DELETE_LINKED_TRANSFER',
														choice: {
															kind: 'selected',
															transactionId:
																event.snapshot.context.observation.facts.transactionId ?? ''
														}
													}),
												candidates: event.snapshot.context.candidates,
												selectedCandidateId: event.snapshot.context.selectedCandidateId,
												writableCandidateIds: expenseEdit.writableCandidateIds(event.snapshot),
												linkedTransfer: event.snapshot.context.linkedTransfer,
												unlinkWritable: expenseEdit.unlinkWritable(event.snapshot),
												linkPending: expenseEdit.isLinkPending(event.snapshot),
												unlinkPending: expenseEdit.isUnlinkPending(event.snapshot),
												deletePending: expenseEdit.isDeletePending(event.snapshot),
												linkOutcome: event.snapshot.context.linkResult?.outcome ?? null,
												unlinkOutcome: event.snapshot.context.unlinkResult?.outcome ?? null,
												deleteOutcome: event.snapshot.context.deleteResult?.outcome ?? null
											},
											editScopeGeneration: event.snapshot.context.scopeGeneration,
											editSearchEnabled: ['searching', 'matches', 'empty', 'failed'].includes(
												expenseEdit.selectTransferState(event.snapshot)
											)
										}
									}),
									onDone: ({ value }) =>
										matchesState({ holding: { control: 'replacing' } }, value)
											? {
													target: '#transaction-route-selecting',
													context: {
														current: null,
														view: undefined,
														transfer: undefined,
														newTags: emptyNewTagDraft(),
														removedTagIds: new Set<string>()
													}
												}
											: matchesState({ holding: { control: 'draining' } }, value)
												? {
														target: '#transaction-route-closed',
														context: {
															current: null,
															view: undefined,
															transfer: undefined,
															newTags: emptyNewTagDraft(),
															removedTagIds: new Set<string>()
														}
													}
												: {
														target: '#transaction-route-failed',
														context: { release: { outcome: 'releasedWithFailure' } }
													},
									onError: {
										target: '#transaction-route-failed',
										context: { release: { outcome: 'unresolved' } }
									}
								}
							},
							incomeEdit: {
								invoke: {
									id: 'edit',
									src: 'incomeEdit',
									input: () => requiredDependencies(dependencies).observe('income'),
									onSnapshot: ({ event }) => ({
										context: {
											view: incomeEdit.selectFormView(event.snapshot),
											transfer: {
												state: incomeEdit.selectTransferState(event.snapshot),
												statusLabel: incomeEdit.selectTransferStatus(event.snapshot),
												deleteFeedback: incomeEdit.selectDeleteFeedback(event.snapshot),
												canDelete:
													event.snapshot.context.deleteResult?.outcome !== 'succeeded' &&
													!!event.snapshot.context.observation.facts.transactionId &&
													event.snapshot.can({
														type: 'DELETE_LINKED_TRANSFER',
														choice: {
															kind: 'selected',
															transactionId:
																event.snapshot.context.observation.facts.transactionId ?? ''
														}
													}),
												candidates: event.snapshot.context.candidates,
												selectedCandidateId: event.snapshot.context.selectedCandidateId,
												writableCandidateIds: incomeEdit.writableCandidateIds(event.snapshot),
												linkedTransfer: event.snapshot.context.linkedTransfer,
												unlinkWritable: incomeEdit.unlinkWritable(event.snapshot),
												linkPending: incomeEdit.isLinkPending(event.snapshot),
												unlinkPending: incomeEdit.isUnlinkPending(event.snapshot),
												deletePending: incomeEdit.isDeletePending(event.snapshot),
												linkOutcome: event.snapshot.context.linkResult?.outcome ?? null,
												unlinkOutcome: event.snapshot.context.unlinkResult?.outcome ?? null,
												deleteOutcome: event.snapshot.context.deleteResult?.outcome ?? null
											},
											editScopeGeneration: event.snapshot.context.scopeGeneration,
											editSearchEnabled: ['searching', 'matches', 'empty', 'failed'].includes(
												incomeEdit.selectTransferState(event.snapshot)
											)
										}
									}),
									onDone: ({ value }) =>
										matchesState({ holding: { control: 'replacing' } }, value)
											? {
													target: '#transaction-route-selecting',
													context: {
														current: null,
														view: undefined,
														transfer: undefined,
														newTags: emptyNewTagDraft(),
														removedTagIds: new Set<string>()
													}
												}
											: matchesState({ holding: { control: 'draining' } }, value)
												? {
														target: '#transaction-route-closed',
														context: {
															current: null,
															view: undefined,
															transfer: undefined,
															newTags: emptyNewTagDraft(),
															removedTagIds: new Set<string>()
														}
													}
												: {
														target: '#transaction-route-failed',
														context: { release: { outcome: 'releasedWithFailure' } }
													},
									onError: {
										target: '#transaction-route-failed',
										context: { release: { outcome: 'unresolved' } }
									}
								}
							},
							expense: {
								invoke: {
									id: 'form',
									src: 'expense',
									input: () => requiredDependencies(dependencies).observe('expense'),
									onSnapshot: ({ event }) => ({ context: { view: formView(event.snapshot) } }),
									onDone: ({ value }) =>
										matchesState({ holding: { control: 'replacing' } }, value)
											? {
													target: '#transaction-route-selecting',
													context: {
														current: null,
														view: undefined,
														transfer: undefined,
														newTags: emptyNewTagDraft(),
														removedTagIds: new Set<string>()
													}
												}
											: matchesState({ holding: { control: 'draining' } }, value)
												? {
														target: '#transaction-route-closed',
														context: {
															current: null,
															view: undefined,
															transfer: undefined,
															newTags: emptyNewTagDraft(),
															removedTagIds: new Set<string>()
														}
													}
												: {
														target: '#transaction-route-failed',
														context: { release: { outcome: 'releasedWithFailure' } }
													},
									onError: {
										target: '#transaction-route-failed',
										context: { release: { outcome: 'unresolved' } }
									}
								}
							},
							income: {
								invoke: {
									id: 'form',
									src: 'income',
									input: () => requiredDependencies(dependencies).observe('income'),
									onSnapshot: ({ event }) => ({ context: { view: formView(event.snapshot) } }),
									onDone: ({ value }) =>
										matchesState({ holding: { control: 'replacing' } }, value)
											? {
													target: '#transaction-route-selecting',
													context: {
														current: null,
														view: undefined,
														transfer: undefined,
														newTags: emptyNewTagDraft(),
														removedTagIds: new Set<string>()
													}
												}
											: matchesState({ holding: { control: 'draining' } }, value)
												? {
														target: '#transaction-route-closed',
														context: {
															current: null,
															view: undefined,
															transfer: undefined,
															newTags: emptyNewTagDraft(),
															removedTagIds: new Set<string>()
														}
													}
												: {
														target: '#transaction-route-failed',
														context: { release: { outcome: 'releasedWithFailure' } }
													},
									onError: {
										target: '#transaction-route-failed',
										context: { release: { outcome: 'unresolved' } }
									}
								}
							}
						}
					}
				}
			},
			failed: { id: 'transaction-route-failed', type: 'final' },
			closed: { id: 'transaction-route-closed', type: 'final' }
		}
	})
}
export function selectTransactionRouteView(
	snapshot: SnapshotFrom<ReturnType<typeof createTransactionRouteOwnerMachine>> | undefined
): TransactionRouteView {
	if (!snapshot) return { generation: 0, route: null, mode: 'idle', form: undefined }
	return {
		generation: snapshot.context.generation,
		route: snapshot.context.current,
		mode: snapshot.matches({ holding: { control: 'active' } })
			? 'active'
			: snapshot.matches('holding')
				? 'draining'
				: snapshot.matches('failed')
					? 'failed'
					: snapshot.matches('closed')
						? 'closed'
						: 'idle',
		form: snapshot.matches({ holding: { control: 'active' } }) ? snapshot.context.view : undefined,
		removedTagIds: snapshot.context.removedTagIds,
		newTags: snapshot.matches({ holding: { control: 'active' } })
			? snapshot.context.newTags
			: undefined,
		transfer: snapshot.matches({ holding: { control: 'active' } })
			? snapshot.context.transfer
			: undefined
	}
}

export function selectTransactionTransferObservationState(
	snapshot: SnapshotFrom<ReturnType<typeof createTransactionRouteOwnerMachine>> | undefined
) {
	return {
		scopeGeneration: snapshot?.context.editScopeGeneration ?? 0,
		searchEnabled: snapshot?.context.editSearchEnabled ?? false
	}
}

/** A private transport receipt; never part of ordinary financial views. */
export function selectTransactionTextReply(
	snapshot: SnapshotFrom<ReturnType<typeof createTransactionRouteOwnerMachine>> | undefined
): NativeTextReply | undefined {
	return snapshot?.matches({ holding: { control: 'active' } })
		? snapshot.children.text?.getSnapshot().context.reply
		: undefined
}
