import { EXPENSE, INCOME } from './transaction-kind.js'
import type { TransactionRow } from '#lib/schema.js'

const MATCH_WINDOW_DAYS = 7
const MILLISECONDS_PER_DAY = 86_400_000

type TransferCandidate = Pick<
	TransactionRow,
	'id' | 'organizationId' | 'accountId' | 'kind' | 'amountMinor' | 'currency' | 'bookedOn'
>
type TransferSource = TransferCandidate

export function findInternalTransferCounterparts(
	source: TransferSource,
	candidates: readonly TransferCandidate[],
	linkedTransactionIds: ReadonlySet<string>
): TransferCandidate[] {
	if (linkedTransactionIds.has(source.id)) return []

	const sourceDay = calendarDay(source.bookedOn)
	const oppositeKind = source.kind === EXPENSE ? INCOME : EXPENSE
	return candidates
		.filter((candidate) => {
			const dayDistance = Math.abs(calendarDay(candidate.bookedOn) - sourceDay)
			return (
				!linkedTransactionIds.has(candidate.id) &&
				candidate.organizationId === source.organizationId &&
				candidate.accountId !== source.accountId &&
				candidate.kind === oppositeKind &&
				candidate.amountMinor === source.amountMinor &&
				candidate.currency === source.currency &&
				dayDistance <= MATCH_WINDOW_DAYS
			)
		})
		.sort((firstCandidate, secondCandidate) => {
			const firstCandidateDay = calendarDay(firstCandidate.bookedOn)
			const secondCandidateDay = calendarDay(secondCandidate.bookedOn)
			const distanceOrder =
				Math.abs(firstCandidateDay - sourceDay) - Math.abs(secondCandidateDay - sourceDay)
			const dateOrder = compareText(firstCandidate.bookedOn, secondCandidate.bookedOn)
			return distanceOrder || dateOrder || compareText(firstCandidate.id, secondCandidate.id)
		})
}

function compareText(firstValue: string, secondValue: string): number {
	return firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0
}

function calendarDay(dateOnly: string): number {
	return Date.parse(`${dateOnly}T00:00:00.000Z`) / MILLISECONDS_PER_DAY
}
