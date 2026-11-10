import { expect, it } from 'vitest'
import {
	projectAccountForm,
	accountFormViewSchema,
	accountFormCommandSchema
} from './form-protocol.js'
import type { AccountCreationView } from '../../contracts/account-creation-contract.js'
import { account } from '../../machines/bank-sync/test-fixtures.js'

it('drops private recovery checkpoints and functions while preserving actual financial settlement', () => {
	const view: AccountCreationView = {
		...projectAccountForm(undefined),
		content: { kind: 'success', value: account },
		feedback: {
			kind: 'result',
			result: {
				outcome: 'succeeded',
				value: account,
				settlement: 'locallyPersisted',
				checkpoint: { sdk: () => 'PRIVATE', credential: 'SECRET' }
			}
		}
	}
	const publicView = projectAccountForm(view)
	expect(accountFormViewSchema.safeParse(publicView).success).toBe(true)
	expect(structuredClone(publicView)).toEqual(publicView)
	expect(JSON.stringify(publicView)).not.toMatch(/PRIVATE|SECRET|checkpoint|sdk/)
	expect(publicView.feedback).toEqual({
		kind: 'result',
		result: { outcome: 'succeeded', settlement: 'locallyPersisted', value: account }
	})
})
it('bounds public display content and validation issues without sending raw error messages', () => {
	const view: AccountCreationView = {
		...projectAccountForm(undefined),
		content: { kind: 'success', value: { ...account, name: 'n'.repeat(5000) } },
		feedback: {
			kind: 'result',
			result: {
				outcome: 'invalid',
				settlement: 'notStarted',
				issues: Array.from({ length: 100 }, () => ({
					path: ['name'],
					code: 'too_small',
					message: 'PRIVATE INPUT ERROR'
				}))
			}
		}
	}
	const result = projectAccountForm(view)
	expect(accountFormViewSchema.safeParse(result).success).toBe(true)
	expect(result.content.kind === 'success' && result.content.value.name.length).toBe(4096)
	expect(
		result.feedback.kind === 'result' &&
			result.feedback.result.outcome === 'invalid' &&
			result.feedback.result.issues.length
	).toBe(64)
	expect(JSON.stringify(result)).not.toContain('PRIVATE')
})
it('admits bounded unvalidated drafts for the worker schema while rejecting capabilities and oversized payloads', () => {
	expect(
		accountFormCommandSchema.safeParse({
			type: 'SUBMIT',
			values: { name: '', kind: 'invalid', currency: 'invalid' }
		}).success
	).toBe(true)
	expect(
		accountFormCommandSchema.safeParse({ type: 'SUBMIT', values: { name: 'x'.repeat(4097) } })
			.success
	).toBe(false)
	expect(
		accountFormCommandSchema.safeParse({ type: 'SUBMIT', values: { binding: {}, name: 'Cash' } })
			.success
	).toBe(false)
})

it('admits only bounded private name references on revision-scoped native form commands', async () => {
	const { runtimeCommandSchema, FINANCE_RUNTIME_PROTOCOL_VERSION } =
		await import('./application-protocol.js')
	const { managementCommandSchema } = await import('./management-protocol.js')
	const reference = {
		kind: 'text',
		textScope: 'connection/workspace/account',
		reference: crypto.randomUUID(),
		version: 1
	}
	expect(
		accountFormCommandSchema.safeParse({ type: 'SUBMIT', values: { name: reference } }).success
	).toBe(true)
	expect(
		managementCommandSchema.safeParse({
			form: 'category',
			command: { type: 'SUBMIT', values: { name: reference } }
		}).success
	).toBe(true)
	const command = {
		version: FINANCE_RUNTIME_PROTOCOL_VERSION,
		scope: crypto.randomUUID(),
		requestId: crypto.randomUUID(),
		sequence: 1,
		type: 'ACCOUNT_FORM',
		generation: 1,
		draftRevision: 0,
		command: { type: 'SUBMIT', values: { name: reference } }
	}
	expect(runtimeCommandSchema.safeParse(command).success).toBe(true)
	const { draftRevision: _revision, ...unscoped } = command
	expect(runtimeCommandSchema.safeParse(unscoped).success).toBe(false)
	expect(runtimeCommandSchema.safeParse({ ...command, draftRevision: -1 }).success).toBe(false)
	expect(
		accountFormCommandSchema.safeParse({
			type: 'SUBMIT',
			values: { name: { ...reference, raw: 'PRIVATE' } }
		}).success
	).toBe(false)
})
