import { expect, it } from 'vitest'
import { transactionEditCommandSchema } from './transaction-route-protocol.js'
import { runtimeCommandSchema, FINANCE_RUNTIME_PROTOCOL_VERSION } from './application-protocol.js'

it('admits scalar transfer intents and rejects malformed identities and private handles', () => {
	const candidateId = crypto.randomUUID()
	expect(
		transactionEditCommandSchema.safeParse({ type: 'LINK_COUNTERPART', candidateId }).success
	).toBe(true)
	for (const command of [
		{ type: 'LINK_COUNTERPART', candidateId: 'not-an-id' },
		{ type: 'LINK_COUNTERPART', candidateId, db: {} },
		{ type: 'UNLINK_TRANSFER', binding: {} },
		{ type: 'DELETE_LINKED_TRANSFER', choice: { kind: 'selected', transactionId: 'not-an-id' } },
		{ type: 'DELETE_LINKED_TRANSFER', choice: { kind: 'both', transactionId: candidateId } }
	])
		expect(transactionEditCommandSchema.safeParse(command).success).toBe(false)
})
it('requires workspace and controller generations on the scoped command channel', () => {
	const command = {
		version: FINANCE_RUNTIME_PROTOCOL_VERSION,
		scope: crypto.randomUUID(),
		requestId: crypto.randomUUID(),
		sequence: 1,
		type: 'TRANSACTION_EDIT',
		generation: 1,
		formGeneration: 1,
		command: { type: 'DELETE_LINKED_TRANSFER', choice: { kind: 'both' } }
	}
	expect(runtimeCommandSchema.safeParse(command).success).toBe(true)
	expect(runtimeCommandSchema.safeParse({ ...command, generation: 0 }).success).toBe(false)
	expect(runtimeCommandSchema.safeParse({ ...command, formGeneration: 0 }).success).toBe(false)
	expect(runtimeCommandSchema.safeParse({ ...command, owner: {} }).success).toBe(false)
})

it('requires the captured draft revision for private-tag edits and bounds their scalar frames', () => {
	const command = {
		version: FINANCE_RUNTIME_PROTOCOL_VERSION,
		scope: crypto.randomUUID(),
		requestId: crypto.randomUUID(),
		sequence: 1,
		type: 'TRANSACTION_FORM',
		generation: 1,
		formGeneration: 1,
		draftRevision: 0,
		command: {
			type: 'CHANGE',
			values: { tagComposer: true, tagPatch: { type: 'SELECT', tagId: crypto.randomUUID() } }
		}
	}
	expect(runtimeCommandSchema.safeParse(command).success).toBe(true)
	const { draftRevision: _revision, ...unscoped } = command
	expect(runtimeCommandSchema.safeParse(unscoped).success).toBe(false)
	expect(
		runtimeCommandSchema.safeParse({
			...command,
			command: {
				type: 'CHANGE',
				values: { tagComposer: true, tagPatch: { type: 'ADD', name: 'x'.repeat(4097) } }
			}
		}).success
	).toBe(false)
})
