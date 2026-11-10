import { m } from '../../paraglide/messages.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import type { TransactionRouteView } from '../../contracts/transaction-route-contract.js'
import {
	writableTransactionAccounts,
	applicableTransactionCategories,
	applicableTransactionTags
} from '../../machines/transactions/transaction-entry.js'
import { defaultTransactionCategory } from '../../validation/transactions.js'
import { todayDateOnly } from '../../domain/date-only.js'
import { amountInputPattern, minorUnitsToInput, formatMoney } from '../../domain/money.js'
import { workspaceHref } from '../../domain/workspace-routes.js'
import { projectFormView } from './form-protocol.js'
import {
	transactionFormViewSchema,
	type PublicTransactionRouteView
} from './transaction-route-protocol.js'

const transferDates = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })

export function projectTransactionRoute(input: {
	view: TransactionRouteView
	pathname: string
	observation: TransactionEntryObservation | undefined
	accountOffset?: number
	categoryOffset?: number
	transferLabels?: (id: string) => { description: string | null; accountName: string | null }
	savedTagOffset?: number
	transferOffset?: number
	tagOffset?: number
	isSelected?: (accountId: string) => boolean
}): PublicTransactionRouteView {
	const active =
		input.view.mode === 'active' &&
		input.view.route?.pathname === input.pathname &&
		input.observation !== undefined
	const facts = active ? input.observation : undefined
	const accounts = facts ? writableTransactionAccounts(facts) : []
	const categories = facts ? applicableTransactionCategories(facts) : []
	const tags = facts ? applicableTransactionTags(facts) : []
	const page = (requested: number | undefined, total: number) => {
		const offset = Math.min(
			Math.floor((requested ?? 0) / 500) * 500,
			Math.max(0, Math.floor((total - 1) / 500) * 500)
		)
		return { offset, total, hasMore: offset + 500 < total }
	}
	const accountPage = page(input.accountOffset, accounts.length),
		categoryPage = page(input.categoryOffset, categories.length),
		tagPage = page(input.tagOffset, tags.length)
	const defaultAccount = accounts.find((row) =>
		facts?.transaction
			? row.id === facts.transaction.accountId
			: (input.isSelected?.(row.id) ?? true)
	)
	const defaultCategory = facts?.transaction
		? categories.find((row) => row.id === facts.transaction?.categoryId)
		: facts
			? defaultTransactionCategory({
					organizationId: facts.organizationId,
					kind: facts.kind,
					categories
				})
			: undefined
	const savedTags =
		facts?.transaction?.tags?.flatMap((link) =>
			link.tag ? [{ id: link.tag.id, name: link.tag.name }] : []
		) ?? []
	const savedTagPage = page(input.savedTagOffset, savedTags.length)
	const newTags = active ? input.view.newTags : undefined
	const newTagPage = page(newTags?.offset, newTags?.items.length ?? 0)
	const tagFeedback =
		newTags?.feedback?.kind === 'duplicate'
			? m['errors.already_selected_subject_name']({
					subject: m['nouns.tag']({ count: 1 }),
					name: newTags.feedback.name.slice(0, 4096)
				})
			: newTags?.feedback?.kind === 'empty'
				? m['forms.enter_subject']({ subject: m['nouns.tag']({ count: 1 }) })
				: newTags?.feedback
					? m['errors.operation_failed']()
					: null
	const transfer =
		active &&
		input.view.route &&
		'transactionId' in input.view.route &&
		facts?.transactionId === input.view.route.transactionId
			? input.view.transfer
			: undefined
	const transferPage = page(input.transferOffset, transfer?.candidates.length ?? 0)
	const linked = transfer?.linkedTransfer
	const counterpartId =
		linked && linked.organizationId === facts?.organizationId && facts?.transactionId
			? linked.expenseTransactionId === facts.transactionId
				? linked.incomeTransactionId
				: linked.incomeTransactionId === facts.transactionId
					? linked.expenseTransactionId
					: null
			: null
	const entry = facts?.transaction
	const readonlyFields: import('../../contracts/transaction-text-draft.js').TransactionTextField[] =
		[]
	if ((entry?.description?.length ?? 0) > 4096) readonlyFields.push('description')
	if ((entry?.memo?.length ?? 0) > 4096) readonlyFields.push('memo')
	if ((entry?.check?.checkNumber?.length ?? 0) > 4096) readonlyFields.push('checkNumber')
	return {
		initialEntry: entry
			? {
					accountId: entry.accountId,
					categoryId: entry.categoryId,
					amountMinor: entry.amountMinor,
					currency: entry.currency,
					bookedOn: entry.bookedOn,
					description: entry.description?.slice(0, 4096) ?? null,
					memo: entry.memo?.slice(0, 4096) ?? null,
					paymentMethod: entry.paymentMethod,
					checkId: entry.checkId,
					...(entry.check
						? {
								check: {
									checkNumber: entry.check.checkNumber.slice(0, 4096),
									checkDate: entry.check.checkDate ?? ''
								}
							}
						: {}),
					tags: []
				}
			: null,
		initialAmount: entry ? minorUnitsToInput(entry.amountMinor, entry.currency) : '',
		readonlyFields,
		newTags: {
			items:
				newTags?.items
					.slice(newTagPage.offset, newTagPage.offset + 500)
					.map((item) => ({ id: item.id, name: item.name.slice(0, 4096) })) ?? [],
			page: newTagPage,
			inputRevision: newTags?.nextId ?? 0,
			feedback: tagFeedback?.slice(0, 4096) ?? null
		},
		tagChoices: tags
			.slice(tagPage.offset, tagPage.offset + 500)
			.map((tag) => ({ id: tag.id, name: tag.name.slice(0, 4096) })),
		savedTags: savedTags.slice(savedTagPage.offset, savedTagPage.offset + 500).map((tag) => ({
			id: tag.id,
			name: tag.name.slice(0, 4096),
			selected: !(input.view.removedTagIds?.has(tag.id) ?? false)
		})),
		savedTagPage,
		transfer: transfer
			? {
					state: transfer.state,
					searchEnabled: ['searching', 'matches', 'empty', 'failed'].includes(transfer.state),
					conflicted: transfer.state === 'conflicted',
					unlinkAvailable: transfer.linkedTransfer !== null,
					deleted: transfer.deleteOutcome === 'succeeded',
					statusText: transfer.statusLabel?.().slice(0, 4096) ?? null,
					deleteFeedback: transfer.deleteFeedback
						? {
								text: transfer.deleteFeedback.label().slice(0, 4096),
								variant: transfer.deleteFeedback.variant
							}
						: null,
					canDelete: transfer.canDelete ?? false,
					selectedCandidateId: transfer.selectedCandidateId,
					candidates: transfer.candidates
						.slice(transferPage.offset, transferPage.offset + 500)
						.map((row) => ({
							id: row.id,
							organizationId: row.organizationId,
							kind: row.kind,
							internalTransferId: row.internalTransferId,
							accountName: input.transferLabels?.(row.id).accountName?.slice(0, 4096) ?? null,
							description: input.transferLabels?.(row.id).description?.slice(0, 4096) ?? null,
							amountLabel: formatMoney(row.amountMinor, row.currency),
							dateLabel: transferDates.format(new Date(`${row.bookedOn}T00:00:00.000Z`)),
							accountId: row.accountId,
							amountMinor: row.amountMinor,
							currency: row.currency,
							bookedOn: row.bookedOn,
							writable: transfer.writableCandidateIds.has(row.id)
						})),
					page: transferPage,
					linkedTransferId: linked?.id ?? null,
					counterpartHref: counterpartId
						? workspaceHref(
								facts?.organizationId ?? null,
								`/${facts?.kind === 'expense' ? 'income' : 'expenses'}/${counterpartId}`
							)
						: null,
					unlinkWritable: transfer.unlinkWritable,
					linkPending: transfer.linkPending,
					unlinkPending: transfer.unlinkPending,
					deletePending: transfer.deletePending,
					linkOutcome: transfer.linkOutcome,
					unlinkOutcome: transfer.unlinkOutcome,
					deleteOutcome: transfer.deleteOutcome
				}
			: null,
		generation: input.view.generation,
		mode: active ? 'active' : input.view.mode === 'active' ? 'draining' : input.view.mode,
		route: input.view.route,
		form: transactionFormViewSchema.parse(
			projectFormView(active ? input.view.form : undefined, () => null)
		),
		accounts: accounts.slice(accountPage.offset, accountPage.offset + 500).map((row) => ({
			...row,
			name: row.name.slice(0, 4096),
			amountPattern: amountInputPattern(row.currency)
		})),
		categories: categories
			.slice(categoryPage.offset, categoryPage.offset + 500)
			.map((row) => ({ ...row, name: row.name.slice(0, 4096) })),
		tagSuggestions: tags
			.slice(tagPage.offset, tagPage.offset + 500)
			.map((row) => row.name.slice(0, 4096)),
		defaultAccount: defaultAccount
			? {
					...defaultAccount,
					name: defaultAccount.name.slice(0, 4096),
					amountPattern: amountInputPattern(defaultAccount.currency)
				}
			: null,
		defaultCategory: defaultCategory
			? { ...defaultCategory, name: defaultCategory.name.slice(0, 4096) }
			: null,
		accountPage,
		categoryPage,
		tagPage,
		defaultAccountId: defaultAccount?.id ?? null,
		defaultCategoryId: defaultCategory?.id ?? null,
		today: todayDateOnly(),
		cancelHref: workspaceHref(
			facts?.organizationId ?? null,
			facts?.kind === 'income' ? '/income' : '/expenses'
		),
		emptyAccounts: (facts?.accounts.length ?? 0) === 0
	}
}
