import { describe, expect, it } from 'vitest'
import { createActor, type EventFrom } from 'xstate'
import {
	createAccountMergePresentationMachine,
	selectAccountMergePresentation
} from './presentation.js'
import { id } from './mapping.fixtures.js'

type Machine = ReturnType<typeof createAccountMergePresentationMachine>
type Observation = Extract<EventFrom<Machine>, { type: 'OBSERVED' }>['observation']
function fixture() {
	const binding = {}
	const observation: Observation = {
		status: 'ready',
		identityId: id(3),
		organizationId: id(4),
		binding
	}
	const actor = createActor(createAccountMergePresentationMachine(binding)).start()
	const observe = (change: Partial<Observation> = {}) =>
		actor.send({ type: 'OBSERVED', observation: { ...observation, ...change } })
	const view = () => selectAccountMergePresentation(actor.getSnapshot())
	const check = () => {
		actor.send({ type: 'CHECK' })
		const request = actor.getSnapshot().context.request
		if (!request) throw new Error('Expected request')
		return request
	}
	return { actor, observe, view, check, observation }
}
describe('isolated account merge presentation', () => {
	it('waits for facts and makes no check request until explicitly commanded', () => {
		const test = fixture()
		expect(test.view()).toEqual({ kind: 'waiting' })
		test.actor.send({ type: 'CHECK' })
		expect(test.view()).toEqual({ kind: 'waiting' })
		test.observe()
		expect(test.view()).toEqual({ kind: 'available' })
		expect(test.actor.getSnapshot().context.request).toBeUndefined()
		const request = test.check()
		expect(test.view()).toEqual({ kind: 'checking', request })
	})
	it.each([
		{ change: { status: 'transitioning' }, kind: 'session-unavailable' },
		{ change: { status: 'error' }, kind: 'session-unavailable' },
		{ change: { status: 'closed' }, kind: 'session-unavailable' },
		{ change: { status: 'signed-out' }, kind: 'session-unavailable' },
		{ change: { identityId: null }, kind: 'session-unavailable' },
		{ change: { binding: {} }, kind: 'session-unavailable' },
		{ change: { organizationId: null }, kind: 'select-workspace' }
	] satisfies { change: Partial<Observation>; kind: string }[])(
		'gates $kind for $change',
		({ change, kind }) => {
			const test = fixture()
			test.observe(change)
			test.actor.send({ type: 'CHECK' })
			expect(test.view()).toEqual({ kind })
			expect(test.actor.getSnapshot().context.request).toBeUndefined()
		}
	)
	it('keeps the active request across identical observations and repeated check commands', () => {
		const test = fixture()
		test.observe()
		const request = test.check()
		test.observe()
		test.actor.send({ type: 'CHECK' })
		expect(test.actor.getSnapshot().context.request).toBe(request)
	})
	it.each([
		{ identityId: id(90) },
		{ organizationId: id(90) },
		{ binding: {} },
		{ status: 'transitioning' }
	] satisfies Partial<Observation>[])(
		'discards an active request after changed facts %j',
		(change) => {
			const test = fixture()
			test.observe()
			const request = test.check()
			test.observe(change)
			test.actor.send({
				type: 'RESULT',
				request,
				result: { outcome: 'eligible', destination: request }
			})
			expect(test.actor.getSnapshot().context.request).toBeUndefined()
			expect(test.actor.getSnapshot().context.result).toBeUndefined()
			expect(test.view().kind).not.toBe('eligible')
		}
	)
	it.each(['eligible', 'failed'] satisfies ('eligible' | 'failed')[])(
		'shows %s results and supports a new explicit check',
		(outcome) => {
			const test = fixture()
			test.observe()
			const request = test.check()
			test.actor.send({
				type: 'RESULT',
				request,
				result:
					outcome === 'eligible'
						? { outcome, destination: request }
						: { outcome, code: 'not-owned-personal' }
			})
			expect(test.view()).toEqual(
				outcome === 'eligible'
					? { kind: 'eligible' }
					: { kind: 'denied', code: 'not-owned-personal' }
			)
			expect(test.actor.getSnapshot().context.request).toBeUndefined()
			expect(test.check()).not.toBe(request)
		}
	)
	it('ignores stale completion from a cancelled request while a new request is active', () => {
		const test = fixture()
		test.observe()
		const old = test.check()
		test.actor.send({ type: 'CANCEL' })
		expect(test.view()).toEqual({ kind: 'available' })
		const current = test.check()
		test.actor.send({
			type: 'RESULT',
			request: old,
			result: { outcome: 'failed', code: 'timeout' }
		})
		expect(test.view()).toEqual({ kind: 'checking', request: current })
		test.actor.send({
			type: 'RESULT',
			request: current,
			result: { outcome: 'eligible', destination: current }
		})
		expect(test.view()).toEqual({ kind: 'eligible' })
	})
	it.each(['cancelled', 'closed'] satisfies ('cancelled' | 'closed')[])(
		'returns to available on child %s without exposing an eligibility claim',
		(outcome) => {
			const test = fixture()
			test.observe()
			const request = test.check()
			test.actor.send({ type: 'RESULT', request, result: { outcome } })
			expect(test.view()).toEqual({ kind: 'available' })
		}
	)
	it('clears result and observation on shutdown', () => {
		const test = fixture()
		test.observe()
		test.check()
		test.actor.send({ type: 'SHUTDOWN' })
		expect(test.view()).toEqual({ kind: 'closed' })
		expect(test.actor.getSnapshot().context).toEqual({
			observation: undefined,
			request: undefined,
			result: undefined
		})
		expect(test.actor.getSnapshot().status).toBe('done')
	})
})
