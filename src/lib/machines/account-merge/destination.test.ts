import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import type {
	MergeDestinationDependencies,
	MergeDestinationSession,
	MergeDestinationOrganization,
	MergeDestinationMembership,
	MergeObservationCallbacks
} from '#lib/schema/account-merge-destination.js'
import { createAccountMergeDestinationMachine } from './destination.js'
import { id } from './mapping.fixtures.js'

const destination = { identityId: id(3), organizationId: id(4) }
function observer<T>() {
	let callbacks: MergeObservationCallbacks<T> | undefined
	const dispose = vi.fn()
	const subscribe = vi.fn((next: MergeObservationCallbacks<T>) => {
		callbacks = next
		return dispose
	})
	const current = () => {
		if (!callbacks) throw new Error('Observer not started')
		return callbacks
	}
	return {
		subscribe,
		dispose,
		next: (value: T) => current().next(value),
		error: () => current().error()
	}
}
function fixture(
	input: unknown = destination,
	changes: Partial<MergeDestinationDependencies> = {}
) {
	const binding = {}
	const session = observer<MergeDestinationSession>()
	const organization = observer<readonly MergeDestinationOrganization[]>()
	const membership = observer<readonly MergeDestinationMembership[]>()
	const dependencies: MergeDestinationDependencies = {
		binding,
		session: session.subscribe,
		organization: vi.fn((_destination, callbacks) => organization.subscribe(callbacks)),
		membership: vi.fn((_destination, callbacks) => membership.subscribe(callbacks)),
		...changes
	}
	const actor = createActor(createAccountMergeDestinationMachine(dependencies), { input }).start()
	const ready = (change: Partial<MergeDestinationSession> = {}) =>
		session.next({ ready: true, ...destination, binding, ...change })
	const organizations: MergeDestinationOrganization[] = [
		{ id: destination.organizationId, kind: 'personal', ownerId: destination.identityId }
	]
	const memberships: MergeDestinationMembership[] = [
		{ organizationId: destination.organizationId, userId: destination.identityId, role: 'owner' }
	]
	const finish = async (expected: object) => {
		await expect(toPromise(actor)).resolves.toEqual(expected)
		expect(actor.getSnapshot().context).toMatchObject({
			destination: undefined,
			session: undefined,
			organizations: undefined,
			memberships: undefined
		})
		expect(session.dispose).toHaveBeenCalledTimes(session.subscribe.mock.calls.length)
		expect(organization.dispose).toHaveBeenCalledTimes(organization.subscribe.mock.calls.length)
		expect(membership.dispose).toHaveBeenCalledTimes(membership.subscribe.mock.calls.length)
	}
	return {
		actor,
		ready,
		session,
		organization,
		membership,
		organizations,
		memberships,
		dependencies,
		finish
	}
}
afterEach(() => vi.useRealTimers())

