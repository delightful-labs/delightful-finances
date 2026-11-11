import { newTagPatchSchema } from '../../contracts/transaction-new-tag-contract.js'
import { nativeTextReferenceSchema } from '../../contracts/native-text-transfer.js'
import { transactionTextFieldSchema } from '../../contracts/transaction-text-draft.js'
import { z } from 'zod'
import { accountRowSchema, createFormViewSchema } from './form-protocol.js'
import { categoryRowSchema } from './management-protocol.js'
const text = z.string().max(4096)
const scalar = z.string().max(64)
const offset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const reason = z.enum([
	'sessionUnavailable',
	'selectWorkspace',
	'loadFailed',
	'loading',
	'readOnly',
	'noAccounts',
	'noCategories',
	'unavailableReference',
	'ambiguousTagName',
	'checkRetained',
	'saveUnresolved',
	'attachmentsFailed',
	'linkedTransferRequiresUnlink'
])
export const transactionFormViewSchema = createFormViewSchema(z.null(), reason)
export const transactionDraftSchema = z.strictObject({
	tagComposer: z.literal(true).optional(),
	tagPatch: newTagPatchSchema.optional(),
	retainedFields: z.array(transactionTextFieldSchema).max(3).optional(),
	tagMode: z.literal('append').optional(),
	tagEdit: z.strictObject({ id: z.uuid(), selected: z.boolean() }).optional(),
	accountId: scalar.optional(),
	categoryId: scalar.optional(),
	amount: scalar.optional(),
	bookedOn: scalar.optional(),
	description: z.union([text, nativeTextReferenceSchema]).optional(),
	memo: z.union([text, nativeTextReferenceSchema]).optional(),
	tags: z.array(text).max(500).optional(),
	paymentMethod: scalar.optional(),
	checkId: scalar.optional(),
	checkNumber: z.union([text, nativeTextReferenceSchema]).optional(),
	checkDate: scalar.optional(),
	attachmentCount: offset.optional(),
	attachments: z
		.array(z.custom<File>((file) => typeof File !== 'undefined' && file instanceof File))
		.max(5)
		.optional()
})
export const transactionRouteCommandSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('TAG_PAGE'), offset }),
	z.strictObject({ type: z.enum(['OPEN', 'RESET', 'CANCEL', 'RETRY_READINESS']) }),
	z.strictObject({ type: z.enum(['SUBMIT', 'CHANGE']), values: transactionDraftSchema })
])
const page = z.strictObject({ offset, total: offset, hasMore: z.boolean() })
const transferSchema = z.strictObject({
	state: z.enum(['unselected', 'searching', 'matches', 'empty', 'failed', 'linked', 'conflicted']),
	statusText: text.nullable(),
	deleteFeedback: z
		.strictObject({ text, variant: z.enum(['loading', 'success', 'error']) })
		.nullable(),
	canDelete: z.boolean(),
	searchEnabled: z.boolean(),
	conflicted: z.boolean(),
	unlinkAvailable: z.boolean(),
	deleted: z.boolean(),
	selectedCandidateId: z.uuid().nullable(),
	candidates: z
		.array(
			z.strictObject({
				id: z.uuid(),
				organizationId: z.uuid(),
				kind: z.enum(['expense', 'income']),
				internalTransferId: z.uuid().nullable(),
				accountName: text.nullable(),
				description: text.nullable(),
				amountLabel: text,
				dateLabel: text,
				accountId: z.uuid(),
				amountMinor: z.number().int().nonnegative().safe(),
				currency: z.string().length(3),
				bookedOn: z.iso.date(),
				writable: z.boolean()
			})
		)
		.max(500),
	page,
	linkedTransferId: z.uuid().nullable(),
	counterpartHref: z.string().startsWith('/').max(24576).nullable(),
	unlinkWritable: z.boolean(),
	linkPending: z.boolean(),
	unlinkPending: z.boolean(),
	deletePending: z.boolean(),
	linkOutcome: z
		.enum([
			'succeeded',
			'cancelled',
			'closed',
			'denied',
			'incompatible',
			'alreadyLinked',
			'unavailable'
		])
		.nullable(),
	unlinkOutcome: z
		.enum([
			'succeeded',
			'recoveryRequired',
			'cancelled',
			'closed',
			'denied',
			'incompatible',
			'unavailable'
		])
		.nullable(),
	deleteOutcome: z
		.enum([
			'succeeded',
			'recoveryRequired',
			'cancelled',
			'closed',
			'denied',
			'incompatible',
			'unavailable'
		])
		.nullable()
})
const initialEntry = z.strictObject({
	accountId: z.uuid(),
	categoryId: z.uuid(),
	amountMinor: z.number().int().nonnegative().safe(),
	currency: z.string().length(3),
	bookedOn: z.iso.date(),
	description: text.nullable(),
	memo: text.nullable(),
	paymentMethod: z.enum(['cash', 'check', 'transfer', 'electronic']).nullable(),
	checkId: z.uuid().nullable(),
	check: z.strictObject({ checkNumber: text, checkDate: scalar }).optional(),
	tags: z.array(text).max(0)
})
export const transactionRouteViewSchema = z.strictObject({
	generation: offset,
	newTags: z.strictObject({
		items: z.array(z.strictObject({ id: offset, name: text })).max(500),
		page,
		inputRevision: offset,
		feedback: text.nullable()
	}),
	tagChoices: z.array(z.strictObject({ id: z.uuid(), name: text })).max(500),
	initialEntry: initialEntry.nullable(),
	initialAmount: scalar,
	readonlyFields: z.array(transactionTextFieldSchema).max(3),
	savedTags: z.array(z.strictObject({ id: z.uuid(), name: text, selected: z.boolean() })).max(500),
	savedTagPage: page,
	transfer: transferSchema.nullable(),
	mode: z.enum(['idle', 'active', 'draining', 'failed', 'closed']),
	route: z
		.union([
			z.strictObject({ kind: z.literal('expense'), pathname: z.literal('/expenses/new') }),
			z.strictObject({ kind: z.literal('income'), pathname: z.literal('/income/new') }),
			z
				.strictObject({
					kind: z.enum(['expense', 'income']),
					pathname: z.string().max(128),
					transactionId: z.uuid()
				})
				.refine(
					(route) =>
						route.pathname ===
						`/${route.kind === 'income' ? 'income' : 'expenses'}/${route.transactionId}`
				)
		])
		.nullable(),
	form: transactionFormViewSchema,
	accounts: z.array(accountRowSchema.extend({ amountPattern: z.string().max(128) })).max(500),
	defaultAccount: accountRowSchema.extend({ amountPattern: z.string().max(128) }).nullable(),
	defaultCategory: categoryRowSchema.nullable(),
	categories: z.array(categoryRowSchema).max(500),
	tagSuggestions: z.array(text).max(500),
	accountPage: page,
	categoryPage: page,
	tagPage: page,
	defaultAccountId: z.uuid().nullable(),
	defaultCategoryId: z.uuid().nullable(),
	today: z.iso.date(),
	cancelHref: z.string().max(24_576).startsWith('/'),
	emptyAccounts: z.boolean()
})
export type TransactionDraft = z.infer<typeof transactionDraftSchema>
export type TransactionRouteIntent = z.infer<typeof transactionRouteCommandSchema>
export type PublicTransactionRouteView = z.infer<typeof transactionRouteViewSchema>

