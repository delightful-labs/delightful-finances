import { m } from '#lib/paraglide/messages.js'
import { formReasonText } from '#lib/form-messages.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { EXPENSE, INCOME } from '#lib/domain/transaction-kind.js'
import { parseAmountMinor } from '#lib/domain/money.js'
import { type Account } from '#lib/schema.js'
import type { getDb } from 'jazz-tools/svelte'
import { assign, fromPromise, setup, stateIn, type SnapshotFrom } from 'xstate'
import { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormOperationInput,
	FormOperationResult,
	FormSettlement
} from '#lib/form-contract.js'
import type {
	InternalTransferEntryObservation,
	InternalTransferEntryReason,
	InternalTransferEntryScope,
	InternalTransferEntryValues
} from '#lib/transfer-create-contract.js'
import {
	currencyText,
	defaultTransactionCategory,
	dateOnlyText
} from '#lib/validation/transactions.js'
import { createSingleWriteFormOptions } from './scoped-form-policy.js'
import type { TransferWriteTracking } from './internal-transfer.js'
import {
	createTransferMutationRequestMachine,
	type TransferMutationGateway,
	type TransferMutationRequestInput
} from './internal-transfer-mutation-request.js'
import type { InternalTransferCreateResult } from './internal-transfer-create.js'
import type { TransferMutationResult } from './internal-transfer-mutation-owner.js'

type CreatedTransfer = {
	transferId: string
	expenseTransactionId: string
	incomeTransactionId: string
}
type Dependencies = {
	db: Pick<ReturnType<typeof getDb>, 'beginTransaction'>
	trackWrite: (write: TransferWriteTracking) => void
	observe: () => InternalTransferEntryObservation
	mutationGateway: TransferMutationGateway
}
type PersistenceInput = FormOperationInput<
	InternalTransferEntryValues,
	InternalTransferEntryScope,
	InternalTransferEntryObservation
>

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error('Missing paired transfer form value')
	return value
}

function createdResult(result: TransferMutationResult): InternalTransferCreateResult {
	return result.operation === 'create'
		? result.result
		: { outcome: 'unavailable', settlement: 'unresolved' }
}

function mapSettlement(settlement: 'notStarted' | 'unresolved'): FormSettlement {
	return settlement === 'notStarted' ? settlement : 'unknown'
}

