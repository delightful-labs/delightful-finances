import { workspaceHref } from '../domain/workspace-routes.js'
import { parseAmountMinor } from '#lib/domain/money.js'
import { normalizedName } from '#lib/domain/names.js'
import { assign, setup, type SnapshotFrom } from 'xstate'
import type { FormCapability, FormChildEvent, FormObservation } from '#lib/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryReason,
	TransactionEntryScope
} from '#lib/transaction-entry-contract.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { createSingleWriteFormOptions } from './scoped-form-policy.js'
import { transactionFormSchema } from '#lib/validation/transactions.js'
import type { TransactionDetail } from '#lib/schema.js'
import type { AppTransaction, IncomePaymentMethod } from '#lib/domain/transaction.js'

export function transactionEntryScope(f: TransactionEntryObservation): TransactionEntryScope {
	return {
		identityId: f.identityId,
		organizationId: f.organizationId,
		binding: f.binding,
		kind: f.kind,
		...(f.transactionId === undefined ? {} : { transactionId: f.transactionId })
	}
}
export function sameTransactionEntryScope(a: TransactionEntryScope, b: TransactionEntryScope) {
	return (
		a.identityId === b.identityId &&
		a.organizationId === b.organizationId &&
		a.binding === b.binding &&
		a.kind === b.kind &&
		a.transactionId === b.transactionId
	)
}
export function writableTransactionAccounts(
	f: Pick<
		TransactionEntryObservation,
		'accounts' | 'organizationId' | 'membership' | 'identityId' | 'grants'
	>
) {
	return f.accounts.filter(
		(a) =>
			a.organizationId === f.organizationId &&
			a.archivedAt === null &&
			f.membership?.userId === f.identityId &&
			canWriteAccount(f.membership, f.organizationId, a.id, f.grants)
	)
}
export function applicableTransactionCategories(
	f: Pick<TransactionEntryObservation, 'categories' | 'organizationId' | 'kind'>
) {
	return f.categories.filter(
		(c) => c.organizationId === f.organizationId && c.kind === f.kind && c.archivedAt === null
	)
}
export function applicableTransactionTags(f: TransactionEntryObservation) {
	return f.tags.filter(
		(tag) =>
			tag.organizationId === f.organizationId && tag.kind === f.kind && tag.archivedAt === null
	)
}
export function createTransactionEntryAvailability(binding: object) {
	return setup<
		{ observation: FormObservation<TransactionEntryObservation> },
		FormChildEvent<TransactionEntryObservation>,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<TransactionEntryObservation>
	>({}).createMachine({
		initial: 'checking',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: {
				target: '.checking',
				actions: assign({ observation: ({ event }) => event.observation })
			}
		},
		states: {
			checking: {
				always: [
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => !f.sessionReady || !f.identityId || f.binding !== binding,
						target: 'sessionUnavailable'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => !f.organizationId,
						target: 'selectWorkspace'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => f.failed,
						target: 'loadFailed'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => f.loading,
						target: 'loading'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.membership?.userId !== f.identityId ||
							f.membership?.organizationId !== f.organizationId ||
							f.membership?.role === 'viewer',
						target: 'readOnly'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							!f.accounts.some(
								(a) => a.organizationId === f.organizationId && a.archivedAt === null
							),
						target: 'noAccounts'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => writableTransactionAccounts(f).length === 0,
						target: 'readOnly'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => applicableTransactionCategories(f).length === 0,
						target: 'noCategories'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							(f.transactionId !== undefined && !f.transaction) ||
							(f.intent !== undefined &&
								(!validTransactionReferences(f, f.intent) ||
									(f.transaction != null &&
										((f.transaction.paymentMethod === 'check') !== inputHasCheckDetails(f.intent) ||
											(f.transaction.paymentMethod === 'check' &&
												f.intent.accountId !== f.transaction.accountId))))) ||
							(f.transaction !== undefined &&
								f.transaction !== null &&
								(!validTransactionReferences(f, transactionAsInput(f.transaction)) ||
									f.transaction.source !== 'manual' ||
									f.transaction.organizationId !== f.organizationId ||
									f.transaction.id !== f.transactionId ||
									(f.transaction.paymentMethod === 'check' && !f.transaction.checkDetails))),
						target: 'unavailableReference'
					},
					{ target: 'checkingTags' }
				]
			},
			checkingTags: {
				always: [
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							(f.intent?.tags ?? []).some(
								(name) =>
									!f.transaction?.tags?.some(
										(link) => link.tag && normalizedName(link.tag.name) === normalizedName(name)
									) &&
									applicableTransactionTags(f).filter(
										(tag) => normalizedName(tag.name) === normalizedName(name)
									).length > 1
							),
						target: 'ambiguousTagName'
					},
					{ target: 'ready' }
				]
			},
			ambiguousTagName: {},
			sessionUnavailable: {},
			selectWorkspace: {},
			loadFailed: {},
			loading: {},
			readOnly: {},
			noAccounts: {},
			noCategories: {},
			unavailableReference: {},
			ready: {}
		}
	})
}
export function selectTransactionEntryAvailability(
	s: SnapshotFrom<ReturnType<typeof createTransactionEntryAvailability>>
): FormCapability<TransactionEntryScope, TransactionEntryReason> {
	const { revision, facts } = s.context.observation
	const state = s.value
	if (state === 'checking' || state === 'checkingTags')
		throw new Error('Unassessed transaction entry')
	return {
		revision,
		scope: transactionEntryScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}
export function createTransactionEntryFormOptions(deps: {
	binding: object
	observe: () => TransactionEntryObservation
	create: (value: AppTransaction) => Promise<void>
	navigate?: (destination: string, signal: AbortSignal) => Promise<void>
	save?: (transactionId: TransactionDetail['id'], value: AppTransaction) => Promise<void>
}) {
	const availability = createTransactionEntryAvailability(deps.binding)
	const common = {
		availability,
		selectAvailability: selectTransactionEntryAvailability,
		scopeOf: transactionEntryScope,
		sameScope: sameTransactionEntryScope,
		observe: deps.observe,
		classifyBlocked: (reason: TransactionEntryReason): 'denied' | 'unavailable' =>
			reason === 'readOnly' ? 'denied' : 'unavailable'
	}
	const schema = transactionFormSchema(() => deps.observe())
	const createOptions = () => {
		const options = createSingleWriteFormOptions<
			AppTransaction,
			void,
			TransactionEntryReason,
			TransactionEntryScope,
			TransactionEntryObservation,
			SnapshotFrom<typeof availability>
		>({
			...common,
			schema,
			mode: 'create',
			successContent: 'replace',
			assessmentObservation: ({ request, observation }) => ({
				...observation.facts,
				intent: request.values
			}),
			write: async ({ request }) => deps.create(request.values)
		})
		const navigate = deps.navigate
		return navigate
			? {
					...options,
					complete: (scope: TransactionEntryScope, signal: AbortSignal) =>
						navigate(
							workspaceHref(
								scope.organizationId,
								scope.kind === 'income' ? '/income' : '/expenses'
							),
							signal
						)
				}
			: options
	}

	if (!deps.save) return createOptions()
	return createSingleWriteFormOptions<
		AppTransaction,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<typeof availability>
	>({
		...common,
		schema,
		mode: 'edit',
		initialValues: (facts) => {
			const initial = facts.transaction ? transactionAsInput(facts.transaction) : undefined
			if (!initial) throw new Error('Missing transaction')
			return initial
		},
		valuesEqual: (draft, original) => {
			if (!isTransactionFormDraft(draft)) return false
			const amount = parseAmountMinor(draft.amount)
			const names = (values: readonly string[]) => [...new Set(values.map(normalizedName))].sort()
			return (
				draft.accountId === original.accountId &&
				draft.categoryId === original.categoryId &&
				amount.kind === 'valid' &&
				amount.amountMinor === original.money.amountMinor &&
				draft.bookedOn === original.bookedOn &&
				(draft.description ?? '').trim() === (original.description ?? '') &&
				(draft.memo ?? '').trim() === (original.memo ?? '') &&
				JSON.stringify(names(draft.tags ?? [])) === JSON.stringify(names(original.tags ?? [])) &&
				(original.kind === 'expense' ||
					('paymentMethod' in original &&
						draft.paymentMethod === original.paymentMethod &&
						(original.paymentMethod !== 'check' ||
							((draft.checkNumber ?? '').trim() === original.checkDetails.checkNumber &&
								draft.checkDate === original.checkDetails.checkDate))))
			)
		},
		successContent: 'retain',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: request.values
		}),
		write: async ({ request }) => {
			const id = request.scope.transactionId
			if (!id) throw new Error('Missing transaction save operation')
			await deps.save?.(id, request.values)
		}
	})
}

