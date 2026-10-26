import { describe, expect, it } from 'vitest'
import { EXPENSE, INCOME } from './transaction-kind.js'
import type { TransactionRow } from '#lib/schema.js'
import {
	findInternalTransferCounterparts,
	inspectInternalTransferCounterparts
} from './internal-transfer.js'

type Candidate = Pick<
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

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
	return {
		id,
		organizationId: 'workspace',
		accountId: 'destination',
		kind: INCOME,
		amountMinor: 1250,
		currency: 'USD',
		bookedOn: '2026-10-23',
		internalTransferId: null,
		...overrides
	}
}

const source = candidate('source', { accountId: 'source', kind: EXPENSE })

describe('internal transfer counterparts', () => {
	it('reports each eligibility check for a rejected candidate', () => {
		const rejected = candidate('rejected', {
			accountId: source.accountId,
			kind: EXPENSE,
			amountMinor: 1251,
			currency: 'EUR',
			bookedOn: '2026-10-31',
			internalTransferId: 'existing-transfer'
		})

		expect(inspectInternalTransferCounterparts(source, [rejected], new Set([rejected.id]))).toEqual(
			[
				{
					candidate: rejected,
					checks: {
						sameWorkspace: true,
						differentAccount: false,
						oppositeKind: false,
						sameAmount: false,
						sameCurrency: false,
						withinDateWindow: false,
						sourceHasNoTransferMarker: true,
						sourceNotLinkedByTransferRecord: true,
						candidateHasNoTransferMarker: false,
						candidateNotLinkedByTransferRecord: false
					},
					eligible: false
				}
			]
		)
	})

	it('returns only opposite-kind transactions in another account with matching workspace, amount, and currency', () => {
		const eligible = candidate('eligible')
		const candidates = [
			eligible,
			candidate('same-account', { accountId: source.accountId }),
			candidate('same-kind', { kind: EXPENSE }),
			candidate('other-amount', { amountMinor: 1251 }),
			candidate('other-currency', { currency: 'EUR' }),
			candidate('other-workspace', { organizationId: 'another-workspace' })
		]

		expect(findInternalTransferCounterparts(source, candidates, new Set())).toEqual([eligible])
	})

	it('includes both seven-calendar-day boundaries and excludes the next day', () => {
		const candidates = [
			candidate('seven-before', { bookedOn: '2026-10-16' }),
			candidate('seven-after', { bookedOn: '2026-10-30' }),
			candidate('eight-before', { bookedOn: '2026-10-15' }),
			candidate('eight-after', { bookedOn: '2026-10-31' })
		]

		expect(
			findInternalTransferCounterparts(source, candidates, new Set()).map(({ id }) => id)
		).toEqual(['seven-before', 'seven-after'])
	})

	it('excludes linked candidates and returns no suggestions for a linked source', () => {
		const eligible = candidate('eligible')
		const alreadyLinked = candidate('linked')
		const candidates = [eligible, alreadyLinked]
		const linkedIds = new Set([alreadyLinked.id])

		expect(
			findInternalTransferCounterparts(source, candidates, linkedIds).map(({ id }) => id)
		).toEqual(['eligible'])
		expect(findInternalTransferCounterparts(source, candidates, new Set([source.id]))).toEqual([])
	})

	it('orders by nearest date, then date and ID without mutating the input', () => {
		const candidates = [
			candidate('same-day-z'),
			candidate('one-day-later', { bookedOn: '2026-10-24' }),
			candidate('same-day-a'),
			candidate('one-day-earlier', { bookedOn: '2026-10-22' })
		]
		const originalOrder = candidates.map(({ id }) => id)

		expect(
			findInternalTransferCounterparts(source, candidates, new Set()).map(({ id }) => id)
		).toEqual(['same-day-a', 'same-day-z', 'one-day-earlier', 'one-day-later'])
		expect(candidates.map(({ id }) => id)).toEqual(originalOrder)
	})
})
