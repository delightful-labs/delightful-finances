import { sameMergeValues } from './conflict.js'
import type { MergeConflictInput } from '#lib/schema/account-merge-conflict.js'
import type { MergeEntity } from '#lib/schema/account-merge-mapping.js'
import type { MergeReferencePlan } from '#lib/schema/account-merge-references.js'
import type {
	MergeDependency,
	MergeDependencyInput,
	MergePreviewGraph,
	MergePreviewInput,
	MergePreviewSummary
} from '#lib/schema/account-merge-preview.js'
import { accountMergeConflictInputSchema } from '#lib/validation/account-merge-conflict.js'
import { mergeEntitySchema } from '#lib/validation/account-merge-origins.js'

export const mergeTargetKey = (entity: MergeEntity, destinationId: string) =>
	JSON.stringify([entity, destinationId])
export function mergePreviewGraph(
	input: MergePreviewInput,
	plan: MergeReferencePlan
): MergePreviewGraph {
	const records: MergeConflictInput[] = []
	const byTarget = new Map<string, MergeConflictInput[]>()
	for (const entity of mergeEntitySchema.options) {
		const candidates = plan.candidates[entity]
		const observed = input.observations[entity]
		const targets = new Map(observed.targets.map((row) => [row.id, row]))
		const receipts = new Map(observed.receipts.map((row) => [row.id, row]))
		const receiptsBySource = new Map(
			observed.receipts.map((row) => [
				JSON.stringify([row.sourceOrganizationId, row.sourceEntity, row.sourceRecordId]),
				row
			])
		)
		const peers = new Map<string, object[]>()
		for (const candidate of candidates) {
			const group = peers.get(candidate.value.id) ?? []
			// Two differing witnesses suffice for every member of a conflicting group.
			// Keep all candidates; avoid copying a quadratic peer matrix for aliases.
			if (
				group.length === 0 ||
				(group.length === 1 && !sameMergeValues(group[0] ?? {}, candidate.value))
			)
				group.push(candidate.value)
			peers.set(candidate.value.id, group)
		}
		for (const candidate of candidates) {
			const record = accountMergeConflictInputSchema.parse({
				entity,
				sourceOrganizationId: input.mapping.snapshot.sourceOrganization.id,
				destination: input.mapping.destination,
				candidate,
				target: targets.get(candidate.mapping.destinationId) ?? null,
				receipt:
					receipts.get(candidate.mapping.originId) ??
					receiptsBySource.get(
						JSON.stringify([
							input.mapping.snapshot.sourceOrganization.id,
							entity,
							candidate.mapping.sourceId
						])
					) ??
					null,
				peers: peers.get(candidate.mapping.destinationId) ?? []
			})
			records.push(record)
			const key = mergeTargetKey(entity, candidate.mapping.destinationId)
			const group = byTarget.get(key) ?? []
			group.push(record)
			byTarget.set(key, group)
		}
	}
	return { records, byTarget }
}
const referenceEntities = {
	accountId: 'accounts',
	categoryId: 'categories',
	checkDetailsId: 'checkDetails',
	batchId: 'transactionBatches',
	transactionId: 'transactions',
	tagId: 'tags'
} satisfies Record<string, MergeEntity>
export function mergeDependencies(record: MergeConflictInput): MergeDependency[] {
	return Object.entries(referenceEntities).flatMap(([field, entity]) => {
		const destinationId: unknown = Reflect.get(record.candidate.value, field)
		return typeof destinationId === 'string' ? [{ entity, destinationId, field }] : []
	})
}
export function mergeDependencyRecords(
	input: MergeDependencyInput,
	dependency: Pick<MergeDependency, 'entity' | 'destinationId'>
) {
	return input.graph.byTarget.get(mergeTargetKey(dependency.entity, dependency.destinationId)) ?? []
}
// Compatibility guards use retained values or staged new candidates. Staging may
// defer an archive flag only on a new row; it never changes a retained destination.
export function compatibleMergeDependency(
	record: MergeConflictInput,
	dependency: MergeDependency,
	effective: { value: MergeConflictInput['candidate']['value']; kind: 'planned' | 'retained' }
): boolean {
	const value = record.candidate.value
	const parent = effective.value
	const active =
		!('archivedAt' in parent) || parent.archivedAt === null || effective.kind === 'planned'
	if (dependency.field === 'accountId')
		return (
			active &&
			(record.entity !== 'transactions' ||
				('currency' in parent && 'currency' in value && parent.currency === value.currency))
		)
	if (dependency.field === 'categoryId' && record.entity === 'transactions')
		return active && 'kind' in parent && 'kind' in value && parent.kind === value.kind
	if (dependency.field === 'tagId') return active
	if (dependency.field === 'checkDetailsId')
		return (
			'transactionId' in parent &&
			parent.transactionId === value.id &&
			'accountId' in parent &&
			'accountId' in value &&
			parent.accountId === value.accountId
		)
	if (dependency.field === 'transactionId' && record.entity === 'checkDetails')
		return (
			'checkDetailsId' in parent &&
			parent.checkDetailsId === value.id &&
			'accountId' in parent &&
			'accountId' in value &&
			parent.accountId === value.accountId &&
			'kind' in parent &&
			parent.kind === 'income' &&
			'paymentMethod' in parent &&
			parent.paymentMethod === 'check'
		)
	return true
}
export function mergePreviewSummary(
	decisions: MergePreviewSummary['decisions'],
	excludedConnectionCount: number
): MergePreviewSummary {
	return {
		decisions,
		excludedConnectionCount,
		counts: {
			newTargets: new Set(
				decisions
					.filter((row) => row.outcome === 'addition')
					.map((row) => mergeTargetKey(row.entity, row.destinationId))
			).size,
			existingOrigins: decisions.filter((row) => row.outcome === 'existing').length,
			conflicts: decisions.filter((row) => row.outcome === 'conflict').length,
			blocked: decisions.filter((row) => row.outcome === 'blocked').length,
			newReceipts: decisions.filter(
				(row) =>
					row.outcome === 'addition' ||
					(row.outcome === 'existing' && row.reason !== 'recorded-origin')
			).length
		}
	}
}
