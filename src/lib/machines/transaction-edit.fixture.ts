import { afterEach, vi } from 'vitest'
import { createActor, type InputFrom } from 'xstate'
import type { schema } from 'jazz-tools'
import { app, type TransactionRow, type TransactionDetail } from '#lib/schema.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
import { creationFixture, creationFacts, creationValues } from './transaction-create.fixture.js'
import { createTransactionEditPersistenceMachine } from './transaction-edit-persistence.js'
import { transactionEntryScope } from './transaction-entry.js'

export const editId = '44444444-4444-4444-8444-444444444444'
export const existingTransaction = {
	id: editId,
	organizationId: creationValues.organizationId,
	accountId: creationValues.accountId,
	categoryId: creationValues.categoryId,
	amountMinor: 100,
	currency: 'USD',
	kind: 'expense',
	bookedOn: creationValues.bookedOn,
	source: 'manual',
	externalId: null,
	description: null,
	memo: null,
	paymentMethod: null,
	checkDetailsId: null,
	batchId: null
} satisfies TransactionRow
export type EditRecords = {
	rows: TransactionRow[]
	links: schema.RowOf<typeof app.transactionTags>[]
	tags: schema.RowOf<typeof app.tags>[]
	details: schema.RowOf<typeof app.checkDetails>[]
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
})
export function editFixture() {
	const storage = creationFixture()
	const update = vi.spyOn(storage.transaction, 'update').mockImplementation(() => {})
	const remove = vi.spyOn(storage.transaction, 'delete').mockImplementation(() => {})
	const machine = createTransactionEditPersistenceMachine(storage.db)
	let data: EditRecords = { rows: [existingTransaction], links: [], tags: [], details: [] }
	function records(patch: Partial<EditRecords> = {}) {
		data = { ...data, ...patch }
		storage.all
			.mockReset()
			.mockResolvedValue([])
			.mockResolvedValueOnce(data.rows)
			.mockResolvedValueOnce(data.links)
			.mockResolvedValueOnce(data.tags)
			.mockResolvedValueOnce(data.details)
	}
	records()
	function facts() {
		const row = data.rows[0]
		const transaction: TransactionDetail | null = row
			? {
					...row,
					$createdBy: { account: 'user', identity: { issuer: 'test', subject: 'user' } },
					$createdAt: new Date('2026-10-18'),
					$updatedBy: { account: 'user', identity: { issuer: 'test', subject: 'user' } },
					$updatedAt: new Date('2026-10-18'),
					account: null,
					category: null,
					checkDetails: data.details[0] ?? null,
					tags: data.links.map((link) => ({
						...link,
						tag: data.tags.find((tag) => tag.id === link.tagId) ?? null
					}))
				}
			: null
		const base = creationFacts(storage.db)
		const kind = row?.kind ?? 'expense'
		return {
			...base,
			kind,
			transactionId: editId,
			transaction,
			categories: base.categories.map((category) => ({ ...category, kind })),
			tags: data.tags
		}
	}
	function input(values: AppTransaction = creationValues): InputFrom<typeof machine> {
		const observation = facts()
		return {
			request: { id: 1, scopeRevision: 0, scope: transactionEntryScope(observation), values },
			observation: { revision: 0, facts: observation }
		}
	}
	function start(values = creationValues, logic = machine) {
		const actor = createActor(logic, { input: input(values) })
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	return { ...storage, update, remove, machine, records, facts, input, start }
}
