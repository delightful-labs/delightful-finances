import {
	nativeNameOwnerMachine,
	resolveNativeName,
	selectNativeNameReply
} from '../runtime/native-name-owner.js'
import { resolveNativeTextDraft } from '../../contracts/native-text-draft.js'
import type {
	NativeTextCommand,
	NativeTextReference
} from '../../contracts/native-text-transfer.js'
import {
	createTransactionRouteOwnerMachine,
	selectTransactionRouteView,
	selectTransactionTextReply,
	selectTransactionTransferObservationState,
	type TransactionRouteDependencies
} from '../transactions/transaction-route-owner.js'
import type {
	TransactionRoute,
	TransactionRouteFormCommand,
	TransactionRouteEditCommand
} from '../../contracts/transaction-route-contract.js'
import {
	createAccountArchiveMachine,
	selectAccountArchiveView
} from '../accounts/account-archive.js'
import {
	createAccountDeleteGrantMachine,
	selectAccountDeleteGrantView,
	type DeleteGrantObservation,
	type GrantWrite
} from '../accounts/account-delete-grants.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'
import { archiveAccount, persistAccountDeleteGrant } from '../../data.js'
import { createClassificationFormOptions } from '../management/management-form-options.js'
import { retainResourceRelease } from '../../contracts/workspace-resource-release.js'
import type {
	ManagementObservation,
	ManagementReason,
	ManagementScope
} from '../../contracts/management-contract.js'
import type { z } from 'zod'
import type { categoryFormSchema, categoryArchiveSchema } from '../../validation/categories.js'
import type { tagFormSchema, tagArchiveSchema } from '../../validation/tags.js'
import type { Category, Tag } from '../../schema.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'
import {
	accountCreationAccessMachine,
	createAccountCreationFormOptions
} from '../accounts/account-creation-access.js'
import { createAccount } from '../../data.js'
import type { Account } from '../../schema.js'
import type { AccountFormValues } from '../../validation/accounts.js'
import type {
	AccountCreationReason,
	AccountCreationScope,
	AccountCreationObservation
} from '../../contracts/account-creation-contract.js'
import type { WorkspaceResourceRelease } from '../../contracts/workspace-resource-release.js'
import { setup, types, matchesState, initialTransition, type SnapshotFrom } from 'xstate'

export type WorkspaceFormsDependencies = {
	textScope?: () => string
	transaction?: TransactionRouteDependencies
	account: () => AccountCreationObservation
	archive?: () => ArchiveObservation
	deleteGrants?: () => DeleteGrantObservation
	management?: (kind: 'category' | 'tag') => ManagementObservation
}
export type AccountFormCommand =
	| { type: 'OPEN' | 'RESET' | 'CANCEL' | 'RETRY_READINESS' }
	| {
			type: 'SUBMIT' | 'CHANGE'
			values: {
				name?: string | NativeTextReference | undefined
				kind?: string | undefined
				currency?: string | undefined
			}
	  }

export type ManagementFormSlot = 'category' | 'tag' | 'categoryArchive' | 'tagArchive'
export type ManagementFormCommand =
	| { type: 'OPEN' | 'RESET' | 'CANCEL' | 'RETRY_READINESS' }
	| { type: 'SUBMIT' | 'CHANGE'; values: unknown }
export type NameFormSlot = 'account' | 'category' | 'tag'
type FormSlot =
	| 'transaction'
	| 'account'
	| 'accountArchive'
	| 'deleteGrants'
	| 'accountText'
	| 'categoryText'
	| 'tagText'
	| ManagementFormSlot
type Context = { results: Partial<Record<FormSlot, WorkspaceResourceRelease>> }

