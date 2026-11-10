import { projectOverview, type OverviewReadFilters } from './overview-read.js'
import {
	emptyOverviewView,
	overviewFiltersSchema,
	type OverviewCommand,
	type PublicOverviewView
} from './overview-protocol.js'
import { todayDateOnly } from '../../domain/date-only.js'
import type { Db, schema } from 'jazz-tools'
import { app, type TransactionRow, type Category, type Tag, type Account } from '../../schema.js'
import { transactionTagNames } from '../../domain/transaction-tags.js'
import { transactionKindForPath } from '../../domain/transaction-kind.js'
import { WorkerQuery } from './query-observation.js'
import { projectLedger } from './ledger-read.js'
import { emptyLedgerView, type LedgerCommand, type PublicLedgerView } from './ledger-protocol.js'
import type { RouteObservation } from './application-protocol.js'

type TagLink = schema.RowOf<typeof app.transactionTags>

/** Owns only native read leases and presentation cursors; writes remain domain-machine owned. */
export class WorkerLedgerObservation {
	private readonly transfers: WorkerQuery<schema.RowOf<typeof app.internalTransfers>>
	private overviewFilters: OverviewReadFilters = this.defaultOverviewFilters()
	private preferenceRevision = 0
	private overviewTagCursor: { transactionId: string; offset: number } | null = null
	private overviewOffset = 0
	private overviewFacts: readonly unknown[] | undefined
	private overviewResult = emptyOverviewView()
	private readonly transactions: WorkerQuery<TransactionRow>
	private readonly links: WorkerQuery<TagLink>
	private selection: Set<string> | null = null
	private tagCursor: { transactionId: string; offset: number } | null = null
	private categoryOffset = 0
	private currencyOffset = 0
	private facts: readonly unknown[] | undefined
	private result = emptyLedgerView()
	constructor(db: Db) {
		// The containing workspace supplies the same coalesced scheduling callback at binding time.
		this.transfers = new WorkerQuery<schema.RowOf<typeof app.internalTransfers>>(db, () =>
			this.changed()
		)
		this.transactions = new WorkerQuery<TransactionRow>(db, () => this.changed())
		this.links = new WorkerQuery<TagLink>(db, () => this.changed())
	}
	private changed: () => void = () => {}
	bind(organizationId: string | null, active: boolean, overview: boolean, changed: () => void) {
		this.changed = changed
		const scope = active ? organizationId : null
		this.transfers.set(
			JSON.stringify([scope, overview]),
			scope && overview ? app.internalTransfers.where({ organizationId: scope }) : undefined
		)
		this.transactions.set(
			JSON.stringify(scope),
			scope
				? app.transactions.where({ organizationId: scope }).orderBy('bookedOn', 'desc')
				: undefined
		)
		this.links.set(
			JSON.stringify(scope),
			scope ? app.transactionTags.where({ organizationId: scope }) : undefined
		)
	}
	reset() {
		this.overviewFilters = this.defaultOverviewFilters()
		this.preferenceRevision = 0
		this.overviewOffset = 0
		this.overviewTagCursor = null
		this.overviewFacts = undefined
		this.overviewResult = emptyOverviewView()
		this.selection = null
		this.tagCursor = null
		this.categoryOffset = 0
		this.currencyOffset = 0
		this.facts = undefined
		this.result = emptyLedgerView()
	}
	isAccountSelected = (accountId: string) =>
		this.selection === null || this.selection.has(accountId)
	command(command: LedgerCommand, accounts: readonly Account[]) {
		if (command.type === 'ALL_ACCOUNTS') this.selection = null
		if (command.type === 'NO_ACCOUNTS') this.selection = new Set()
		if (command.type === 'TOGGLE_ACCOUNT') {
			if (!accounts.some((row) => row.id === command.accountId)) return
			const selection = new Set(this.selection ?? accounts.map((row) => row.id))
			if (selection.has(command.accountId)) selection.delete(command.accountId)
			else selection.add(command.accountId)
			this.selection = selection
		}
		if (command.type === 'TAG_PAGE') {
			if (
				!this.result.groups.some((group) =>
					group.rows.some((row) => row.id === command.transactionId)
				)
			)
				return
			this.tagCursor = { transactionId: command.transactionId, offset: command.offset }
		}
		if (command.type === 'OPTIONS_PAGE') {
			if (command.catalog === 'categories') this.categoryOffset = command.offset
			else this.currencyOffset = command.offset
		}
		this.changed()
	}
	project(input: {
		route: RouteObservation
		active: boolean
		categories: readonly Category[]
		tags: readonly Tag[]
		loading: boolean
		failed: boolean
	}): PublicLedgerView {
		if (!input.active) return emptyLedgerView()
		const facts = [
			input.route.pathname,
			input.route.search,
			input.route.hash,
			this.transactions.current,
			this.transactions.isLoading,
			this.transactions.error,
			this.links.current,
			this.links.isLoading,
			this.links.error,
			input.categories,
			input.tags,
			input.loading,
			input.failed,
			this.selection,
			this.tagCursor,
			this.categoryOffset,
			this.currencyOffset
		]
		if (
			this.facts?.length === facts.length &&
			facts.every((value, index) => this.facts?.[index] === value)
		)
			return this.result
		this.facts = facts
		const params = new URLSearchParams(input.route.search)
		const filters = {
			start: params.get('start') ?? '',
			end: params.get('end') ?? '',
			categoryId: params.get('category') ?? '',
			currency: params.get('currency') ?? '',
			query: params.get('q') ?? ''
		}
		const kind = transactionKindForPath(input.route.pathname)
		const rows = this.transactions.current ?? []
		const names = new Map(input.categories.map((row) => [row.id, row.name]))
		const tags = transactionTagNames(input.tags, this.links.current ?? [])
		const ledger = projectLedger({
			transactions: rows,
			kind,
			selectedAccountIds: this.selection,
			filters,
			categoryNames: names,
			tagNames: tags,
			requestedPage: /^\d+$/.test(params.get('page') ?? '') ? Number(params.get('page')) : 1,
			tagCursor: this.tagCursor
		})
		const listPath = kind === 'income' ? '/income' : '/expenses'
		const href = (pathname: string, page: number) => {
			const search = new URLSearchParams(params)
			if (page > 1) search.set('page', String(page))
			else search.delete('page')
			return `${pathname}${search.size ? `?${search}` : ''}${input.route.hash}`
		}
		const selected = rows.filter(
			(row) => row.kind === kind && (this.selection === null || this.selection.has(row.accountId))
		)
		const categories = [...new Set(selected.map((row) => row.categoryId))].sort(
			(a, b) => (names.get(a) ?? '').localeCompare(names.get(b) ?? '') || a.localeCompare(b)
		)
		const currencies = [...new Set(selected.map((row) => row.currency))].sort()
		const offset = (requested: number, length: number) =>
			Math.min(Math.floor(requested / 500) * 500, Math.max(0, Math.floor((length - 1) / 500) * 500))
		const categoryOffset = offset(this.categoryOffset, categories.length)
		const currencyOffset = offset(this.currencyOffset, currencies.length)
		const failed = input.failed || !!this.transactions.error || !!this.links.error
		const loading = input.loading || this.transactions.isLoading || this.links.isLoading
		this.result = {
			...ledger,
			active: true,
			loading,
			failed,
			kind,
			filters,
			noAccountsSelected: this.selection?.size === 0,
			previousHref: ledger.page > 1 ? href(listPath, ledger.page - 1) : null,
			nextHref: ledger.page < ledger.pageCount ? href(listPath, ledger.page + 1) : null,
			slots: ledger.slots.map((page) => ({ page, href: href(listPath, page) })),
			groups:
				failed || loading
					? []
					: ledger.groups.map((group) => ({
							...group,
							rows: group.rows.map((row) => ({
								...row,
								href: href(`${listPath}/${row.id}`, ledger.page)
							}))
						})),
			categories: categories
				.slice(categoryOffset, categoryOffset + 500)
				.map((id) => ({ id, name: names.get(id)?.slice(0, 4096) ?? null })),
			categoryPage: {
				offset: categoryOffset,
				total: categories.length,
				hasMore: categoryOffset + 500 < categories.length
			},
			currencies: currencies.slice(currencyOffset, currencyOffset + 500),
			currencyPage: {
				offset: currencyOffset,
				total: currencies.length,
				hasMore: currencyOffset + 500 < currencies.length
			}
		}
		return this.result
	}
	private defaultOverviewFilters(days = 30): OverviewReadFilters {
		const today = new Date()
		const start = new Date(today)
		start.setDate(start.getDate() - (days - 1))
		return {
			start: todayDateOnly(start),
			end: todayDateOnly(today),
			categoryId: null,
			currency: 'USD',
			query: ''
		}
	}
	overviewCommand(command: OverviewCommand) {
		if (command.type === 'RESTORE_FILTERS') {
			if (this.preferenceRevision !== 0) return
			this.preferenceRevision++
			try {
				const decoded = overviewFiltersSchema.safeParse(
					command.value === null ? null : JSON.parse(command.value)
				)
				if (decoded.success) this.overviewFilters = { ...decoded.data, query: '' }
			} catch {
				/* Invalid browser preferences leave the default report intact. */
			}
		} else {
			this.preferenceRevision++
			if (command.type === 'SEARCH')
				this.overviewFilters = { ...this.overviewFilters, query: command.query }
			if (command.type === 'RANGE')
				this.overviewFilters = {
					...this.overviewFilters,
					start: command.start,
					end: command.end,
					categoryId: null
				}
			if (command.type === 'PRESET') {
				const range = this.defaultOverviewFilters(command.days)
				this.overviewFilters = {
					...this.overviewFilters,
					start: range.start,
					end: range.end,
					categoryId: null
				}
			}
			if (command.type === 'CURRENCY')
				this.overviewFilters = {
					...this.overviewFilters,
					currency: command.currency,
					categoryId: null
				}
			if (command.type === 'CATEGORY')
				this.overviewFilters = { ...this.overviewFilters, categoryId: command.categoryId }
			if (command.type === 'CATEGORY_PAGE') this.overviewOffset = command.offset
			if (
				command.type === 'TAG_PAGE' &&
				this.overviewResult.ledger.groups.some((group) =>
					group.rows.some((row) => row.id === command.transactionId)
				)
			)
				this.overviewTagCursor = { transactionId: command.transactionId, offset: command.offset }
		}
		this.changed()
	}
	projectOverview(input: {
		route: RouteObservation
		active: boolean
		categories: readonly Category[]
		tags: readonly Tag[]
		loading: boolean
		failed: boolean
	}): PublicOverviewView {
		if (!input.active) return emptyOverviewView()
		const facts = [
			input.route.search,
			this.transactions.current,
			this.transactions.isLoading,
			this.transactions.error,
			this.links.current,
			this.links.isLoading,
			this.links.error,
			this.transfers.current,
			this.transfers.isLoading,
			this.transfers.error,
			input.categories,
			input.tags,
			input.loading,
			input.failed,
			this.selection,
			this.overviewFilters,
			this.preferenceRevision,
			this.overviewTagCursor,
			this.overviewOffset
		]
		if (
			this.overviewFacts?.length === facts.length &&
			facts.every((value, index) => this.overviewFacts?.[index] === value)
		)
			return this.overviewResult
		this.overviewFacts = facts
		const loading =
			input.loading ||
			this.transactions.isLoading ||
			this.links.isLoading ||
			this.transfers.isLoading
		const failed =
			input.failed || !!this.transactions.error || !!this.links.error || !!this.transfers.error
		if (loading || failed) {
			this.overviewResult = {
				...emptyOverviewView(),
				active: true,
				loading,
				failed,
				filters: this.overviewFilters
			}
			return this.overviewResult
		}
		const params = new URLSearchParams(input.route.search)
		const result = projectOverview({
			transactions: this.transactions.current ?? [],
			links: this.transfers.current ?? [],
			selectedAccountIds: this.selection,
			categoryNames: new Map(input.categories.map((row) => [row.id, row.name])),
			tagNames: transactionTagNames(input.tags, this.links.current ?? []),
			filters: this.overviewFilters,
			categoryOffset: this.overviewOffset,
			tagCursor: this.overviewTagCursor,
			requestedPage: /^\d+$/.test(params.get('overviewPage') ?? '')
				? Number(params.get('overviewPage'))
				: 1
		})
		const href = (page: number) => {
			const query = new URLSearchParams(params)
			if (page > 1) query.set('overviewPage', String(page))
			else query.delete('overviewPage')
			return `/${query.size ? `?${query}` : ''}`
		}
		const workspace = params.get('workspace')
		const rowSearch = workspace ? `?${new URLSearchParams({ workspace })}` : ''
		const week = this.defaultOverviewFilters(7),
			month = this.defaultOverviewFilters(30)
		const preset =
			this.overviewFilters.end === week.end && this.overviewFilters.start === week.start
				? '7'
				: this.overviewFilters.end === month.end && this.overviewFilters.start === month.start
					? '30'
					: 'custom'
		this.overviewResult = {
			...result,
			preferencesReady: this.preferenceRevision > 0,
			active: true,
			loading,
			failed,
			filters: this.overviewFilters,
			preset,
			ledger: {
				...emptyLedgerView(),
				...result.ledger,
				active: true,
				previousHref: result.ledger.page > 1 ? href(result.ledger.page - 1) : null,
				nextHref:
					result.ledger.page < result.ledger.pageCount ? href(result.ledger.page + 1) : null,
				slots: result.ledger.slots.map((page) => ({ page, href: href(page) })),
				groups: result.ledger.groups.map((group) => ({
					...group,
					rows: group.rows.map((row) => ({ ...row, href: `/expenses/${row.id}${rowSearch}` }))
				}))
			}
		}
		return this.overviewResult
	}
	close() {
		this.transfers.clear()
		this.transactions.clear()
		this.links.clear()
		this.reset()
	}
}
