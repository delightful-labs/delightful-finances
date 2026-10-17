import type {
	AccountMergeMappingInput,
	MergeEntity,
	MergeRecordMapping
} from '#lib/schema/account-merge-mapping.js'

type OriginEntity = Exclude<MergeEntity, 'categories' | 'transactions'>
export type MergeMappingRecord =
	| { entity: OriginEntity; sourceId: string }
	| {
			entity: 'categories'
			sourceId: string
			kind: 'income' | 'expense'
			isSystem: boolean
	  }
	| {
			entity: 'transactions'
			sourceId: string
			source: 'manual' | 'simplefin'
			externalId: string | null
	  }

function originRecords(
	entity: OriginEntity,
	records: readonly { id: string }[]
): MergeMappingRecord[] {
	return records.map(({ id }) => ({ entity, sourceId: id }))
}
export function mergeMappingRecords({ snapshot }: AccountMergeMappingInput): MergeMappingRecord[] {
	return [
		...originRecords('accounts', snapshot.accounts),
		...snapshot.categories.map(({ id, kind, isSystem }): MergeMappingRecord => ({
			entity: 'categories',
			sourceId: id,
			kind,
			isSystem
		})),
		...originRecords('tags', snapshot.tags),
		...snapshot.transactions.map(({ id, source, externalId }): MergeMappingRecord => ({
			entity: 'transactions',
			sourceId: id,
			source,
			externalId
		})),
		...originRecords('checkDetails', snapshot.checkDetails),
		...originRecords('transactionTags', snapshot.transactionTags),
		...originRecords('transactionBatches', snapshot.transactionBatches),
		...originRecords('batchTemplates', snapshot.batchTemplates)
	]
}

function originTuple(input: AccountMergeMappingInput, record: MergeMappingRecord) {
	return [input.snapshot.sourceOrganization.id, record.entity, record.sourceId]
}
export function mergeRecordIdentityName(
	input: AccountMergeMappingInput,
	record: MergeMappingRecord
) {
	return `account-merge:${JSON.stringify(originTuple(input, record))}`
}
export function mergeOriginIdentityName(
	input: AccountMergeMappingInput,
	record: MergeMappingRecord
) {
	return `account-merge-origin:${JSON.stringify(originTuple(input, record))}`
}
export function mergeRecordMapping(
	record: MergeMappingRecord,
	kind: 'origin' | 'provider-transaction',
	ids: Pick<MergeRecordMapping, 'destinationId' | 'originId'>
): MergeRecordMapping {
	const identity = { ...ids, sourceId: record.sourceId }
	return kind === 'provider-transaction'
		? { ...identity, kind, entity: 'transactions' }
		: { ...identity, kind, entity: record.entity }
}