/** Form lifetime spans UI mounts and drains before the selected lease releases. */
export function createWorkspaceFormsMachine(
	db: Parameters<typeof createClassificationFormOptions>[0],
	dependencies: WorkspaceFormsDependencies | undefined
) {
	const observe = (): AccountCreationObservation =>
		dependencies?.account() ?? {
			identityId: null,
			organizationId: null,
			binding: null,
			sessionReady: false,
			membership: undefined,
			accounts: [],
			loading: true,
			error: undefined
		}
	const management = (kind: 'category' | 'tag'): ManagementObservation =>
		dependencies?.management?.(kind) ?? {
			identityId: null,
			organizationId: null,
			binding: null,
			sessionReady: false,
			membership: undefined,
			categories: [],
			tags: [],
			loading: true,
			failed: false
		}
	const archive = (): ArchiveObservation =>
		dependencies?.archive?.() ?? {
			...observe(),
			failed: false,
			grants: []
		}
	const deleteGrants = (): DeleteGrantObservation =>
		dependencies?.deleteGrants?.() ?? {
			...observe(),
			failed: false,
			members: [],
			grants: []
		}
	const persistGrant = (write: GrantWrite) => persistAccountDeleteGrant(db, write)
	const classification = createClassificationFormOptions(db, management)
	const accountOptions = createAccountCreationFormOptions({
		binding: db,
		observe,
		create: (organizationId, values) =>
			createAccount(db, organizationId, values.name, values.kind, values.currency)
	})
	const actors = {
		name: nativeNameOwnerMachine,
		transaction: createTransactionRouteOwnerMachine(dependencies?.transaction),
		accountArchive: createAccountArchiveMachine(
			(request) => archiveAccount(db, request.accountId),
			archive
		),
		deleteGrants: createAccountDeleteGrantMachine(persistGrant, deleteGrants),
		category: createScopedFormMachine(classification.category),
		tag: createScopedFormMachine(classification.tag),
		categoryArchive: createScopedFormMachine(classification.categoryArchive),
		tagArchive: createScopedFormMachine(classification.tagArchive),

		account: createScopedFormMachine(accountOptions)
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				NAME_TEXT: types<{
					form: NameFormSlot
					draftRevision: number
					command: NativeTextCommand
				}>(),
				TRANSACTION_ROUTE: types<{ route: TransactionRoute | null }>(),
				TRANSACTION_FORM: types<{ generation: number; command: TransactionRouteFormCommand }>(),
				TRANSACTION_EDIT: types<{ generation: number; command: TransactionRouteEditCommand }>(),
				TRANSACTION_TEXT: types<{
					generation: number
					draftRevision: number
					command: NativeTextCommand
				}>(),
				ARCHIVE_ACCOUNT: types<{ accountId: string }>(),
				SET_DELETE: types<{ accountId: string; userId: string; canDelete: boolean }>(),
				ACCOUNT: types<{ command: AccountFormCommand }>(),
				MANAGEMENT: types<{ form: ManagementFormSlot; command: ManagementFormCommand }>(),
				FORM_CLOSED: types(),
				OBSERVE: types(),
				SHUTDOWN: types()
			},
			output: types<WorkspaceResourceRelease>(),
			children: {
				accountText: types<import('xstate').ActorRefFrom<typeof actors.name>>(),
				categoryText: types<import('xstate').ActorRefFrom<typeof actors.name>>(),
				tagText: types<import('xstate').ActorRefFrom<typeof actors.name>>(),
				transaction: types<import('xstate').ActorRefFrom<typeof actors.transaction>>(),
				accountArchive: types<import('xstate').ActorRefFrom<typeof actors.accountArchive>>(),
				deleteGrants: types<import('xstate').ActorRefFrom<typeof actors.deleteGrants>>(),
				account: types<import('xstate').ActorRefFrom<typeof actors.account>>(),
				category: types<import('xstate').ActorRefFrom<typeof actors.category>>(),
				tag: types<import('xstate').ActorRefFrom<typeof actors.tag>>(),
				categoryArchive: types<import('xstate').ActorRefFrom<typeof actors.categoryArchive>>(),
				tagArchive: types<import('xstate').ActorRefFrom<typeof actors.tagArchive>>()
			}
		},
		actors
	}).createMachine({
		id: 'workspace-forms',
		initial: 'owning',
		context: { results: {} },
		output: ({ context }) =>
			Object.values(context.results).reduce(retainResourceRelease, { outcome: 'released' }),
		states: {
			owning: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: {
								on: {
									TRANSACTION_ROUTE: ({ children, event }, enq) => {
										if (children.transaction)
											enq.sendTo(children.transaction, { type: 'ROUTE', route: event.route })
									},
									TRANSACTION_EDIT: ({ children, event }, enq) => {
										if (children.transaction)
											enq.sendTo(children.transaction, {
												type: 'EDIT',
												generation: event.generation,
												command: event.command
											})
									},
									TRANSACTION_TEXT: ({ children, event }, enq) => {
										if (children.transaction)
											enq.sendTo(children.transaction, {
												type: 'TEXT',
												generation: event.generation,
												draftRevision: event.draftRevision,
												command: event.command
											})
									},
									TRANSACTION_FORM: ({ children, event }, enq) => {
										if (children.transaction)
											enq.sendTo(children.transaction, {
												type: 'FORM',
												generation: event.generation,
												command: event.command
											})
									},
									ARCHIVE_ACCOUNT: ({ children, event }, enq) => {
										if (children.accountArchive) {
											enq.sendTo(children.accountArchive, {
												type: 'OBSERVE',
												observation: archive()
											})
											enq.sendTo(children.accountArchive, {
												type: 'ARCHIVE',
												accountId: event.accountId
											})
										}
									},
									SET_DELETE: ({ children, event }, enq) => {
										if (children.deleteGrants) {
											enq.sendTo(children.deleteGrants, {
												type: 'OBSERVE',
												observation: deleteGrants()
											})
											enq.sendTo(children.deleteGrants, event)
										}
									},
									NAME_TEXT: ({ children, event }, enq) => {
										const child =
											event.form === 'account'
												? children.accountText
												: event.form === 'category'
													? children.categoryText
													: children.tagText
										if (child)
											enq.sendTo(child, {
												type: 'TEXT',
												draftRevision: event.draftRevision,
												command: event.command
											})
									},
									ACCOUNT: ({ children, event }, enq) => {
										if (!children.account) return
										const command = event.command
										if (command.type !== 'CHANGE' && command.type !== 'SUBMIT') {
											if (
												(command.type === 'RESET' ||
													command.type === 'OPEN' ||
													command.type === 'CANCEL') &&
												children.account.getSnapshot().can(command) &&
												children.accountText
											)
												enq.sendTo(children.accountText, { type: 'RESET' })
											enq.sendTo(children.account, command)
											return
										}
										const resolved = resolveNativeTextDraft(
											command.values,
											['name'],
											(_field, reference) =>
												resolveNativeName(children.accountText?.getSnapshot(), reference)
										)
										if (resolved.kind === 'valid')
											enq.sendTo(children.account, { ...command, values: resolved.values })
									},
									MANAGEMENT: ({ children, event }, enq) => {
										if (event.form === 'category' || event.form === 'tag') {
											const child = event.form === 'category' ? children.category : children.tag
											const text =
												event.form === 'category' ? children.categoryText : children.tagText
											const command = event.command
											if (!child) return
											if (command.type !== 'CHANGE' && command.type !== 'SUBMIT') {
												if (
													(command.type === 'RESET' ||
														command.type === 'OPEN' ||
														command.type === 'CANCEL') &&
													child.getSnapshot().can(command) &&
													text
												)
													enq.sendTo(text, { type: 'RESET' })
												enq.sendTo(child, command)
												return
											}
											const resolved = resolveNativeTextDraft(
												command.values,
												['name'],
												(_field, reference) => resolveNativeName(text?.getSnapshot(), reference)
											)
											if (resolved.kind === 'valid')
												enq.sendTo(child, { ...command, values: resolved.values })
											return
										}
										if (event.form === 'categoryArchive' && children.categoryArchive)
											enq.sendTo(children.categoryArchive, event.command)
										if (event.form === 'tagArchive' && children.tagArchive)
											enq.sendTo(children.tagArchive, event.command)
									},
									OBSERVE: ({ children }, enq) => {
										if (children.transaction) enq.sendTo(children.transaction, { type: 'OBSERVE' })
										if (children.accountArchive)
											enq.sendTo(children.accountArchive, {
												type: 'OBSERVE',
												observation: archive()
											})
										if (children.deleteGrants)
											enq.sendTo(children.deleteGrants, {
												type: 'OBSERVE',
												observation: deleteGrants()
											})
										if (children.account)
											enq.sendTo(children.account, { type: 'OBSERVE', observation: observe() })
										if (children.category)
											enq.sendTo(children.category, {
												type: 'OBSERVE',
												observation: management('category')
											})
										if (children.tag)
											enq.sendTo(children.tag, { type: 'OBSERVE', observation: management('tag') })
										if (children.categoryArchive)
											enq.sendTo(children.categoryArchive, {
												type: 'OBSERVE',
												observation: management('category')
											})
										if (children.tagArchive)
											enq.sendTo(children.tagArchive, {
												type: 'OBSERVE',
												observation: management('tag')
											})
									},
									SHUTDOWN: { target: 'draining' },
									FORM_CLOSED: { target: 'draining' }
								}
							},
							draining: {
								entry: ({ children }, enq) => {
									for (const text of [
										children.accountText,
										children.categoryText,
										children.tagText
									])
										if (text?.getSnapshot().status === 'active')
											enq.sendTo(text, { type: 'SHUTDOWN' })
									if (children.transaction?.getSnapshot().status === 'active')
										enq.sendTo(children.transaction, { type: 'SHUTDOWN' })
									if (children.accountArchive?.getSnapshot().status === 'active')
										enq.sendTo(children.accountArchive, { type: 'SHUTDOWN' })
									if (children.deleteGrants?.getSnapshot().status === 'active')
										enq.sendTo(children.deleteGrants, { type: 'SHUTDOWN' })
									if (children.account?.getSnapshot().status === 'active')
										enq.sendTo(children.account, { type: 'SHUTDOWN' })
									if (children.category?.getSnapshot().status === 'active')
										enq.sendTo(children.category, { type: 'SHUTDOWN' })
									if (children.tag?.getSnapshot().status === 'active')
										enq.sendTo(children.tag, { type: 'SHUTDOWN' })
									if (children.categoryArchive?.getSnapshot().status === 'active')
										enq.sendTo(children.categoryArchive, { type: 'SHUTDOWN' })
									if (children.tagArchive?.getSnapshot().status === 'active')
										enq.sendTo(children.tagArchive, { type: 'SHUTDOWN' })
								},
								always: ({ context }) =>
									Object.keys(context.results).length === 11 ? { target: 'closed' } : undefined,
								on: {
									NAME_TEXT: {},
									TRANSACTION_ROUTE: {},
									TRANSACTION_FORM: {},
									TRANSACTION_TEXT: {},
									TRANSACTION_EDIT: {},
									ARCHIVE_ACCOUNT: {},
									SET_DELETE: {},
									ACCOUNT: {},
									MANAGEMENT: {},
									OBSERVE: {},
									SHUTDOWN: {},
									FORM_CLOSED: {}
								}
							},
							closed: { type: 'final' }
						}
					},
					accountText: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'accountText',
									src: 'name',
									input: ({ self }) => ({
										textScope: `${dependencies?.textScope?.() ?? 'unbound'}/account`,
										revision: () =>
											self.getSnapshot()?.children.account?.getSnapshot().context.draftRevision ??
											-1,
										canWrite: () => {
											const snapshot = self.getSnapshot()
											const form = snapshot.children.account?.getSnapshot()
											const current =
												snapshot.children.account?.getSnapshot().context.observation?.facts
											const fresh = observe()
											if (
												!snapshot.matches({ owning: { control: 'active' } }) ||
												form?.status !== 'active' ||
												!form.can({ type: 'CHANGE', values: undefined }) ||
												!current ||
												!accountOptions.sameScope(
													accountOptions.scopeOf(current),
													accountOptions.scopeOf(fresh)
												)
											)
												return false
											const [assessed] = initialTransition(accountCreationAccessMachine, {
												organizationId: fresh.organizationId,
												userId: fresh.identityId ?? undefined,
												sessionReady: fresh.sessionReady,
												membership: fresh.membership,
												loading: fresh.loading,
												error: fresh.error
											})
											return assessed.hasTag('can-create')
										}
									}),
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, accountText: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, accountText: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					categoryText: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'categoryText',
									src: 'name',
									input: ({ self }) => ({
										textScope: `${dependencies?.textScope?.() ?? 'unbound'}/category`,
										revision: () =>
											self.getSnapshot()?.children.category?.getSnapshot().context.draftRevision ??
											-1,
										canWrite: () => {
											const snapshot = self.getSnapshot()
											const form = snapshot.children.category?.getSnapshot()
											const current =
												snapshot.children.category?.getSnapshot().context.observation?.facts
											const fresh = management('category')
											if (
												!snapshot.matches({ owning: { control: 'active' } }) ||
												form?.status !== 'active' ||
												!form.can({ type: 'CHANGE', values: undefined }) ||
												!current ||
												!classification.category.sameScope(
													classification.category.scopeOf(current),
													classification.category.scopeOf(fresh)
												)
											)
												return false
											const [assessed] = initialTransition(classification.category.availability, {
												revision: 0,
												facts: fresh
											})
											return (
												classification.category.selectAvailability(assessed).readiness.kind ===
												'ready'
											)
										}
									}),
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, categoryText: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, categoryText: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					tagText: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'tagText',
									src: 'name',
									input: ({ self }) => ({
										textScope: `${dependencies?.textScope?.() ?? 'unbound'}/tag`,
										revision: () =>
											self.getSnapshot()?.children.tag?.getSnapshot().context.draftRevision ?? -1,
										canWrite: () => {
											const snapshot = self.getSnapshot()
											const form = snapshot.children.tag?.getSnapshot()
											const current =
												snapshot.children.tag?.getSnapshot().context.observation?.facts
											const fresh = management('tag')
											if (
												!snapshot.matches({ owning: { control: 'active' } }) ||
												form?.status !== 'active' ||
												!form.can({ type: 'CHANGE', values: undefined }) ||
												!current ||
												!classification.tag.sameScope(
													classification.tag.scopeOf(current),
													classification.tag.scopeOf(fresh)
												)
											)
												return false
											const [assessed] = initialTransition(classification.tag.availability, {
												revision: 0,
												facts: fresh
											})
											return (
												classification.tag.selectAvailability(assessed).readiness.kind === 'ready'
											)
										}
									}),
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, tagText: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, tagText: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					transaction: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'transaction',
									src: 'transaction',
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: {
													...args.context.results,
													transaction: retainResourceRelease(args.event.output, {
														outcome: matchesState({ owning: { control: 'active' } }, args.value)
															? 'releasedWithFailure'
															: 'released'
													})
												}
											}
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, transaction: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					deleteGrants: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'deleteGrants',
									src: 'deleteGrants',
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, deleteGrants: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, deleteGrants: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					accountArchive: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'accountArchive',
									src: 'accountArchive',
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, accountArchive: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, accountArchive: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					account: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'account',
									src: 'account',
									input: observe,
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, account: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, account: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					category: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'category',
									src: 'category',
									input: () => management('category'),
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, category: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, category: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					tag: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'tag',
									src: 'tag',
									input: () => management('tag'),
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, tag: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: { results: { ...context.results, tag: { outcome: 'unresolved' } } }
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					categoryArchive: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'categoryArchive',
									src: 'categoryArchive',
									input: () => management('category'),
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, categoryArchive: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, categoryArchive: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					},
					tagArchive: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'tagArchive',
									src: 'tagArchive',
									input: () => management('tag'),
									onDone: (args, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										const release: WorkspaceResourceRelease = {
											outcome: matchesState({ owning: { control: 'active' } }, args.value)
												? 'releasedWithFailure'
												: 'released'
										}
										return {
											target: 'closed',
											context: { results: { ...args.context.results, tagArchive: release } }
										}
									},
									onError: ({ context }, enq) => {
										enq.raise({ type: 'FORM_CLOSED' })
										return {
											target: 'closed',
											context: {
												results: { ...context.results, tagArchive: { outcome: 'unresolved' } }
											}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					}
				},
				onDone: { target: 'released' }
			},
			released: { type: 'final' }
		}
	})
}

