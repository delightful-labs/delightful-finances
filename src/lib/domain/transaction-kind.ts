export const INCOME = 'income'
export const EXPENSE = 'expense'

export type TransactionKind = typeof INCOME | typeof EXPENSE

export const INCOME_PATH = '/income'
export const EXPENSES_PATH = '/expenses'

/** Presentation descriptors only; permissions and persistence remain machine-owned. */
export const transactionPages = {
	[INCOME]: { path: INCOME_PATH, noun: 'nouns.income', count: 1 },
	[EXPENSE]: { path: EXPENSES_PATH, noun: 'nouns.expense', count: 2 }
} satisfies Record<
	TransactionKind,
	{ path: string; noun: 'nouns.income' | 'nouns.expense'; count: number }
>

export function transactionKindForPath(pathname: string): TransactionKind {
	return pathname === INCOME_PATH || pathname.startsWith(`${INCOME_PATH}/`) ? INCOME : EXPENSE
}
