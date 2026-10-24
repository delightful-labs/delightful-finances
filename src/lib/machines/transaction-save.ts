import { assign, enqueueActions, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Check } from '#lib/schema.js'
import { normalizedName } from '#lib/domain/names.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import {
	desiredCheck,
	ledgerValues,
	parseSaveRequest,
	sameSaveScope,
	type TransactionCheckpoint
} from '#lib/transaction-save-contract.js'
import type { TransactionSaveValues } from '#lib/validation/transactions.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult,
	FormSettlement
} from '#lib/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryScope,
	TransactionEntryReason
} from '#lib/transaction-entry-contract.js'
import { createCheckCreationMachine } from './check-create-persistence.js'
import { createIndependentTransactionPersistenceMachine } from './independent-transaction-persistence.js'

export type TransactionSaveDb = Pick<ReturnType<typeof getDb>, 'beginTransaction' | 'all'>
type Input = FormOperationInput<
	TransactionSaveValues,
	TransactionEntryScope,
	TransactionEntryObservation
>
type Result = FormOperationResult<void, TransactionEntryReason>
type Context = {
	input: Input | undefined
	values: TransactionSaveValues | undefined
	checkpoint: TransactionCheckpoint | undefined
	facts: TransactionEntryObservation | undefined
	check: Check | undefined
	observed: OutputFrom<ReturnType<typeof makeReadLedger>> | undefined
	result: Result | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing staged-save resource')
	return value
}
function makeReadLedger(db: TransactionSaveDb) {
	return fromPromise(({ input }: { input: string }) => {
		return db.all(
			app.transactions.where({ id: input }).include({ tags: { tag: true }, check: true }),
			{
				tier: ReadTier.Remote
			}
		)
	})
}
function matchingLedger(context: Context) {
	const previous = context.checkpoint?.submitted
	const row = context.observed?.[0]
	if (!previous || !row) return false
	const names = (values: readonly string[]) =>
		JSON.stringify([...new Set(values.map(normalizedName))].sort())
	return (
		row.organizationId === previous.organizationId &&
		row.accountId === previous.accountId &&
		row.categoryId === previous.categoryId &&
		row.kind === previous.kind &&
		row.source === previous.source.source &&
		(previous.source.source !== 'simplefin' || row.externalId === previous.source.externalId) &&
		row.amountMinor === previous.money.amountMinor &&
		row.currency === previous.money.currency &&
		row.bookedOn === previous.bookedOn &&
		(row.description ?? '') === (previous.description ?? '') &&
		(row.memo ?? '') === (previous.memo ?? '') &&
		row.paymentMethod === previous.paymentMethod &&
		row.checkId === previous.checkId &&
		(previous.checkId === null ||
			(row.check?.id === previous.checkId &&
				row.check.accountId === previous.accountId &&
				row.check.organizationId === previous.organizationId)) &&
		row.tags.every(
			(link) =>
				link.organizationId === row.organizationId &&
				link.tag?.organizationId === row.organizationId &&
				link.tag.kind === row.kind
		) &&
		names(row.tags.flatMap((link) => (link.tag ? [link.tag.name] : []))) ===
			names(previous.tags ?? [])
	)
}
function checkCompatible(context: Context) {
	const values = required(context.values)
	return (
		context.check?.id === context.checkpoint?.checkId &&
		context.check?.organizationId === values.organizationId &&
		(context.check.accountId === values.accountId ||
			(context.input?.request.scope.transactionId === context.facts?.transaction?.id &&
				context.facts?.transaction?.checkId === context.check.id &&
				context.facts.transaction.accountId === context.check.accountId))
	)
}
function checkMatches(context: Context, values = context.checkpoint?.checkValues) {
	return (
		checkCompatible(context) &&
		(!values ||
			(context.check?.checkNumber === values.checkNumber &&
				context.check.checkDate === values.checkDate &&
				(context.check.payerName ?? '') === (values.payerName ?? '') &&
				(context.check.bankName ?? '') === (values.bankName ?? '') &&
				(context.check.memoOnCheck ?? '') === (values.memoOnCheck ?? '')))
	)
}
function requestedCheck(context: Context) {
	const desired = desiredCheck(required(context.values))
	if (!desired) return undefined
	return {
		...desired,
		accountId: context.check?.accountId ?? desired.accountId,
		payerName: desired.payerName ?? context.check?.payerName ?? undefined,
		bankName: desired.bankName ?? context.check?.bankName ?? undefined,
		memoOnCheck: desired.memoOnCheck ?? context.check?.memoOnCheck ?? undefined
	}
}
function available(context: Context) {
	const f = context.facts
	const v = context.values
	const scope = context.input?.request.scope
	return (
		f &&
		v &&
		scope &&
		sameSaveScope(scope, f) &&
		f.sessionReady &&
		!f.loading &&
		!f.failed &&
		f.identityId === f.membership?.userId &&
		f.organizationId === v.organizationId &&
		f.kind === v.kind &&
		canWriteAccount(f.membership, v.organizationId, v.accountId, f.grants) &&
		(!scope.transactionId ||
			(f.transaction?.id === scope.transactionId &&
				canWriteAccount(f.membership, v.organizationId, f.transaction.accountId, f.grants))) &&
		f.accounts.some(
			(a) =>
				a.id === v.accountId &&
				a.organizationId === v.organizationId &&
				a.archivedAt === null &&
				a.currency === v.money.currency
		) &&
		f.categories.some(
			(c) =>
				c.id === v.categoryId &&
				c.organizationId === v.organizationId &&
				c.kind === v.kind &&
				c.archivedAt === null
		)
	)
}

