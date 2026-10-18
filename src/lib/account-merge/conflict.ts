import type { MergeConflictInput } from '#lib/schema/account-merge-conflict.js'

// Validated finance rows contain only scalar fields; compare every captured value
// without relying on property order, form transforms or provider IDs alone.
export function sameMergeValues(left: object, right: object): boolean {
	const fields = Object.keys(left)
	return (
		fields.length === Object.keys(right).length &&
		fields.every(
			(field) =>
				Object.hasOwn(right, field) &&
				Object.is(Reflect.get(left, field), Reflect.get(right, field))
		)
	)
}
export function validMergeObservation(input: MergeConflictInput): boolean {
	const { entity, candidate, destination, target, peers } = input
	const { mapping, value } = candidate
	const specialKind =
		entity === 'categories' && 'isSystem' in value && value.isSystem
			? 'system-category'
			: entity === 'transactions' && 'source' in value && value.source === 'simplefin'
				? 'provider-transaction'
				: 'origin'
	return (
		mapping.entity === entity &&
		mapping.kind === specialKind &&
		value.id === mapping.destinationId &&
		value.organizationId === destination.organizationId &&
		input.sourceOrganizationId !== destination.organizationId &&
		(target === null ||
			(target.id === mapping.destinationId &&
				target.organizationId === destination.organizationId)) &&
		peers.every(
			(peer) =>
				peer.id === mapping.destinationId && peer.organizationId === destination.organizationId
		)
	)
}
export function matchingMergeReceipt(input: MergeConflictInput): boolean {
	const { receipt, candidate, entity, destination, sourceOrganizationId } = input
	return (
		receipt !== null &&
		receipt.id === candidate.mapping.originId &&
		receipt.organizationId === destination.organizationId &&
		receipt.sourceOrganizationId === sourceOrganizationId &&
		receipt.sourceEntity === entity &&
		receipt.sourceRecordId === candidate.mapping.sourceId &&
		receipt.destinationRecordId === candidate.mapping.destinationId
	)
}
export function reusableMergeSystemCategory(input: MergeConflictInput): boolean {
	const { target, candidate } = input
	return (
		target !== null &&
		'isSystem' in target &&
		target.isSystem &&
		target.archivedAt === null &&
		'kind' in candidate.value &&
		target.kind === candidate.value.kind
	)
}
