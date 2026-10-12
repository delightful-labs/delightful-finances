import { assign, fromPromise, setup } from 'xstate'
import type { z } from 'zod'
import { createTransaction } from '../data.js'
import type { AppTransaction } from '../domain/transaction.js'
import { appTransactionSchema } from '../validation/transaction-input.js'

type TransactionSaveResult = Awaited<ReturnType<typeof createTransaction>>
type SavedTransaction = Extract<TransactionSaveResult, { value: unknown }>['value']
type TransactionFormInput = {
	draft: unknown
	save: (transaction: AppTransaction) => Promise<TransactionSaveResult>
}
type TransactionFormContext = TransactionFormInput & {
	transaction: AppTransaction | null
	validationIssues: z.core.$ZodIssue[]
	savedTransaction: SavedTransaction | null
	saveError: unknown
}
type TransactionFormEvent =
	{ type: 'UPDATE_DRAFT'; draft: unknown } | { type: 'SUBMIT' } | { type: 'RESET' }

const saveTransaction = fromPromise<
	SavedTransaction,
	{ save: TransactionFormInput['save']; transaction: AppTransaction }
>(async ({ input }) => {
	const result = await input.save(input.transaction)
	if ('error' in result) throw result.error
	return result.value
})

export const transactionFormMachine = setup({
	types: {
		context: {} as TransactionFormContext,
		events: {} as TransactionFormEvent,
		input: {} as TransactionFormInput
	},
	actors: { saveTransaction },
	actions: {
		updateDraft: assign(({ event }) =>
			event.type === 'UPDATE_DRAFT'
				? { draft: event.draft, validationIssues: [], saveError: null }
				: {}
		),
		validateDraft: assign(({ context }) => {
			const result = appTransactionSchema.safeParse(context.draft)
			return result.success
				? { transaction: result.data, validationIssues: [] }
				: { transaction: null, validationIssues: result.error.issues }
		}),
		resetForm: assign(() => ({
			draft: {},
			transaction: null,
			validationIssues: [],
			savedTransaction: null,
			saveError: null
		}))
	}
}).createMachine({
	id: 'transactionForm',
	initial: 'editing',
	context: ({ input }) => ({
		...input,
		transaction: null,
		validationIssues: [],
		savedTransaction: null,
		saveError: null
	}),
	states: {
		editing: {
			on: {
				UPDATE_DRAFT: { actions: 'updateDraft' },
				SUBMIT: { target: 'validating' }
			}
		},
		validating: {
			entry: 'validateDraft',
			always: [
				{ guard: ({ context }) => context.transaction !== null, target: 'saving' },
				{ target: 'editing' }
			]
		},
		saving: {
			invoke: {
				src: 'saveTransaction',
				input: ({ context }) => {
					if (context.transaction === null) {
						throw new Error('Cannot save a transaction before validation succeeds.')
					}
					return { save: context.save, transaction: context.transaction }
				},
				onDone: {
					target: 'success',
					actions: assign(({ event }) => ({
						savedTransaction: event.output,
						saveError: null
					}))
				},
				onError: {
					target: 'error',
					actions: assign(({ event }) => ({ saveError: event.error }))
				}
			}
		},
		success: {
			on: { RESET: { target: 'editing', actions: 'resetForm' } }
		},
		error: {
			on: {
				UPDATE_DRAFT: { target: 'editing', actions: 'updateDraft' },
				SUBMIT: { target: 'validating' },
				RESET: { target: 'editing', actions: 'resetForm' }
			}
		}
	}
})
