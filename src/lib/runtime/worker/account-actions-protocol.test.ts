import { expect, it } from 'vitest'
import {
	projectAccountActions,
	accountActionsViewSchema,
	accountActionsCommandSchema,
	emptyAccountActions
} from './account-actions-protocol.js'
import {
	selectAccountArchiveNotice,
	type AccountArchiveView
} from '../../machines/accounts/account-archive.js'
import type { ArchiveResult } from '../../machines/accounts/account-archive-operation.js'
import type {
	AccountDeleteGrantView,
	DeleteGrantObservation
} from '../../machines/accounts/account-delete-grants.js'
import { account, source, id } from '../../machines/bank-sync/test-fixtures.js'
class Binding {
	privateMarker = 'PRIVATE SDK'
}
function fixture() {
	const binding = new Binding()
	const request = {
		identityId: id(1),
		organizationId: id(2),
		binding,
		accountId: account.id,
		name: account.name
	}
	const feedback: ArchiveResult = { outcome: 'succeeded', settlement: 'locallyPersisted', request }
	const archive: AccountArchiveView = {
		kind: 'ready',
		rows: [{ account, action: 'available' }],
		feedback,
		notice: selectAccountArchiveNotice(feedback)
	}
	const observation: DeleteGrantObservation = {
		identityId: id(1),
		organizationId: id(2),
		binding,
		sessionReady: true,
		loading: false,
		failed: false,
		membership: source.membership,
		accounts: [account],
		members: [{ ...source.membership!, id: id(42), userId: id(43), role: 'member' }],
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
	}
	const grants: AccountDeleteGrantView = {
		busy: false,
		canManage: true,
		result: { outcome: 'succeeded', request: { ...request, userId: id(43), canDelete: true } },
		notice: { key: 'permissions.updated', variant: 'success', accountId: account.id }
	}
	return {
		archive,
		grants,
		observation,
		selectedAccountId: account.id,
		accountOffset: 0,
		permissionOffset: 0,
		balancesReady: true
	}
}
it('projects only safe account receipts and precomputed permission controls', () => {
	const result = projectAccountActions(fixture())
	expect(result.deleteGrants.permissions).toEqual([{ id: id(42), userId: id(43), canDelete: true }])
	expect(result.archive.feedback).toEqual({
		outcome: 'succeeded',
		settlement: 'locallyPersisted',
		request: { accountId: account.id, name: account.name }
	})
	expect(result.deleteGrants.result).toEqual({
		outcome: 'succeeded',
		request: { accountId: account.id }
	})
	expect(JSON.stringify(result)).not.toMatch(/binding|PRIVATE SDK|privateMarker/)
	expect(structuredClone(result)).toEqual(result)
})
it('does not expose permission controls for another selected account or an unauthorized viewer', () => {
	const f = fixture()
	expect(
		projectAccountActions({ ...f, selectedAccountId: id(99) }).deleteGrants.permissions
	).toEqual([])
	expect(
		projectAccountActions({ ...f, grants: { ...f.grants, canManage: false } }).deleteGrants
			.permissions
	).toEqual([])
})
it('bounds permission rows while preserving correct grants on later pages', () => {
	const f = fixture()
	f.observation.members = Array.from({ length: 501 }, (_, index) => ({
		...source.membership!,
		id: id(1000 + index),
		userId: id(2000 + index),
		role: 'member'
	}))
	f.observation.grants = [
		{
			id: id(3000),
			organizationId: id(2),
			accountId: account.id,
			userId: id(2500),
			access: 'read',
			canDelete: true
		}
	]
	const first = projectAccountActions(f)
	expect(first.deleteGrants.permissions).toHaveLength(500)
	expect(first.permissionPage).toEqual({ offset: 0, total: 501, hasMore: true })
	const next = projectAccountActions({ ...f, permissionOffset: 500 })
	expect(next.deleteGrants.permissions).toEqual([
		{ id: id(1500), userId: id(2500), canDelete: true }
	])
})
it('rejects privileged handles, malformed IDs and inconsistent financial receipts', () => {
	expect(
		accountActionsCommandSchema.safeParse({
			type: 'SET_DELETE',
			accountId: account.id,
			userId: id(43),
			canDelete: true,
			binding: new Binding()
		}).success
	).toBe(false)
	expect(
		accountActionsCommandSchema.safeParse({ type: 'ARCHIVE_ACCOUNT', accountId: 'invalid' }).success
	).toBe(false)
	const empty = emptyAccountActions()
	expect(
		accountActionsViewSchema.safeParse({
			...empty,
			archive: {
				...empty.archive,
				feedback: {
					outcome: 'succeeded',
					settlement: 'unknown',
					request: { accountId: account.id, name: account.name }
				}
			}
		}).success
	).toBe(false)
})
it('keeps permission loading/failure independent of archive availability', () => {
	const f = fixture()
	const result = projectAccountActions({ ...f, observation: { ...f.observation, failed: true } })
	expect(result.archive.rows[0]?.action).toBe('available')
	expect(result.permissionsFailed).toBe(true)
})