function transactionAsInput(
	transaction: NonNullable<TransactionEntryObservation['transaction']>
): AppTransaction {
	const tags = transaction.tags?.flatMap((link) => (link.tag?.name ? [link.tag.name] : [])) ?? []
	const base = {
		accountId: transaction.accountId,
		organizationId: transaction.organizationId,
		categoryId: transaction.categoryId,
		bookedOn: transaction.bookedOn,
		money: { amountMinor: transaction.amountMinor, currency: transaction.currency },
		...(transaction.description ? { description: transaction.description } : {}),
		...(transaction.memo ? { memo: transaction.memo } : {}),
		source: { source: 'manual' } satisfies AppTransaction['source'],
		...(tags.length ? { tags } : {})
	}
	if (transaction.kind === 'expense') return { ...base, kind: 'expense' }
	if (transaction.paymentMethod === 'check') {
		return {
			...base,
			kind: 'income',
			paymentMethod: 'check',
			checkDetails: {
				checkNumber: transaction.checkDetails?.checkNumber ?? '',
				checkDate: transaction.checkDetails?.checkDate ?? ''
			}
		}
	}
	return { ...base, kind: 'income', paymentMethod: transaction.paymentMethod ?? 'cash' }
}

function isTransactionFormDraft(value: unknown): value is Record<string, unknown> &
	Pick<AppTransaction, 'accountId' | 'categoryId' | 'bookedOn'> &
	Partial<Pick<AppTransaction, 'description' | 'memo' | 'tags'>> &
	Partial<Pick<NonNullable<TransactionDetail['checkDetails']>, 'checkNumber' | 'checkDate'>> & {
		amount: string
		paymentMethod?: IncomePaymentMethod
	} {
	return (
		typeof value === 'object' &&
		value !== null &&
		'accountId' in value &&
		typeof value.accountId === 'string' &&
		'categoryId' in value &&
		typeof value.categoryId === 'string' &&
		'amount' in value &&
		typeof value.amount === 'string' &&
		'bookedOn' in value &&
		typeof value.bookedOn === 'string' &&
		(!('description' in value) || typeof value.description === 'string') &&
		(!('memo' in value) || typeof value.memo === 'string') &&
		(!('checkNumber' in value) || typeof value.checkNumber === 'string') &&
		(!('checkDate' in value) || typeof value.checkDate === 'string') &&
		(!('paymentMethod' in value) ||
			value.paymentMethod === 'cash' ||
			value.paymentMethod === 'check' ||
			value.paymentMethod === 'transfer' ||
			value.paymentMethod === 'electronic') &&
		(!('tags' in value) ||
			(Array.isArray(value.tags) && value.tags.every((tag: unknown) => typeof tag === 'string')))
	)
}

function inputHasCheckDetails(transaction: AppTransaction) {
	return 'paymentMethod' in transaction && transaction.paymentMethod === 'check'
}

function validTransactionReferences(
	facts: TransactionEntryObservation,
	transaction: AppTransaction
) {
	return (
		transaction.organizationId === facts.organizationId &&
		transaction.kind === facts.kind &&
		writableTransactionAccounts(facts).some(
			(account) =>
				account.id === transaction.accountId && account.currency === transaction.money.currency
		) &&
		applicableTransactionCategories(facts).some(
			(category) => category.id === transaction.categoryId
		)
	)
}
