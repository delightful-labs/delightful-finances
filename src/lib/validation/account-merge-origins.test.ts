import { describe, expect, it } from 'vitest'
import { appMergeOriginSchema, mergeEntitySchema } from './account-merge-origins.js'

const receipt = {
	organizationId: '11111111-1111-4111-8111-111111111111',
	sourceOrganizationId: '22222222-2222-4222-8222-222222222222',
	sourceEntity: 'accounts',
	sourceRecordId: '33333333-3333-4333-8333-333333333333',
	destinationRecordId: '44444444-4444-4444-8444-444444444444'
}
describe('merge provenance contract', () => {
	it.each(mergeEntitySchema.options)('preserves a %s receipt', (sourceEntity) => {
		const input = { ...receipt, sourceEntity }
		expect(appMergeOriginSchema.parse(input)).toEqual(input)
	})
	for (const field of [
		'organizationId',
		'sourceOrganizationId',
		'sourceRecordId',
		'destinationRecordId'
	]) {
		it.each([undefined, null, '', 'invalid'])(`rejects invalid ${field}: %s`, (value) => {
			expect(appMergeOriginSchema.safeParse({ ...receipt, [field]: value }).success).toBe(false)
		})
	}
	it.each(['attachments', 'simplefinConnections', '', null, undefined])(
		'rejects unsupported entity %s',
		(sourceEntity) => {
			expect(appMergeOriginSchema.safeParse({ ...receipt, sourceEntity }).success).toBe(false)
		}
	)
	it.each(['accessUrl', 'snapshot', 'createdAt', 'id'])('rejects extra %s data', (field) => {
		expect(appMergeOriginSchema.safeParse({ ...receipt, [field]: 'extra' }).success).toBe(false)
	})
})
