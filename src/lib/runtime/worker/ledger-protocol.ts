import { z } from 'zod'

const offset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const text = z.string().max(4096)
const id = z.uuid()
const href = z.string().max(24_576).startsWith('/')
export const ledgerCommandSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('ALL_ACCOUNTS') }),
	z.strictObject({ type: z.literal('NO_ACCOUNTS') }),
	z.strictObject({ type: z.literal('TOGGLE_ACCOUNT'), accountId: id }),
	z.strictObject({ type: z.literal('TAG_PAGE'), transactionId: id, offset }),
	z.strictObject({
		type: z.literal('OPTIONS_PAGE'),
		catalog: z.enum(['categories', 'currencies']),
		offset
	})
])
const page = z.strictObject({ offset, total: offset, hasMore: z.boolean() })
export const ledgerViewSchema = z.strictObject({
	active: z.boolean(),
	loading: z.boolean(),
	failed: z.boolean(),
	kind: z.enum(['expense', 'income']),
	filters: z.strictObject({
		start: z.string().max(16_384),
		end: z.string().max(16_384),
		categoryId: z.string().max(16_384),
		currency: z.string().max(16_384),
		query: z.string().max(16_384)
	}),
	validRange: z.boolean(),
	noAccountsSelected: z.boolean(),
	page: offset.positive(),
	pageCount: offset.positive(),
	total: offset,
	previousHref: href.nullable(),
	nextHref: href.nullable(),
	slots: z.array(z.strictObject({ page: offset.positive(), href })).max(5),
	groups: z
		.array(
			z.strictObject({
				bookedOn: z.iso.date(),
				totals: z
					.array(
						z.strictObject({
							currency: z.string().length(3),
							amountMinor: z.bigint().nonnegative()
						})
					)
					.max(500),
				rows: z
					.array(
						z.strictObject({
							id,
							amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
							currency: z.string().length(3),
							description: text.nullable(),
							categoryName: text.nullable(),
							href,
							tags: page.extend({ names: z.array(text).max(100) })
						})
					)
					.max(25)
			})
		)
		.max(25)
		.refine((groups) => groups.reduce((total, group) => total + group.rows.length, 0) <= 25),
	categories: z.array(z.strictObject({ id, name: text.nullable() })).max(500),
	categoryPage: page,
	currencies: z.array(z.string().length(3)).max(500),
	currencyPage: page
})
export type LedgerCommand = z.infer<typeof ledgerCommandSchema>
export type PublicLedgerView = z.infer<typeof ledgerViewSchema>
export function emptyLedgerView(): PublicLedgerView {
	return {
		active: false,
		loading: false,
		failed: false,
		kind: 'expense',
		filters: { start: '', end: '', categoryId: '', currency: '', query: '' },
		validRange: true,
		noAccountsSelected: false,
		page: 1,
		pageCount: 1,
		total: 0,
		previousHref: null,
		nextHref: null,
		slots: [],
		groups: [],
		categories: [],
		currencies: [],
		categoryPage: { offset: 0, total: 0, hasMore: false },
		currencyPage: { offset: 0, total: 0, hasMore: false }
	}
}