export function emptyTransactionRouteView(): PublicTransactionRouteView {
	return {
		newTags: {
			items: [],
			page: { offset: 0, total: 0, hasMore: false },
			inputRevision: 0,
			feedback: null
		},
		tagChoices: [],
		generation: 0,
		initialEntry: null,
		initialAmount: '',
		readonlyFields: [],
		savedTags: [],
		savedTagPage: { offset: 0, total: 0, hasMore: false },
		transfer: null,
		mode: 'idle',
		route: null,
		form: {
			readiness: { kind: 'closed' },
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
		},
		accounts: [],
		defaultAccount: null,
		defaultCategory: null,
		categories: [],
		tagSuggestions: [],
		accountPage: { offset: 0, total: 0, hasMore: false },
		categoryPage: { offset: 0, total: 0, hasMore: false },
		tagPage: { offset: 0, total: 0, hasMore: false },
		defaultAccountId: null,
		defaultCategoryId: null,
		today: '1970-01-01',
		cancelHref: '/expenses',
		emptyAccounts: true
	}
}

export const transactionEditCommandSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.enum(['ENABLE_SEARCH', 'DISABLE_SEARCH', 'UNLINK_TRANSFER']) }),
	z.strictObject({
		type: z.enum(['SELECT_COUNTERPART', 'LINK_COUNTERPART']),
		candidateId: z.uuid()
	}),
	z.strictObject({
		type: z.literal('DELETE_LINKED_TRANSFER'),
		choice: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('both') }),
			z.strictObject({ kind: z.literal('selected'), transactionId: z.uuid() })
		])
	})
])
export type TransactionEditIntent = z.infer<typeof transactionEditCommandSchema>
