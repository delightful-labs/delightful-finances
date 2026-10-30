import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { workspaceReports } from './workspace-reports.fixture.js'
import {
	selectWorkspaceIntegrityView,
	type IntegrityStatusEvent
} from '../../contracts/workspace-integrity-contract.js'
import {
	createWorkspaceIntegrityOwner,
	type IntegrityBinding
} from './workspace-integrity-owner.js'
import { integrityFixture, membership, records, scope } from './workspace-integrity.fixture.js'
const actors: { stop: () => void }[] = []
afterEach(() => actors.splice(0).forEach((actor) => actor.stop()))
const binding: IntegrityBinding = {
	...scope,
	membershipId: membership.id,
	role: 'owner',
	accountAccessMode: 'all'
}
function start(f: ReturnType<typeof integrityFixture>, value: IntegrityBinding | undefined) {
	const recipient = workspaceReports<IntegrityStatusEvent>()
	actors.push(recipient)
	const actor = createActor(createWorkspaceIntegrityOwner(f.db), {
		input: { request: { generation: 0, binding: value }, recipient }
	}).start()
	actors.push(actor)
	return { actor, reports: () => recipient.getSnapshot().context }
}
describe('integrity binding ownership', () => {
	it('waits for a usable binding and does not restart on identical observations', async () => {
		const f = integrityFixture(records())
		const { actor } = start(f, undefined)
		expect(f.discover).not.toHaveBeenCalled()
		actor.send({ type: 'OBSERVED', request: { generation: 0, binding } })
		await waitFor(actor, (s) => s.matches('complete'))
		actor.send({ type: 'OBSERVED', request: { generation: 0, binding: { ...binding } } })
		expect(f.discover).toHaveBeenCalledTimes(3)
	})
	it('drains old writes before using the latest pending workspace', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => pending.promise)
		const { actor, reports } = start(f, binding)
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalled())
		actor.send({
			type: 'OBSERVED',
			request: { generation: 1, binding: { ...binding, organizationId: scope.profileId } }
		})
		actor.send({
			type: 'OBSERVED',
			request: { generation: 2, binding: { ...binding, organizationId: membership.id } }
		})
		expect(actor.getSnapshot().matches({ running: 'replacing' })).toBe(true)
		expect(f.discover).toHaveBeenCalledTimes(6)
		pending.resolve()
		await waitFor(actor, (s) => s.matches('unavailable'))
		expect(actor.getSnapshot().context.operation?.binding?.organizationId).toBe(membership.id)
		expect(f.discover).toHaveBeenCalledTimes(9)
		expect(reports().at(-1)?.report.request.generation).toBe(2)
		expect(
			reports().some(
				(event) => event.report.request.generation === 1 && event.report.status.kind === 'complete'
			)
		).toBe(false)
	})
	it('preserves shutdown while replacing and ignores retries and late observations', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => pending.promise)
		const { actor, reports } = start(f, binding)
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalled())
		actor.send({ type: 'OBSERVED', request: { generation: 1, binding: undefined } })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'OBSERVED', request: { generation: 2, binding } })
		actor.send({ type: 'OBSERVED', request: { generation: 0, binding } })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		await waitFor(actor, (s) => s.status === 'done')
		expect(f.discover).toHaveBeenCalledTimes(6)
	})
	it('does not retry failure from ordinary observations of the same binding', async () => {
		const f = integrityFixture(records())
		f.discover.mockReset().mockRejectedValue(new Error('read failed'))
		const { actor, reports } = start(f, binding)
		await waitFor(actor, (s) => s.matches('failed'))
		actor.send({ type: 'OBSERVED', request: { generation: 0, binding } })
		expect(f.discover).toHaveBeenCalledTimes(3)
		actor.send({ type: 'OBSERVED', request: { generation: 2, binding } })
		await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(6))
	})
	it('rechecks when authorization facts change', async () => {
		const f = integrityFixture(records())
		const { actor, reports } = start(f, binding)
		await waitFor(actor, (s) => s.matches('complete'))
		actor.send({
			type: 'OBSERVED',
			request: { generation: 1, binding: { ...binding, role: 'member' } }
		})
		await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(6))
		expect(actor.getSnapshot().context.operation?.binding?.role).toBe('member')
	})
	it('does not reuse a prior visit to the same workspace while its write drains', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => pending.promise)
		const { actor, reports } = start(f, binding)
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalled())
		actor.send({ type: 'OBSERVED', request: { generation: 1, binding: undefined } })
		actor.send({ type: 'OBSERVED', request: { generation: 2, binding } })
		// A new assessment sees the records committed by the old repair, not an empty mock store.
		const repaired = records()
		for (const rows of [repaired.profiles, repaired.organizations, repaired.memberships])
			f.discover.mockResolvedValueOnce(rows)
		pending.resolve()
		await waitFor(actor, (snapshot) => snapshot.matches('complete'))
		expect(reports().at(-1)?.report.request.generation).toBe(2)
		expect(
			reports()
				.filter((event) => event.report.status.kind === 'complete')
				.every((event) => event.report.request.generation === 2)
		).toBe(true)
	})
	it('reports the existing usable profile-attribution partial policy', async () => {
		const rows = records()
		rows.memberships = rows.memberships.map((row) => ({ ...row, profileId: null, role: 'member' }))
		const f = integrityFixture(rows)
		const { actor, reports } = start(f, { ...binding, role: 'member' })
		await waitFor(actor, (snapshot) => snapshot.matches('partial'))
		const report = reports().at(-1)?.report
		expect(report?.status).toMatchObject({
			kind: 'partial',
			issues: ['profileLink'],
			access: 'usable'
		})
		expect(selectWorkspaceIntegrityView(report)).toEqual({ mode: 'partial', canRetry: true })
	})
	it('keeps viewer access usable when only profile attribution needs repair', async () => {
		const f = integrityFixture(
			records({ memberships: [{ ...membership, role: 'viewer', profileId: null }] })
		)
		const { actor, reports } = start(f, { ...binding, role: 'viewer' })
		await waitFor(actor, (snapshot) => snapshot.matches('partial'))
		expect(reports().at(-1)?.report.status).toMatchObject({
			kind: 'partial',
			issues: ['profileLink'],
			access: 'usable'
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('preserves unresolved settlement when a write fails while shutdown drains', async () => {
		const f = integrityFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => pending.promise)
		const { actor, reports } = start(f, binding)
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalled())
		actor.send({ type: 'SHUTDOWN' })
		pending.reject(new Error('Local settlement failed'))
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(reports().at(-1)?.report.status).toEqual({ kind: 'closed', settlement: 'unresolved' })
	})
})