export function selectWorkspaceAccountForm(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceFormsMachine>> | undefined
) {
	const account = snapshot?.children.account?.getSnapshot()
	type Options = ReturnType<typeof createAccountCreationFormOptions>
	return account
		? selectScopedFormView<
				AccountFormValues,
				Account,
				AccountCreationReason,
				AccountCreationScope,
				AccountCreationObservation,
				SnapshotFrom<Options['availability']>,
				SnapshotFrom<Options['operation']>
			>(account, { successContent: 'replace' })
		: undefined
}

export function selectWorkspaceManagementForms(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceFormsMachine>> | undefined
) {
	type Options = ReturnType<typeof createClassificationFormOptions>
	const category = snapshot?.children.category?.getSnapshot()
	const tag = snapshot?.children.tag?.getSnapshot()
	const categoryArchive = snapshot?.children.categoryArchive?.getSnapshot()
	const tagArchive = snapshot?.children.tagArchive?.getSnapshot()
	return {
		category: category
			? selectScopedFormView<
					z.output<typeof categoryFormSchema>,
					Category,
					ManagementReason,
					ManagementScope,
					ManagementObservation,
					SnapshotFrom<Options['category']['availability']>,
					SnapshotFrom<Options['category']['operation']>
				>(category, { successContent: 'replace' })
			: undefined,
		tag: tag
			? selectScopedFormView<
					z.output<typeof tagFormSchema>,
					Tag,
					ManagementReason,
					ManagementScope,
					ManagementObservation,
					SnapshotFrom<Options['tag']['availability']>,
					SnapshotFrom<Options['tag']['operation']>
				>(tag, { successContent: 'replace' })
			: undefined,
		categoryArchive: categoryArchive
			? selectScopedFormView<
					z.output<typeof categoryArchiveSchema>,
					string,
					ManagementReason,
					ManagementScope,
					ManagementObservation,
					SnapshotFrom<Options['categoryArchive']['availability']>,
					SnapshotFrom<Options['categoryArchive']['operation']>
				>(categoryArchive, { successContent: 'retain' })
			: undefined,
		tagArchive: tagArchive
			? selectScopedFormView<
					z.output<typeof tagArchiveSchema>,
					string,
					ManagementReason,
					ManagementScope,
					ManagementObservation,
					SnapshotFrom<Options['tagArchive']['availability']>,
					SnapshotFrom<Options['tagArchive']['operation']>
				>(tagArchive, { successContent: 'retain' })
			: undefined
	}
}