describe('destination eligibility', () => {
	it.each(['owner', 'admin'] satisfies ('owner' | 'admin')[])(
		'accepts an owned personal organization with %s membership',
		async (role) => {
			const test = fixture()
			expect(test.organization.subscribe).not.toHaveBeenCalled()
			test.ready()
			expect(test.dependencies.organization).toHaveBeenCalledWith(destination, expect.any(Object))
			expect(test.dependencies.membership).toHaveBeenCalledWith(destination, expect.any(Object))
			test.organization.next(test.organizations)
			expect(test.actor.getSnapshot().status).toBe('active')
			test.membership.next([{ ...test.memberships[0]!, role }])
			await test.finish({ outcome: 'eligible', destination })
		}
	)
	it('accepts observations in the reverse order without resubscribing', async () => {
		const test = fixture()
		test.ready()
		test.membership.next(test.memberships)
		test.ready()
		test.ready()
		expect(test.organization.subscribe).toHaveBeenCalledTimes(1)
		expect(test.membership.subscribe).toHaveBeenCalledTimes(1)
		test.organization.next(test.organizations)
		await test.finish({ outcome: 'eligible', destination })
	})
	it.each([
		{},
		{ ...destination, identityId: 'bad' },
		{ ...destination, recoveryPhrase: 'secret' }
	])('rejects malformed requests without observing', async (input) => {
		const test = fixture(input)
		await test.finish({ outcome: 'failed', code: 'invalid-input' })
		expect(test.session.subscribe).not.toHaveBeenCalled()
	})
	for (const stage of ['initial', 'reading']) {
		it.each([
			{ change: { ready: false }, code: 'session-unavailable' },
			{ change: { identityId: id(99) }, code: 'identity-changed' },
			{ change: { organizationId: id(99) }, code: 'workspace-changed' },
			{ change: { binding: {} }, code: 'binding-changed' }
		])(`rejects $code during ${stage}`, async ({ change, code }) => {
			const test = fixture()
			if (stage === 'reading') {
				test.ready()
				test.organization.next(test.organizations)
			}
			test.ready(change)
			await test.finish({ outcome: 'failed', code })
			if (stage === 'initial') expect(test.organization.subscribe).not.toHaveBeenCalled()
		})
	}
	it.each([
		{ rows: [], code: 'not-owned-personal' },
		{ rows: [{ id: id(4), kind: 'business', ownerId: id(3) }], code: 'not-owned-personal' },
		{ rows: [{ id: id(4), kind: 'personal', ownerId: id(99) }], code: 'not-owned-personal' },
		{ rows: [{ id: id(99), kind: 'personal', ownerId: id(3) }], code: 'invalid-observation' },
		{
			rows: Array.from({ length: 2 }, () => ({ id: id(4), kind: 'personal', ownerId: id(3) })),
			code: 'not-owned-personal'
		}
	] satisfies { rows: MergeDestinationOrganization[]; code: string }[])(
		'rejects organization observation $code: $rows',
		async ({ rows, code }) => {
			const test = fixture()
			test.ready()
			test.organization.next(rows)
			test.membership.next(test.memberships)
			await test.finish({ outcome: 'failed', code })
		}
	)
	it.each([
		{ rows: [], code: 'membership-required' },
		...(['member', 'viewer'] satisfies ('member' | 'viewer')[]).map((role) => ({
			rows: [{ organizationId: id(4), userId: id(3), role }],
			code: 'membership-required'
		})),
		{
			rows: [{ organizationId: id(99), userId: id(3), role: 'owner' }],
			code: 'invalid-observation'
		},
		{
			rows: [{ organizationId: id(4), userId: id(99), role: 'owner' }],
			code: 'invalid-observation'
		},
		{
			rows: Array.from({ length: 2 }, () => ({
				organizationId: id(4),
				userId: id(3),
				role: 'admin'
			})),
			code: 'membership-required'
		}
	] satisfies { rows: MergeDestinationMembership[]; code: string }[])(
		'rejects membership observation $code: $rows',
		async ({ rows, code }) => {
			const test = fixture()
			test.ready()
			test.membership.next(rows)
			test.organization.next(test.organizations)
			await test.finish({ outcome: 'failed', code })
		}
	)
	it('uses updated ownership while another remote query is pending', async () => {
		const test = fixture()
		test.ready()
		test.organization.next(test.organizations)
		test.organization.next([{ ...test.organizations[0]!, ownerId: id(99) }])
		test.membership.next(test.memberships)
		await test.finish({ outcome: 'failed', code: 'not-owned-personal' })
	})
	it('cleans up subscriptions whose initial callbacks complete synchronously', async () => {
		const binding = {}
		const sessionDispose = vi.fn()
		const organizationDispose = vi.fn()
		const membershipDispose = vi.fn()
		const test = fixture(destination, {
			binding,
			session: (callbacks) => {
				callbacks.next({ ready: true, ...destination, binding })
				return sessionDispose
			},
			organization: (_destination, callbacks) => {
				callbacks.next([
					{ id: destination.organizationId, kind: 'personal', ownerId: destination.identityId }
				])
				return organizationDispose
			},
			membership: (_destination, callbacks) => {
				callbacks.next([
					{
						organizationId: destination.organizationId,
						userId: destination.identityId,
						role: 'admin'
					}
				])
				return membershipDispose
			}
		})
		await test.finish({ outcome: 'eligible', destination })
		expect(sessionDispose).toHaveBeenCalledTimes(1)
		expect(organizationDispose).toHaveBeenCalledTimes(1)
		expect(membershipDispose).toHaveBeenCalledTimes(1)
	})
	it('observes membership revocation while the organization read is pending', async () => {
		const test = fixture()
		test.ready()
		test.membership.next(test.memberships)
		test.membership.next([])
		test.organization.next(test.organizations)
		await test.finish({ outcome: 'failed', code: 'membership-required' })
	})

	it.each(['session', 'organization', 'membership'] satisfies (
		'session' | 'organization' | 'membership'
	)[])('supervises %s acquisition failures', async (stage) => {
		const fail = () => {
			throw new Error('private subscription error')
		}
		const test = fixture(destination, { [stage]: fail })
		if (stage !== 'session') test.ready()
		await test.finish({
			outcome: 'failed',
			code: stage === 'session' ? 'session-observation-failed' : 'remote-read-failed'
		})
	})
	it.each(['session', 'organization', 'membership'] satisfies (
		'session' | 'organization' | 'membership'
	)[])('bridges later %s native errors', async (stage) => {
		const test = fixture()
		test.ready()
		test[stage].error()
		await test.finish({
			outcome: 'failed',
			code: stage === 'session' ? 'session-observation-failed' : 'remote-read-failed'
		})
	})
	for (const stage of ['session', 'remote']) {
		it.each(['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[])(
			`%s during ${stage} releases subscriptions and ignores late callbacks`,
			async (type) => {
				const test = fixture()
				if (stage === 'remote') test.ready()
				test.actor.send({ type })
				const result = { outcome: type === 'CANCEL' ? 'cancelled' : 'closed' }
				await test.finish(result)
				test.ready()
				test.session.error()
				if (stage === 'remote') {
					test.organization.next(test.organizations)
					test.membership.next(test.memberships)
					test.organization.error()
					test.membership.error()
				}
				expect(test.actor.getSnapshot().output).toEqual(result)
			}
		)
	}
	it.each(['session', 'organization', 'membership'])(
		'times out while waiting for %s and cleans up',
		async (stage) => {
			vi.useFakeTimers()
			const test = fixture()
			if (stage !== 'session') {
				test.ready()
				if (stage === 'organization') test.membership.next(test.memberships)
				else test.organization.next(test.organizations)
			}
			await vi.advanceTimersByTimeAsync(29999)
			expect(test.actor.getSnapshot().status).toBe('active')
			test.ready() // Repeated notifications cannot reset the overall wait budget.
			await vi.advanceTimersByTimeAsync(1)
			await test.finish({ outcome: 'failed', code: 'timeout' })
			expect(vi.getTimerCount()).toBe(0)
		}
	)
})
