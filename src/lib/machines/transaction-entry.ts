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
import type { AppTransaction } from '#lib/domain/transaction.js'

export function transactionEntryScope(f: TransactionEntryObservation): TransactionEntryScope {
	return {
		identityId: f.identityId,
		organizationId: f.organizationId,
		binding: f.binding,
		kind: f.kind
	}
}
export function sameTransactionEntryScope(a: TransactionEntryScope, b: TransactionEntryScope) {
	return (
		a.identityId === b.identityId &&
		a.organizationId === b.organizationId &&
		a.binding === b.binding &&
		a.kind === b.kind
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
							f.intent !== undefined &&
							(f.intent.organizationId !== f.organizationId ||
								f.intent.kind !== f.kind ||
								!writableTransactionAccounts(f).some(
									(a) => a.id === f.intent?.accountId && a.currency === f.intent?.money.currency
								) ||
								!applicableTransactionCategories(f).some((c) => c.id === f.intent?.categoryId)),
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
}) {
	const availability = createTransactionEntryAvailability(deps.binding)
	return createSingleWriteFormOptions<
		AppTransaction,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<typeof availability>
	>({
		schema: transactionFormSchema(() => deps.observe()),
		mode: 'create',
		availability,
		selectAvailability: selectTransactionEntryAvailability,
		scopeOf: transactionEntryScope,
		sameScope: sameTransactionEntryScope,
		observe: deps.observe,
		classifyBlocked: (reason) => (reason === 'readOnly' ? 'denied' : 'unavailable'),
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: request.values
		}),
		write: async ({ request }) => deps.create(request.values)
	})
}