export function selectWorkspaceAccountActions(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceFormsMachine>> | undefined
) {
	const archive = snapshot?.children.accountArchive?.getSnapshot()
	const grants = snapshot?.children.deleteGrants?.getSnapshot()
	return {
		archive: archive ? selectAccountArchiveView(archive) : undefined,
		grants: grants ? selectAccountDeleteGrantView(grants) : undefined
	}
}

export function selectWorkspaceTransactionRoute(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceFormsMachine>> | undefined
) {
	return selectTransactionRouteView(snapshot?.children.transaction?.getSnapshot())
}

export function selectWorkspaceTransactionTransferObservationState(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceFormsMachine>> | undefined
) {
	return selectTransactionTransferObservationState(snapshot?.children.transaction?.getSnapshot())
}

export function selectWorkspaceTransactionTextReply(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceFormsMachine>> | undefined
) {
	return selectTransactionTextReply(snapshot?.children.transaction?.getSnapshot())
}

export function selectWorkspaceNameTextReply(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceFormsMachine>> | undefined,
	form: NameFormSlot
) {
	if (!snapshot?.matches({ owning: { control: 'active' } })) return undefined
	const child =
		form === 'account'
			? snapshot.children.accountText
			: form === 'category'
				? snapshot.children.categoryText
				: snapshot.children.tagText
	return selectNativeNameReply(child?.getSnapshot())
}
