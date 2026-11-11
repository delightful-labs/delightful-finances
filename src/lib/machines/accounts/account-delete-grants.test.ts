import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import {
	createAccountDeleteGrantMachine,
	selectAccountDeleteGrantView,
	type DeleteGrantObservation,
	type GrantWrite
} from './account-delete-grants.js'
import { account, source, id } from '../bank-sync/test-fixtures.js'
class Binding {}
const roots = new Set<
	ReturnType<typeof createActor<ReturnType<typeof createAccountDeleteGrantMachine>>>
>()
afterEach(() => {
	for (const root of roots) root.stop()
	roots.clear()
})
function fixture() {
	let facts: DeleteGrantObservation = {
		identityId: id(1),
		organizationId: id(2),
		binding: new Binding(),
		sessionReady: true,
		loading: false,
		failed: false,
		membership: source.membership,
		accounts: [account],
		members: [{ ...source.membership!, id: id(42), userId: id(43), role: 'member' }],
		grants: []
	}
	const pending = Promise.withResolvers<void>()
	const persist = vi.fn((_write: GrantWrite) => pending.promise)
	const actor = createActor(createAccountDeleteGrantMachine(persist, () => facts)).start()
	roots.add(actor)
	return {
		actor,
		persist,
		pending,
		view: () => selectAccountDeleteGrantView(actor.getSnapshot()),
		change: (patch: Partial<DeleteGrantObservation>) => {
			facts = { ...facts, ...patch }
			actor.send({ type: 'OBSERVE', observation: facts })
		}
	}
}
it.each(['member', 'viewer'] satisfies NonNullable<DeleteGrantObservation['membership']>['role'][])(
	'denies %s grant management and supplies the owning selector notice',
	(role) => {
		const f = fixture()
		f.change({ membership: { ...source.membership!, role } })
		f.actor.send({ type: 'SET_DELETE', accountId: account.id, userId: id(43), canDelete: true })
		expect(f.persist).not.toHaveBeenCalled()
		expect(f.view().canManage).toBe(false)
		expect(f.view().notice).toEqual({
			key: 'permissions.manage_restricted',
			variant: 'error',
			accountId: account.id
		})
	}
)
it('rejects stale identity/membership, unknown target members and inaccessible accounts before writing', () => {
	for (const patch of [
		{ identityId: id(90) },
		{ organizationId: id(91) },
		{ accounts: [] },
		{ members: [] },
		{ loading: true },
		{ failed: true }
	]) {
		const f = fixture()
		f.change(patch)
		f.actor.send({ type: 'SET_DELETE', accountId: account.id, userId: id(43), canDelete: true })
		expect(f.persist).not.toHaveBeenCalled()
	}
})
it('waits for an issued write on shutdown rather than treating cancellation as settlement', async () => {
	const f = fixture()
	f.actor.send({ type: 'SET_DELETE', accountId: account.id, userId: id(43), canDelete: true })
	await vi.waitFor(() =>
		expect(f.persist).toHaveBeenCalledWith({
			kind: 'insert',
			organizationId: id(2),
			accountId: account.id,
			userId: id(43),
			canDelete: true
		})
	)
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	f.pending.resolve()
	await toPromise(f.actor)
	expect(f.actor.getSnapshot().status).toBe('done')
	expect(f.view().canManage).toBe(false)
})
it('updates the existing grant and reports success only after local persistence', async () => {
	const f = fixture()
	f.change({
		grants: [
			{
				id: id(44),
				organizationId: id(2),
				accountId: account.id,
				userId: id(43),
				access: 'read',
				canDelete: true
			}
		]
	})
	f.actor.send({ type: 'SET_DELETE', accountId: account.id, userId: id(43), canDelete: false })
	await vi.waitFor(() =>
		expect(f.persist).toHaveBeenCalledWith({ kind: 'update', grantId: id(44), canDelete: false })
	)
	expect(f.view().result).toBeUndefined()
	f.pending.resolve()
	await vi.waitFor(() => expect(f.view().notice?.key).toBe('permissions.updated'))
})