/** Finite attempt; the form owner retains its validated checkpoint between attempts. */
export function createTransactionSaveMachine(
	db: TransactionSaveDb,
	observe: () => TransactionEntryObservation
) {
	const actors = {
		validate: fromPromise(({ input }: { input: Input }) =>
			Promise.resolve(
				parseSaveRequest(input.request.values, input.request.checkpoint, input.request.scope)
			)
		),
		allocate: fromPromise(
			({
				input
			}: {
				input: { values: TransactionSaveValues; scope: TransactionEntryScope }
			}): Promise<TransactionCheckpoint> =>
				Promise.resolve({
					version: 1,
					scope: { ...input.scope, binding: required(input.scope.binding ?? undefined) },
					accountId: input.values.accountId,
					transactionId: input.scope.transactionId ?? crypto.randomUUID(),
					checkId:
						input.values.paymentMethod === 'check'
							? input.values.check.kind === 'existing'
								? input.values.check.id
								: crypto.randomUUID()
							: null,
					checkIntent: input.values.paymentMethod === 'check' ? input.values.check.kind : 'none',
					checkSettlement: 'notStarted',
					transactionSettlement: 'notStarted'
				})
		),
		observe: fromPromise(() => Promise.resolve(observe())),
		readLedger: makeReadLedger(db),
		readCheck: fromPromise(({ input }: { input: { id: string; uncertain: boolean } }) => {
			return db.all(app.checks.where({ id: input.id }), {
				tier: input.uncertain ? ReadTier.Remote : ReadTier.LocalFirst
			})
		}),
		checkWrite: createCheckCreationMachine(db),
		ledgerWrite: createIndependentTransactionPersistenceMachine(db)
	}
	const model = setup<
		Context,
		FormChildEvent<TransactionEntryObservation>,
		typeof actors,
		{},
		{ forward: undefined },
		{ interrupted: undefined; closing: undefined; invalidated: undefined; cancelling: undefined },
		never,
		string,
		Input,
		Result
	>({
		actors,
		actions: {
			forward: enqueueActions(({ self, event, enqueue }) => {
				if (event.type === 'OBSERVE') return
				for (const id of ['checkWrite', 'ledgerWrite']) {
					const child = self.getSnapshot().children[id]
					if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, event)
				}
			})
		},
		guards: {
			interrupted: stateIn({ running: { control: 'interrupted' } }),
			closing: stateIn({ running: { control: { interrupted: 'closed' } } }),
			invalidated: stateIn({ running: { control: { interrupted: 'scopeChanged' } } }),
			cancelling: stateIn({ running: { control: { interrupted: 'cancelled' } } })
		}
	})
	const patch = (field: 'checkSettlement' | 'transactionSettlement', value: FormSettlement) =>
		model.assign({
			checkpoint: ({ context }) => ({ ...required(context.checkpoint), [field]: value })
		})
	const terminal = (
		outcome:
			'succeeded' | 'failed' | 'partial' | 'unresolved' | 'cancelled' | 'scopeChanged' | 'closed'
	) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }): Result => {
					const checkpoint = context.checkpoint
					const recovery = checkpoint ? { checkpoint } : {}
					const settlement = checkpoint?.transactionSettlement ?? 'notStarted'
					if (outcome === 'succeeded')
						return {
							outcome,
							value: undefined,
							settlement: settlement === 'confirmed' ? 'confirmed' : 'locallyPersisted',
							...recovery
						}
					if (outcome === 'partial')
						return {
							outcome,
							value: undefined,
							reason: 'checkRetained',
							settlement:
								checkpoint?.checkSettlement === 'locallyPersisted' ? 'locallyPersisted' : 'unknown',
							...recovery
						}
					if (outcome === 'unresolved')
						return {
							outcome: 'partial',
							value: undefined,
							reason: 'saveUnresolved',
							settlement: 'unknown',
							...recovery
						}
					if (outcome === 'failed')
						return { outcome, code: 'operationFailed', settlement, ...recovery }
					return { outcome, settlement, ...recovery }
				},
				input: undefined,
				values: undefined,
				facts: undefined,
				check: undefined,
				observed: undefined
			})
		})
	return model.createMachine({
		id: 'transaction-save',
		initial: 'running',
		context: ({ input }) => ({
			input,
			values: undefined,
			checkpoint: undefined,
			facts: undefined,
			check: undefined,
			observed: undefined,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						on: {
							CANCEL: { target: '.interrupted.cancelled', actions: 'forward' },
							INVALIDATE: { target: '.interrupted.scopeChanged', actions: 'forward' },
							SHUTDOWN: { target: '.interrupted.closed', actions: 'forward' }
						},
						states: {
							active: {},
							interrupted: {
								initial: 'cancelled',
								states: {
									cancelled: { on: { CANCEL: {} } },
									scopeChanged: { on: { CANCEL: {}, INVALIDATE: {} } },
									closed: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {} } }
								}
							}
						}
					},
					flow: {
						initial: 'validating',
						states: {
							validating: {
								invoke: {
									src: 'validate',
									input: ({ context }) => required(context.input),
									onDone: {
										target: 'checkingCheckpoint',
										actions: assign({
											values: ({ event }) => event.output.values,
											checkpoint: ({ event }) => event.output.checkpoint
										})
									},
									onError: 'finishing'
								}
							},
							checkingCheckpoint: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{ guard: ({ context }) => context.checkpoint !== undefined, target: 'observing' },
									{ target: 'allocating' }
								]
							},
							allocating: {
								invoke: {
									src: 'allocate',
									input: ({ context }) => ({
										values: required(context.values),
										scope: required(context.input).request.scope
									}),
									onDone: [
										{
											guard: 'interrupted',
											target: 'finishing',
											actions: assign({ checkpoint: ({ event }) => event.output })
										},
										{
											target: 'observing',
											actions: assign({ checkpoint: ({ event }) => event.output })
										}
									],
									onError: 'finishing'
								}
							},
							observing: {
								on: { CANCEL: 'finishing', INVALIDATE: 'finishing', SHUTDOWN: 'finishing' },
								invoke: {
									src: 'observe',
									onDone: {
										target: 'assessing',
										actions: assign({ facts: ({ event }) => event.output })
									},
									onError: 'finishing'
								}
							},
							assessing: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{
										guard: ({ context }) =>
											['locallyPersisted', 'confirmed'].includes(
												context.checkpoint?.transactionSettlement ?? ''
											),
										target: 'finishing'
									},
									{ guard: ({ context }) => !available(context), target: 'finishing' },
									{
										guard: ({ context }) => context.checkpoint?.transactionSettlement === 'unknown',
										target: 'reconcilingLedger'
									},
									{ target: 'assessingCheck' }
								]
							},
							reconcilingLedger: {
								on: { CANCEL: 'finishing', INVALIDATE: 'finishing', SHUTDOWN: 'finishing' },
								invoke: {
									src: 'readLedger',
									input: ({ context }) => required(context.checkpoint).transactionId,
									onDone: {
										target: 'checkingLedger',
										actions: assign({ observed: ({ event }) => event.output })
									},
									onError: 'finishing'
								}
							},
							checkingLedger: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{
										guard: ({ context }) => matchingLedger(context),
										target: 'finishing',
										actions: patch('transactionSettlement', 'confirmed')
									},
									{ target: 'finishing' }
								]
							},
							assessingCheck: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{
										guard: ({ context }) => required(context.values).paymentMethod !== 'check',
										target: 'reobserving'
									},
									{
										guard: ({ context }) => required(context.checkpoint).checkId === null,
										target: 'allocatingCheck'
									},
									{
										guard: ({ context }) => {
											const v = required(context.values)
											return (
												v.paymentMethod === 'check' &&
												v.check.kind === 'new' &&
												['notStarted', 'rejected'].includes(
													required(context.checkpoint).checkSettlement
												)
											)
										},
										target: 'creatingCheck'
									},
									{ target: 'readingCheck' }
								]
							},
							allocatingCheck: {
								invoke: {
									src: 'allocate',
									input: ({ context }) => ({
										values: required(context.values),
										scope: required(context.input).request.scope
									}),
									onDone: {
										target: 'assessingCheck',
										actions: assign({
											checkpoint: ({ context, event }) => ({
												...required(context.checkpoint),
												checkId: event.output.checkId,
												checkIntent: event.output.checkIntent
											})
										})
									},
									onError: 'finishing'
								}
							},
							readingCheck: {
								on: { CANCEL: 'finishing', INVALIDATE: 'finishing', SHUTDOWN: 'finishing' },
								invoke: {
									src: 'readCheck',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										uncertain: context.checkpoint?.checkSettlement === 'unknown'
									}),
									onDone: {
										target: 'checkingCheck',
										actions: assign({ check: ({ event }) => event.output[0] })
									},
									onError: 'finishing'
								}
							},
							checkingCheck: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{ guard: ({ context }) => !checkCompatible(context), target: 'finishing' },
									{
										guard: ({ context }) =>
											required(context.checkpoint).checkSettlement === 'unknown' &&
											!checkMatches(context),
										target: 'finishing'
									},
									{
										target: 'assessingMetadata',
										actions: patch('checkSettlement', 'locallyPersisted')
									}
								]
							},
							assessingMetadata: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{
										guard: ({ context }) => {
											const desired = requestedCheck(context)
											return desired !== undefined && !checkMatches(context, desired)
										},
										target: 'updatingCheck'
									},
									{ target: 'reobserving' }
								]
							},
							creatingCheck: {
								entry: [
									assign({
										checkpoint: ({ context }) => ({
											...required(context.checkpoint),
											checkValues: requestedCheck(context)
										})
									}),
									patch('checkSettlement', 'unknown')
								],
								invoke: {
									id: 'checkWrite',
									src: 'checkWrite',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										values: required(required(context.checkpoint).checkValues),
										mode: 'create'
									}),
									onDone: {
										target: 'afterCheckWrite',
										actions: assign({
											checkpoint: ({ context, event }) => ({
												...required(context.checkpoint),
												checkSettlement: event.output.settlement
											})
										})
									},
									onError: 'finishing'
								}
							},
							updatingCheck: {
								entry: [
									assign({
										checkpoint: ({ context }) => ({
											...required(context.checkpoint),
											checkValues: requestedCheck(context)
										})
									}),
									patch('checkSettlement', 'unknown')
								],
								invoke: {
									id: 'checkWrite',
									src: 'checkWrite',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										values: required(required(context.checkpoint).checkValues),
										mode: 'edit'
									}),
									onDone: {
										target: 'afterCheckWrite',
										actions: assign({
											checkpoint: ({ context, event }) => ({
												...required(context.checkpoint),
												checkSettlement: event.output.settlement
											})
										})
									},
									onError: 'finishing'
								}
							},
							afterCheckWrite: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{
										guard: ({ context }) =>
											required(context.checkpoint).checkSettlement === 'locallyPersisted',
										target: 'verifyingCheck'
									},
									{ target: 'finishing' }
								]
							},
							verifyingCheck: {
								on: { CANCEL: 'finishing', INVALIDATE: 'finishing', SHUTDOWN: 'finishing' },
								invoke: {
									src: 'readCheck',
									input: ({ context }) => ({
										id: required(required(context.checkpoint).checkId ?? undefined),
										uncertain: false
									}),
									onDone: {
										target: 'checkingSavedCheck',
										actions: assign({ check: ({ event }) => event.output[0] })
									},
									onError: 'finishing'
								}
							},
							checkingSavedCheck: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{ guard: ({ context }) => checkMatches(context), target: 'reobserving' },
									{ target: 'finishing' }
								]
							},
							reobserving: {
								on: { CANCEL: 'finishing', INVALIDATE: 'finishing', SHUTDOWN: 'finishing' },
								invoke: {
									src: 'observe',
									onDone: {
										target: 'reassessing',
										actions: assign({ facts: ({ event }) => event.output })
									},
									onError: 'finishing'
								}
							},
							reassessing: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{ guard: ({ context }) => !available(context), target: 'finishing' },
									{ target: 'savingLedger' }
								]
							},
							savingLedger: {
								entry: [
									assign({
										checkpoint: ({ context }) => ({
											...required(context.checkpoint),
											submitted: ledgerValues(
												required(context.values),
												required(context.checkpoint).checkId
											)
										})
									}),
									patch('transactionSettlement', 'unknown')
								],
								invoke: {
									id: 'ledgerWrite',
									src: 'ledgerWrite',
									input: ({ context }) => ({
										transactionId: required(context.checkpoint).transactionId,
										values: required(required(context.checkpoint).submitted),
										mode: context.input?.request.scope.transactionId ? 'edit' : 'create',
										...(context.values?.paymentMethod === 'check' &&
										context.check &&
										context.check.accountId !== context.values.accountId
											? { moveCheckFromAccountId: context.check.accountId }
											: {})
									}),
									onDone: {
										target: 'finishing',
										actions: assign({
											checkpoint: ({ context, event }) => ({
												...required(context.checkpoint),
												transactionSettlement: event.output.settlement
											})
										})
									},
									onError: 'finishing'
								}
							},
							finishing: {
								always: [
									{ guard: 'closing', target: '#transaction-save.closed' },
									{ guard: 'invalidated', target: '#transaction-save.scopeChanged' },
									{ guard: 'cancelling', target: '#transaction-save.cancelled' },
									{
										guard: ({ context }) =>
											['locallyPersisted', 'confirmed'].includes(
												context.checkpoint?.transactionSettlement ?? ''
											),
										target: '#transaction-save.succeeded'
									},
									{
										guard: ({ context }) =>
											context.checkpoint?.transactionSettlement === 'unknown' ||
											context.checkpoint?.checkSettlement === 'unknown',
										target: '#transaction-save.unresolved'
									},
									{
										guard: ({ context }) =>
											context.checkpoint?.checkSettlement === 'locallyPersisted',
										target: '#transaction-save.partial'
									},
									{ target: '#transaction-save.failed' }
								]
							}
						}
					}
				}
			},
			succeeded: terminal('succeeded'),
			failed: terminal('failed'),
			partial: terminal('partial'),
			unresolved: terminal('unresolved'),
			cancelled: terminal('cancelled'),
			scopeChanged: terminal('scopeChanged'),
			closed: terminal('closed')
		}
	})
}
