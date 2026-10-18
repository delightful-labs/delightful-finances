import { createActor, toPromise } from 'xstate'
import type { MergeEntity } from '#lib/schema/account-merge-mapping.js'
import { accountMergePreviewInputSchema } from '#lib/validation/account-merge-preview.js'
import { fixture } from './mapping.fixtures.js'
import { accountMergeReferencesMachine } from './references.js'

export async function previewFixture(mapping = fixture()) {
	const prepared = await toPromise(
		createActor(accountMergeReferencesMachine, { input: mapping }).start()
	)
	if (prepared.outcome !== 'prepared') throw new Error('Expected prepared fixture')
	const plan = prepared.plan
	const input = accountMergePreviewInputSchema.parse({
		mapping,
		observations: {
			accounts: { targets: [], receipts: [] },
			categories: { targets: [], receipts: [] },
			tags: { targets: [], receipts: [] },
			transactions: { targets: [], receipts: [] },
			checkDetails: { targets: [], receipts: [] },
			transactionTags: { targets: [], receipts: [] },
			transactionBatches: { targets: [], receipts: [] },
			batchTemplates: { targets: [], receipts: [] }
		}
	})
	for (const candidate of plan.candidates.categories)
		if (candidate.mapping.kind === 'system-category')
			input.observations.categories.targets.push(candidate.value)
	const candidate = (entity: MergeEntity, sourceId: string) => {
		const found = plan.candidates[entity].find((row) => row.mapping.sourceId === sourceId)
		if (!found) throw new Error('Missing candidate')
		return found
	}
	const retain = (entity: MergeEntity, sourceId: string, changes: Record<string, unknown> = {}) => {
		const row = candidate(entity, sourceId)
		const target = { ...row.value, ...changes }
		input.observations[entity].targets.push(target)
		return target
	}
	const recordOrigin = (
		entity: MergeEntity,
		sourceId: string,
		changes: Record<string, unknown> = {}
	) => {
		const row = candidate(entity, sourceId)
		const origin = {
			id: row.mapping.originId,
			organizationId: plan.destination.organizationId,
			sourceOrganizationId: mapping.snapshot.sourceOrganization.id,
			sourceEntity: entity,
			sourceRecordId: sourceId,
			destinationRecordId: row.mapping.destinationId
		}
		Object.assign(origin, changes)
		input.observations[entity].receipts.push(origin)
		return origin
	}
	return { input, plan, candidate, retain, recordOrigin }
}
