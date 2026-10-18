import type { AccountMergeSnapshot } from '#lib/schema/account-merge.js'
import type { MergeEntity, MergeAllocation } from '#lib/schema/account-merge-mapping.js'
import type { MergeReferencePlan } from '#lib/schema/account-merge-references.js'

// Pure projection after the allocation machine has validated scope and the graph.
// Keep every source candidate, even when canonical provider IDs coincide.
export function mergeReferencePlan(
	snapshot: AccountMergeSnapshot,
	allocation: MergeAllocation
): MergeReferencePlan {
	const mappings = new Map(
		allocation.records.map((mapping) => [
			JSON.stringify([mapping.entity, mapping.sourceId]),
			mapping
		])
	)
	const mappingFor = (entity: MergeEntity, sourceId: string) => {
		const mapping = mappings.get(JSON.stringify([entity, sourceId]))
		if (!mapping) throw new Error('Missing allocated merge reference')
		return mapping
	}
	const reference = (entity: MergeEntity, sourceId: string) =>
		mappingFor(entity, sourceId).destinationId
	const optionalReference = (entity: MergeEntity, sourceId: string | null) =>
		sourceId === null ? null : reference(entity, sourceId)
	const organizationId = allocation.destination.organizationId
	const candidates = <Entity extends MergeEntity>(
		entity: Entity,
		rewrite: (source: AccountMergeSnapshot[Entity][number]) => AccountMergeSnapshot[Entity][number]
	) =>
		snapshot[entity].map((source) => {
			const mapping = mappingFor(entity, source.id)
			return { mapping, value: { ...rewrite(source), id: mapping.destinationId, organizationId } }
		})
	return {
		destination: allocation.destination,
		candidates: {
			accounts: candidates('accounts', (source) => source),
			categories: candidates('categories', (source) => source),
			tags: candidates('tags', (source) => ({
				...source,
				categoryId: optionalReference('categories', source.categoryId)
			})),
			transactions: candidates('transactions', (source) => ({
				...source,
				accountId: reference('accounts', source.accountId),
				categoryId: reference('categories', source.categoryId),
				checkDetailsId: optionalReference('checkDetails', source.checkDetailsId),
				batchId: optionalReference('transactionBatches', source.batchId)
			})),
			checkDetails: candidates('checkDetails', (source) => ({
				...source,
				accountId: reference('accounts', source.accountId),
				transactionId: reference('transactions', source.transactionId)
			})),
			transactionTags: candidates('transactionTags', (source) => ({
				...source,
				transactionId: reference('transactions', source.transactionId),
				tagId: reference('tags', source.tagId)
			})),
			transactionBatches: candidates('transactionBatches', (source) => source),
			batchTemplates: candidates('batchTemplates', (source) => source)
		},
		// Keep source attribution unchanged; only finance candidates are destination-scoped.
		bankAccountLinks: snapshot.bankAccountLinks.map((link) => ({ ...link })),
		excludedConnectionCount: snapshot.excludedConnectionCount
	}
}
