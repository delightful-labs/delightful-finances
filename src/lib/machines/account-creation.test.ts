import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor, type SnapshotFrom } from 'xstate'
import type { Account } from '#lib/schema.js'
import type {
	AccountCreationObservation,
	AccountCreationReason,
	AccountCreationScope
} from '#lib/account-creation-contract.js'
import {
	createAccountCreationAvailability,
	createAccountCreationFormOptions,
	selectAccountCreationAvailability
} from './account-creation-access.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((fn) => fn()))
function fixture() {
	const binding = {}
	let facts: AccountCreationObservation = {
		binding,
		identityId: 'user',
		organizationId: 'workspace',
		sessionReady: true,
		loading: false,
		error: null,
		membership: {
			id: 'member',
			organizationId: 'workspace',
			userId: 'user',
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		}
	}
	const saved = Promise.withResolvers<Account>()
	const create = vi.fn(() => saved.promise)
	const options = createAccountCreationFormOptions({ binding, observe: () => facts, create })
	const machine = createScopedFormMachine<
		{ name: string; kind: 'cash' | 'bank' | 'card' },
		Account,
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationObservation,
		SnapshotFrom<typeof options.availability>,
		SnapshotFrom<typeof options.operation>
	>(options)
	const actor = createActor(machine, { input: facts }).start()
	cleanups.push(() => actor.stop())
	const view = () =>
		selectScopedFormView<
			{ name: string; kind: 'cash' | 'bank' | 'card' },
			Account,
			AccountCreationReason,
			AccountCreationScope,
			AccountCreationObservation,
			SnapshotFrom<typeof options.availability>,
			SnapshotFrom<typeof options.operation>
		>(actor.getSnapshot(), options)
	return {
		binding,
		actor,
		view,
		create,
		saved,
		facts: () => facts,
		patch: (patch: Partial<AccountCreationObservation>, send = true) => {
			facts = { ...facts, ...patch }
			if (send) actor.send({ type: 'OBSERVE', observation: facts })
			return facts
		}
	}
}
const account: Account = {
	id: 'new',
	organizationId: 'workspace',
	name: 'Wallet',
	kind: 'cash',
	currency: 'USD',
	archivedAt: null
}

describe('account creation scoped adoption', () => {
	it.each([
		[{ sessionReady: false }, 'sessionUnavailable'],
		[{ identityId: null }, 'sessionUnavailable'],
		[{ binding: {} }, 'sessionUnavailable'],
		[{ organizationId: null }, 'selectWorkspace'],
		[{ error: new Error('query'), loading: true }, 'loadFailed'],
		[{ loading: true }, 'loading'],
		[{ membership: null }, 'readOnly']
	] satisfies [Partial<AccountCreationObservation>, AccountCreationReason][])(
		'blocks direct submission for %j',
		async (patch, reason) => {
			const f = fixture()
			f.patch(patch)
			await vi.waitFor(() => expect(f.view().readiness).toEqual({ kind: 'blocked', reason }))
			f.actor.send({ type: 'SUBMIT', values: { name: 'Wallet', kind: 'cash' } })
			expect(f.create).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().context.sequence).toBe(0)
		}
	)
	it.each(['owner', 'admin', 'member', 'viewer'] satisfies NonNullable<
		AccountCreationObservation['membership']
	>['role'][])('uses existing %s policy', async (role) => {
		const f = fixture()
		const member = f.facts().membership
		if (!member) throw new Error('fixture')
		f.patch({ membership: { ...member, role } })
		await vi.waitFor(() => expect(f.view().canSubmit).toBe(role === 'owner' || role === 'admin'))
	})
	it('validates, trims, accepts create without CHANGE and prevents duplicate work', async () => {
		const f = fixture()
		await vi.waitFor(() => expect(f.view().canSubmit).toBe(true))
		f.actor.send({ type: 'SUBMIT', values: { name: ' ', kind: 'cash' } })
		await waitFor(f.actor, (s) => s.context.result?.outcome === 'invalid')
		f.actor.send({ type: 'SUBMIT', values: { name: ' Wallet ', kind: 'cash' } })
		await vi.waitFor(() =>
			expect(f.create).toHaveBeenCalledExactlyOnceWith('workspace', {
				name: 'Wallet',
				kind: 'cash'
			})
		)
		f.actor.send({ type: 'SUBMIT', values: { name: 'Duplicate', kind: 'bank' } })
		f.actor.send({ type: 'RESET' })
		expect(f.create).toHaveBeenCalledTimes(1)
		f.saved.resolve(account)
		await waitFor(f.actor, (s) => s.context.result?.outcome === 'succeeded')
		expect(f.view().content).toEqual({ kind: 'success', value: account })
		f.actor.send({ type: 'OPEN' })
		expect(f.view().content).toEqual({ kind: 'fields' })
	})
	it('refreshes permission before the write even without owner observation', async () => {
		const f = fixture()
		await vi.waitFor(() => expect(f.view().canSubmit).toBe(true))
		f.patch({ membership: null }, false)
		f.actor.send({ type: 'SUBMIT', values: { name: 'Wallet', kind: 'cash' } })
		await waitFor(f.actor, (s) => s.context.result?.outcome === 'denied')
		expect(f.create).not.toHaveBeenCalled()
	})
	it('keeps ordinary observations from interrupting issued work and settles shutdown after local persistence', async () => {
		const f = fixture()
		await vi.waitFor(() => expect(f.view().canSubmit).toBe(true))
		f.actor.send({ type: 'SUBMIT', values: { name: 'Wallet', kind: 'cash' } })
		await vi.waitFor(() => expect(f.create).toHaveBeenCalledTimes(1))
		f.patch({ membership: f.facts().membership })
		await vi.waitFor(() => expect(f.view().readiness).toEqual({ kind: 'ready' }))
		expect(f.view().activity.kind).toBe('operating')
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.saved.resolve(account)
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.actor.getSnapshot().context.request).toBeUndefined()
	})
	it('reconciles scope-away-and-back without attributing the old result', async () => {
		const f = fixture()
		await vi.waitFor(() => expect(f.view().canSubmit).toBe(true))
		f.actor.send({ type: 'SUBMIT', values: { name: 'Wallet', kind: 'cash' } })
		await vi.waitFor(() => expect(f.create).toHaveBeenCalledTimes(1))
		f.patch({ organizationId: 'other' })
		f.patch({ organizationId: 'workspace' })
		f.saved.resolve(account)
		await vi.waitFor(() => expect(f.view().activity.kind).toBe('idle'))
		expect(f.view().content.kind).toBe('fields')
		expect(f.view().feedback).not.toMatchObject({
			kind: 'result',
			result: { outcome: 'succeeded' }
		})
	})
	it('echoes only assessed current revisions', async () => {
		const f = fixture()
		const actor = createActor(createAccountCreationAvailability(f.binding), {
			input: { revision: 9, facts: f.facts() }
		}).start()
		cleanups.push(() => actor.stop())
		await waitFor(actor, (s) => selectAccountCreationAvailability(s).revision === 9)
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 10, facts: { ...f.facts(), membership: null } }
		})
		await waitFor(actor, (s) => selectAccountCreationAvailability(s).revision === 10)
		expect(selectAccountCreationAvailability(actor.getSnapshot()).readiness).toEqual({
			kind: 'blocked',
			reason: 'readOnly'
		})
	})
})
