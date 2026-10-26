import { INCOME } from './transaction-kind.js'
import type { Account, TransactionRow } from '#lib/schema.js'

export function calculateAccountBalances(
	accounts: readonly Account[],
	transactions: readonly TransactionRow[]
): ReadonlyMap<string, bigint> {
	const balances = new Map(accounts.map((account) => [account.id, 0n]))
	const currencies = new Map(accounts.map((account) => [account.id, account.currency]))
	for (const transaction of transactions) {
		const balance = balances.get(transaction.accountId)
		if (balance === undefined || currencies.get(transaction.accountId) !== transaction.currency)
			continue
		const amount = BigInt(transaction.amountMinor)
		balances.set(transaction.accountId, balance + (transaction.kind === INCOME ? amount : -amount))
	}
	return balances
}
