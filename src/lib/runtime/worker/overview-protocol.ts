import { z } from 'zod'
import { emptyLedgerView, ledgerViewSchema } from './ledger-protocol.js'
const offset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const text = z.string().max(4096)
export const overviewFiltersSchema = z.strictObject({
	start: z.string().max(64),
	end: z.string().max(64),
	categoryId: z.uuid().nullable(),
	currency: z.string().max(64)
})
export const overviewCommandSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('RESTORE_FILTERS'), value: z.string().max(16_384).nullable() }),
	z.strictObject({ type: z.literal('SEARCH'), query: text }),
	z.strictObject({ type: z.literal('TAG_PAGE'), transactionId: z.uuid(), offset }),
	z.strictObject({ type: z.literal('RANGE'), start: z.string().max(64), end: z.string().max(64) }),
	z.strictObject({ type: z.literal('PRESET'), days: z.union([z.literal(7), z.literal(30)]) }),
	z.strictObject({ type: z.literal('CURRENCY'), currency: z.string().max(64) }),
	z.strictObject({ type: z.literal('CATEGORY'), categoryId: z.uuid().nullable() }),
	z.strictObject({ type: z.literal('CATEGORY_PAGE'), offset })
])
export const overviewViewSchema = z.strictObject({
	preferencesReady: z.boolean(),
	active: z.boolean(),
	loading: z.boolean(),
	failed: z.boolean(),
	filters: overviewFiltersSchema.extend({ query: text }),
	preset: z.enum(['7', '30', 'custom']),
	validRange: z.boolean(),
	currency: z.string().max(64),
	currencies: z.array(z.string().length(3)).max(500),
	total: z.bigint().nonnegative(),
	transactionCount: offset,
	activeCategory: z.uuid().nullable(),
	activeCategoryName: text.nullable(),
	slices: z
		.array(
			z.strictObject({
				key: z.uuid(),
				value: z.bigint().nonnegative(),
				label: text.nullable(),
				color: z.string().max(128)
			})
		)
		.max(500),
	chart: z
		.array(
			z.strictObject({
				key: z.string().max(64),
				color: z.string().max(128),
				categoryId: z.uuid().nullable(),
				pageOffset: offset.nullable(),
				value: z.number().min(0).max(1),
				startAngle: z
					.number()
					.min(0)
					.max(Math.PI * 2),
				endAngle: z
					.number()
					.min(0)
					.max(Math.PI * 2)
			})
		)
		.max(502),
	categoryPage: z.strictObject({ offset, total: offset, hasMore: z.boolean() }),
	categories: z.array(z.strictObject({ id: z.uuid(), name: text.nullable() })).max(500),
	ledger: ledgerViewSchema
})
export type OverviewCommand = z.infer<typeof overviewCommandSchema>
export type PublicOverviewView = z.infer<typeof overviewViewSchema>
export function emptyOverviewView(): PublicOverviewView {
	return {
		preferencesReady: false,
		active: false,
		loading: false,
		failed: false,
		filters: { start: '', end: '', categoryId: null, currency: 'USD', query: '' },
		preset: 'custom',
		validRange: false,
		currency: 'USD',
		currencies: [],
		total: 0n,
		transactionCount: 0,
		activeCategory: null,
		activeCategoryName: null,
		slices: [],
		chart: [],
		categoryPage: { offset: 0, total: 0, hasMore: false },
		categories: [],
		ledger: emptyLedgerView()
	}
}
