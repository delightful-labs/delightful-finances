import { EXPENSE, INCOME } from './transaction-kind.js'
import type { TransactionRow } from '#lib/schema.js'

const MATCH_WINDOW_DAYS = 7
const MILLISECONDS_PER_DAY = 86_400_000

export type InternalTransferCandidate = Pick<
	TransactionRow,
	| 'id'
	| 'organizationId'
	| 'accountId'
	| 'kind'
	| 'amountMinor'
	| 'currency'
	| 'bookedOn'
	| 'internalTransferId'
>
type TransferSource = InternalTransferCandidate

export type InternalTransferMatchChecks = {
	sameWorkspace: boolean
	differentAccount: boolean
	oppositeKind: boolean
	sameAmount: boolean
	sameCurrency: boolean
	withinDateWindow: boolean
	sourceHasNoTransferMarker: boolean
	sourceNotLinkedByTransferRecord: boolean
	candidateHasNoTransferMarker: boolean
	candidateNotLinkedByTransferRecord: boolean
}

export type InternalTransferMatchDiagnostic = {
	candidate: InternalTransferCandidate
	checks: InternalTransferMatchChecks
	eligible: boolean
}

export function inspectInternalTransferCounterparts(
	source: TransferSource,
	candidates: readonly InternalTransferCandidate[],
	linkedTransactionIds: ReadonlySet<string>
): InternalTransferMatchDiagnostic[] {
	const sourceDay = calendarDay(source.bookedOn)
	const oppositeKind = source.kind === EXPENSE ? INCOME : EXPENSE
	return candidates.map((candidate) => {
		const checks: InternalTransferMatchChecks = {
			sameWorkspace: candidate.organizationId === source.organizationId,
			differentAccount: candidate.accountId !== source.accountId,
			oppositeKind: candidate.kind === oppositeKind,
			sameAmount: candidate.amountMinor === source.amountMinor,
			sameCurrency: candidate.currency === source.currency,
			withinDateWindow: Math.abs(calendarDay(candidate.bookedOn) - sourceDay) <= MATCH_WINDOW_DAYS,
			sourceHasNoTransferMarker: !source.internalTransferId,
			sourceNotLinkedByTransferRecord: !linkedTransactionIds.has(source.id),
			candidateHasNoTransferMarker: !candidate.internalTransferId,
			candidateNotLinkedByTransferRecord: !linkedTransactionIds.has(candidate.id)
		}
		return {
			candidate,
			checks,
			eligible: Object.values(checks).every(Boolean)
		}
	})
}

export function findInternalTransferCounterparts(
	source: TransferSource,
	candidates: readonly InternalTransferCandidate[],
	linkedTransactionIds: ReadonlySet<string>
): InternalTransferCandidate[] {
	return inspectInternalTransferCounterparts(source, candidates, linkedTransactionIds)
		.filter(({ eligible }) => eligible)
		.map(({ candidate }) => candidate)
		.sort((firstCandidate, secondCandidate) => {
			const sourceDay = calendarDay(source.bookedOn)
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
