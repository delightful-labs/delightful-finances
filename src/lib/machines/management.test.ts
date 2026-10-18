import { describe, expect, it, vi } from 'vitest'
import { createActor, getInitialSnapshot, waitFor } from 'xstate'
import type { ManagementObservation, ManagementReason } from '#lib/management-contract.js'
import {
	createManagementAvailability,
	managementScope,
	sameManagementScope,
	selectManagementArchiveIds,
	selectManagementAvailability
} from './management.js'
import { createScopedFormWriteMachine } from './scoped-form-write.js'

const binding = {}
const category = {
	id: 'category',
	organizationId: 'org',
	name: 'Food',
	kind: 'expense',
	isSystem: false,
	archivedAt: null
} satisfies ManagementObservation['categories'][number]
const tag = {
	id: 'tag',
	organizationId: 'org',
	name: 'Groceries',
	categoryId: 'category',
	archivedAt: null
} satisfies ManagementObservation['tags'][number]
function facts(): ManagementObservation {
	return {
		binding,
		identityId: 'user',
		organizationId: 'org',
		sessionReady: true,
		loading: false,
		failed: false,
		membership: {
			id: 'member',
			userId: 'user',
			organizationId: 'org',
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		},
		categories: [category],
		tags: [tag]
	}
}
function policy(f: ManagementObservation) {
	return selectManagementAvailability(
		getInitialSnapshot(createManagementAvailability(binding), { revision: 4, facts: f })
	).readiness
}
describe('category/tag policy', () => {
	it.each([
		[{ sessionReady: false }, 'sessionUnavailable'],
		[{ binding: {} }, 'sessionUnavailable'],
		[{ identityId: null }, 'sessionUnavailable'],
		[{ organizationId: null }, 'selectWorkspace'],
		[{ failed: true, loading: true }, 'loadFailed'],
		[{ loading: true }, 'loading'],
		[{ membership: null }, 'readOnly'],
		[
			{ intent: { kind: 'archiveCategory', id: 'missing', organizationId: 'org' } },
			'unavailableReference'
		],
		[
			{ intent: { kind: 'archiveTag', id: 'tag', organizationId: 'other' } },
			'unavailableReference'
		],
		[{ intent: { kind: 'createTag', categoryId: 'missing' } }, 'unavailableReference'],
		[
			{
				categories: [{ ...category, isSystem: true }],
				intent: { kind: 'archiveCategory', id: 'category', organizationId: 'org' }
			},
			'protectedRecord'
		]
	] satisfies [Partial<ManagementObservation>, ManagementReason][])(
		'classifies %j',
		(patch, reason) => expect(policy({ ...facts(), ...patch })).toEqual({ kind: 'blocked', reason })
	)
	it.each(['owner', 'admin', 'member', 'viewer'] satisfies NonNullable<
		ManagementObservation['membership']
	>['role'][])('preserves %s editing permissions', (role) => {
		const f = facts()
		if (!f.membership) throw new Error('fixture')
		f.membership = { ...f.membership, role }
		expect(policy(f).kind).toBe(role === 'viewer' ? 'blocked' : 'ready')
	})
	it('rejects mismatched membership identities and archived references', () => {
		const f = facts()
		if (!f.membership) throw new Error('fixture')
		expect(policy({ ...f, membership: { ...f.membership, userId: 'other' } })).toEqual({
			kind: 'blocked',
			reason: 'readOnly'
		})
		expect(
			policy({
				...f,
				categories: [{ ...category, archivedAt: new Date() }],
				intent: { kind: 'createTag', categoryId: category.id }
			})
		).toEqual({ kind: 'blocked', reason: 'unavailableReference' })
		expect(policy({ ...f, intent: { kind: 'createTag', categoryId: null } })).toEqual({
			kind: 'ready'
		})
	})
	it('projects archive row capabilities through the same assessment', () => {
		const f = facts()
		f.categories = [
			category,
			{ ...category, id: 'system', isSystem: true },
			{ ...category, id: 'archived', archivedAt: new Date() }
		]
		expect(selectManagementArchiveIds(f, binding, 'archiveCategory')).toEqual(['category'])
		expect(selectManagementArchiveIds(f, binding, 'archiveTag')).toEqual(['tag'])
	})
	it('assesses exact fresh request target before effect and settles an issued archive on shutdown', async () => {
		let current = facts()
		const write = vi.fn(async () => 'Food')
		const availability = createManagementAvailability(binding)
		const machine = createScopedFormWriteMachine<
			{ id: string },
			string,
			ManagementReason,
			ReturnType<typeof managementScope>,
			ManagementObservation,
			ReturnType<typeof availability.getInitialSnapshot>
		>({
			availability,
			selectAvailability: selectManagementAvailability,
			scopeOf: managementScope,
			sameScope: sameManagementScope,
			observe: () => current,
			classifyBlocked: (r) =>
				r === 'protectedRecord' || r === 'readOnly' ? 'denied' : 'unavailable',
			assessmentObservation: ({ request, observation }) => ({
				...observation.facts,
				intent: { kind: 'archiveCategory', id: request.values.id, organizationId: 'org' }
			}),
			write,
			settlement: 'locallyPersisted'
		})
		const input = {
			request: {
				id: 1,
				scope: managementScope(current),
				scopeRevision: 0,
				values: { id: 'category' }
			},
			observation: { revision: 0, facts: current }
		}
		current = { ...current, categories: [{ ...category, isSystem: true }] }
		const denied = createActor(machine, { input }).start()
		await waitFor(denied, (s) => s.status === 'done')
		expect(denied.getSnapshot().output).toMatchObject({
			outcome: 'denied',
			reason: 'protectedRecord'
		})
		expect(write).not.toHaveBeenCalled()
		denied.stop()
		current = facts()
		const saved = Promise.withResolvers<string>()
		write.mockImplementation(() => saved.promise)
		const active = createActor(machine, { input }).start()
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
		active.send({ type: 'SHUTDOWN' })
		expect(active.getSnapshot().status).toBe('active')
		saved.resolve('Food')
		await waitFor(active, (s) => s.status === 'done')
		expect(active.getSnapshot().output).toEqual({
			outcome: 'closed',
			settlement: 'locallyPersisted'
		})
		active.stop()
	})
})