function createPersistence(dependencies: Dependencies) {
	type Context = {
		input: PersistenceInput
		result: FormOperationResult<CreatedTransfer, InternalTransferEntryReason> | undefined
	}
	type Event = FormChildEvent<InternalTransferEntryObservation>
	const actors = { create: createTransferMutationRequestMachine(dependencies.mutationGateway) }
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		PersistenceInput,
		FormOperationResult<CreatedTransfer, InternalTransferEntryReason>
	>({
		actors
	})
	const forward = workflow.enqueueActions(({ context, event, self, enqueue }) => {
		const child = self.getSnapshot().children.create
		if (!child || child.getSnapshot().status !== 'active') return
		if ('observation' in event) {
			const previous = context.input.observation.facts
			const next = event.observation.facts
			if (
				previous.identityId !== next.identityId ||
				previous.organizationId !== next.organizationId ||
				previous.binding !== next.binding
			)
				enqueue.sendTo(child, { type: 'INVALIDATE' })
			return
		}
		enqueue.sendTo(child, event)
	})
	return workflow.createMachine({
		id: 'internal-transfer-create-form-operation',
		initial: 'creating',
		context: ({ input }) => ({ input, result: undefined }),
		output: ({ context }) => required(context.result),
		states: {
			creating: {
				invoke: {
					id: 'create',
					src: 'create',
					input: ({ context }): Extract<TransferMutationRequestInput, { operation: 'create' }> => {
						const { request } = context.input
						const { values, scope } = request
						return {
							workspaceId: required(scope.organizationId),
							operation: 'create',
							input: {
								db: dependencies.db,
								identityId: required(scope.identityId),
								organizationId: required(scope.organizationId),
								expenseAccountId: values.expenseAccountId,
								incomeAccountId: values.incomeAccountId,
								expenseAmountMinor: values.expenseAmountMinor,
								incomeAmountMinor: values.incomeAmountMinor,
								expenseCurrency: values.expenseCurrency,
								incomeCurrency: values.incomeCurrency,
								bookedOn: values.bookedOn,
								trackWrite: dependencies.trackWrite
							}
						}
					},
					onDone: {
						target: 'complete',
						actions: assign({
							result: ({
								event
							}): FormOperationResult<CreatedTransfer, InternalTransferEntryReason> => {
								const result = createdResult(event.output)
								if (result.outcome === 'succeeded')
									return {
										outcome: 'succeeded',
										value: {
											transferId: result.transferId,
											expenseTransactionId: result.expenseTransactionId,
											incomeTransactionId: result.incomeTransactionId
										},
										settlement: 'locallyPersisted'
									}
								if (result.outcome === 'denied')
									return {
										outcome: 'denied',
										reason: 'permissionChanged',
										settlement: 'notStarted'
									}
								if (result.outcome === 'incompatible')
									return {
										outcome: 'unavailable',
										reason: 'incompatible',
										settlement: 'notStarted'
									}
								if (
									result.outcome === 'cancelled' ||
									result.outcome === 'closed' ||
									result.outcome === 'scopeChanged'
								)
									return { outcome: result.outcome, settlement: mapSettlement(result.settlement) }
								if (result.settlement === 'unresolved')
									return { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
								return { outcome: 'unavailable', reason: 'unavailable', settlement: 'notStarted' }
							}
						})
					},
					onError: {
						target: 'complete',
						actions: assign({
							result: (): FormOperationResult<CreatedTransfer, InternalTransferEntryReason> => ({
								outcome: 'failed',
								code: 'operationFailed',
								settlement: 'unknown'
							})
						})
					}
				}
			},
			complete: { type: 'final' }
		},
		on: {
			OBSERVE: { actions: forward },
			CANCEL: { actions: forward },
			INVALIDATE: { actions: forward },
			SHUTDOWN: { actions: forward }
		}
	})
}

function writableAccounts(facts: InternalTransferEntryObservation): Account[] {
	return facts.accounts.filter(
		(account) =>
			account.organizationId === facts.organizationId &&
			account.archivedAt === null &&
			facts.membership?.userId === facts.identityId &&
			canWriteAccount(facts.membership, facts.organizationId, account.id, facts.grants)
	)
}

export function internalTransferEntryScope(
	facts: InternalTransferEntryObservation
): InternalTransferEntryScope {
	return {
		identityId: facts.identityId,
		organizationId: facts.organizationId,
		binding: facts.binding
	}
}

export function sameInternalTransferEntryScope(
	left: InternalTransferEntryScope,
	right: InternalTransferEntryScope
) {
	return (
		left.identityId === right.identityId &&
		left.organizationId === right.organizationId &&
		left.binding === right.binding
	)
}

export function selectInternalTransferEntryAccounts(facts: InternalTransferEntryObservation) {
	return writableAccounts(facts)
}

export function createInternalTransferEntryAvailability(binding: object) {
	type Context = {
		observation: FormObservation<InternalTransferEntryObservation>
		capability: FormCapability<InternalTransferEntryScope, InternalTransferEntryReason>
	}
	type Event = FormChildEvent<InternalTransferEntryObservation>
	const machine = setup<
		Context,
		Event,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<InternalTransferEntryObservation>
	>({})
	const blocked = (reason: InternalTransferEntryReason) =>
		machine.assign({
			capability: ({ context }) => ({
				revision: context.observation.revision,
				scope: internalTransferEntryScope(context.observation.facts),
				readiness: { kind: 'blocked', reason }
			})
		})
	return machine.createMachine({
		id: 'internal-transfer-entry-availability',
		initial: 'assessing',
		context: ({ input }) => ({
			observation: input,
			capability: {
				revision: -1,
				scope: internalTransferEntryScope(input.facts),
				readiness: { kind: 'blocked', reason: 'loading' }
			}
		}),
		on: {
			OBSERVE: {
				target: '.assessing',
				actions: assign({ observation: ({ event }) => event.observation })
			}
		},
		states: {
			assessing: {
				always: [
					{
						guard: ({ context }) =>
							!context.observation.facts.sessionReady ||
							context.observation.facts.binding !== binding ||
							!context.observation.facts.identityId,
						target: 'sessionUnavailable'
					},
					{
						guard: ({ context }) => !context.observation.facts.organizationId,
						target: 'selectWorkspace'
					},
					{ guard: ({ context }) => context.observation.facts.failed, target: 'loadFailed' },
					{ guard: ({ context }) => context.observation.facts.loading, target: 'loading' },
					{
						guard: ({ context }) =>
							!context.observation.facts.accounts.some(
								(account) =>
									account.organizationId === context.observation.facts.organizationId &&
									account.archivedAt === null
							),
						target: 'noAccounts'
					},
					{
						guard: ({ context }) => writableAccounts(context.observation.facts).length === 0,
						target: 'readOnly'
					},
					{
						guard: ({ context }) => writableAccounts(context.observation.facts).length === 1,
						target: 'insufficientAccounts'
					},
					{
						guard: ({ context }) =>
							!defaultTransactionCategory({
								organizationId: context.observation.facts.organizationId,
								kind: EXPENSE,
								categories: context.observation.facts.categories
							}) ||
							!defaultTransactionCategory({
								organizationId: context.observation.facts.organizationId,
								kind: INCOME,
								categories: context.observation.facts.categories
							}),
						target: 'noCategories'
					},
					{ target: 'ready' }
				]
			},
			sessionUnavailable: { entry: blocked('sessionUnavailable') },
			selectWorkspace: { entry: blocked('selectWorkspace') },
			loadFailed: { entry: blocked('loadFailed') },
			loading: { entry: blocked('loading') },
			readOnly: { entry: blocked('readOnly') },
			noAccounts: { entry: blocked('noAccounts') },
			insufficientAccounts: { entry: blocked('insufficientAccounts') },
			noCategories: { entry: blocked('noCategories') },
			ready: {
				entry: assign({
					capability: ({ context }) => ({
						revision: context.observation.revision,
						scope: internalTransferEntryScope(context.observation.facts),
						readiness: { kind: 'ready' }
					})
				})
			}
		}
	})
}

export function selectInternalTransferEntryAvailability(
	snapshot: SnapshotFrom<ReturnType<typeof createInternalTransferEntryAvailability>>
) {
	return snapshot.context.capability
}

const amountText = (currency: string) =>
	z.string().transform((value, context) => {
		const amount = parseAmountMinor(value, currency)
		if (amount.kind === 'valid') return amount.amountMinor
		context.addIssue({ code: 'custom', message: 'Enter a valid amount.' })
		return z.NEVER
	})

const transferEntryFields = {
	expenseAccountId: z.uuid(),
	incomeAccountId: z.uuid(),
	bookedOn: dateOnlyText
}

export const internalTransferEntrySchema = z
	.discriminatedUnion('amountMode', [
		z.strictObject({
			...transferEntryFields,
			amountMode: z.literal('shared'),
			currency: currencyText,
			amount: z.string()
		}),
		z.strictObject({
			...transferEntryFields,
			amountMode: z.literal('separate'),
			expenseCurrency: currencyText,
			incomeCurrency: currencyText,
			expenseAmount: z.string(),
			incomeAmount: z.string()
		})
	])
	.transform((values, context) => {
		if (values.amountMode === 'shared') {
			const amount = amountText(values.currency).safeParse(values.amount)
			if (!amount.success) {
				context.addIssue({ code: 'custom', path: ['amount'], message: 'Enter a valid amount.' })
				return z.NEVER
			}
			return {
				expenseAccountId: values.expenseAccountId,
				incomeAccountId: values.incomeAccountId,
				expenseAmountMinor: amount.data,
				incomeAmountMinor: amount.data,
				expenseCurrency: values.currency,
				incomeCurrency: values.currency,
				bookedOn: values.bookedOn
			}
		}
		const expenseAmount = amountText(values.expenseCurrency).safeParse(values.expenseAmount)
		const incomeAmount = amountText(values.incomeCurrency).safeParse(values.incomeAmount)
		if (!expenseAmount.success || !incomeAmount.success) {
			if (!expenseAmount.success)
				context.addIssue({
					code: 'custom',
					path: ['expenseAmount'],
					message: 'Enter a valid amount.'
				})
			if (!incomeAmount.success)
				context.addIssue({
					code: 'custom',
					path: ['incomeAmount'],
					message: 'Enter a valid amount.'
				})
			return z.NEVER
		}
		return {
			expenseAccountId: values.expenseAccountId,
			incomeAccountId: values.incomeAccountId,
			expenseAmountMinor: expenseAmount.data,
			incomeAmountMinor: incomeAmount.data,
			expenseCurrency: values.expenseCurrency,
			incomeCurrency: values.incomeCurrency,
			bookedOn: values.bookedOn
		}
	})

export function createInternalTransferEntryFormOptions(dependencies: Dependencies) {
	const availability = createInternalTransferEntryAvailability(dependencies.db)
	const persistence = createPersistence(dependencies)
	return createSingleWriteFormOptions<
		InternalTransferEntryValues,
		CreatedTransfer,
		InternalTransferEntryReason,
		InternalTransferEntryScope,
		InternalTransferEntryObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof persistence>
	>({
		schema: internalTransferEntrySchema,
		mode: 'create',
		availability,
		selectAvailability: selectInternalTransferEntryAvailability,
		scopeOf: internalTransferEntryScope,
		sameScope: sameInternalTransferEntryScope,
		observe: dependencies.observe,
		classifyBlocked: (reason) => (reason === 'readOnly' ? 'denied' : 'unavailable'),
		persistence
	})
}

export const internalTransferEntryReasonLabels = {
	...formReasonText,
	insufficientAccounts: () => m['transfers.insufficient_accounts'](),
	permissionChanged: () => m['forms.read_only'](),
	incompatible: () => m['transfers.incompatible'](),
	unavailable: () => m['errors.save_subject']({ subject: m['nouns.transfer']({ count: 1 }) })
} satisfies Record<InternalTransferEntryReason, () => string>
