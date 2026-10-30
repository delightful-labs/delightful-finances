import { afterAll, beforeAll, expect, it } from 'vitest'
import {
	createPolicyTestApp,
	type PolicyTestApp,
	type PolicyTestSession,
	type TestDb
} from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'

const ownerSession = {
	user_id: 'sync-log-owner',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const adminSession = {
	user_id: 'sync-log-admin',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const viewerSession = {
	user_id: 'sync-log-viewer',
	authMode: 'local-first',
	claims: {}
} satisfies PolicyTestSession
const organizationId = crypto.randomUUID(),
	connectionId = crypto.randomUUID(),
	accountId = crypto.randomUUID()
let fixture: PolicyTestApp
let owner: TestDb, admin: TestDb, viewer: TestDb
let initiatedBy: string
const startedAt = new Date('2026-10-30T12:00:00Z')
const attempt = () =>
	({
		organizationId,
		connectionId,
		initiatedBy,
		startedAt,
		outcome: 'unfinished',
		importSettlement: 'notStarted'
	}) satisfies import('jazz-tools').schema.InsertOf<typeof app.simplefinSyncAttempts>
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	owner = fixture.as(ownerSession)
	admin = fixture.as(adminSession)
	viewer = fixture.as(viewerSession)
	initiatedBy = fixture.accountFor(ownerSession)
	await fixture.seed((seed) =>
		seed.insert(
			app.organizations,
			{ name: 'Sync logs', ownerId: initiatedBy, kind: 'personal', defaultCurrency: 'USD' },
			{ id: organizationId }
		)
	)
	for (const [session, role] of [
		[ownerSession, 'owner'],
		[adminSession, 'admin'],
		[viewerSession, 'viewer']
	] satisfies [PolicyTestSession, 'owner' | 'admin' | 'viewer'][]) {
		await fixture.seed((seed) =>
			seed.insert(app.organizationMembers, {
				organizationId,
				userId: fixture.accountFor(session),
				role,
				accountAccessMode: 'all'
			})
		)
	}
	await fixture.seed((seed) =>
		seed.insert(
			app.simplefinConnections,
			{
				organizationId,
				ownerId: initiatedBy,
				accessUrl: '',
				status: 'active',
				claimedAt: startedAt
			},
			{ id: connectionId }
		)
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.accounts,
			{ organizationId, name: 'Checking', kind: 'bank', currency: 'USD' },
			{ id: accountId }
		)
	)
}, 30000)
afterAll(async () => {
	await fixture?.shutdown()
})

it('allows the owner to record and settle an attempt and account result, with admin reads', async () => {
	const row = await owner.insert(app.simplefinSyncAttempts, attempt()).wait({ tier: 'global' })
	const result = await owner
		.insert(app.simplefinSyncAccountResults, {
			attemptId: row.id,
			organizationId,
			accountId,
			accountName: 'Checking',
			outcome: 'succeeded',
			importedCount: 2,
			existingCount: 0,
			omittedCount: 0
		})
		.wait({ tier: 'global' })
	await owner
		.update(app.simplefinSyncAttempts, row.id, {
			outcome: 'succeeded',
			finishedAt: new Date('2026-10-30T12:01:00Z'),
			importSettlement: 'locallyPersisted',
			importedCount: 2,
			existingCount: 0,
			omittedCount: 0
		})
		.wait({ tier: 'global' })
	expect(
		(await admin.one(app.simplefinSyncAttempts.where({ id: row.id }), { tier: 'remote' }))?.outcome
	).toBe('succeeded')
	expect(
		(await admin.one(app.simplefinSyncAccountResults.where({ id: result.id }), { tier: 'remote' }))
			?.importedCount
	).toBe(2)
	await owner.expectDenied((db) =>
		db.update(app.simplefinSyncAttempts, row.id, { outcome: 'unfinished' })
	)
	await owner.expectDenied((db) =>
		db.update(app.simplefinSyncAccountResults, result.id, { importedCount: 99 })
	)
})
it('denies nonowner writes, viewer reads, forged scope, terminal inserts and deletes', async () => {
	const row = await owner.insert(app.simplefinSyncAttempts, attempt()).wait({ tier: 'global' })
	expect(
		await viewer.one(app.simplefinSyncAttempts.where({ id: row.id }), { tier: 'remote' })
	).toBeNull()
	await admin.expectDenied((db) =>
		db.insert(app.simplefinSyncAttempts, {
			...attempt(),
			initiatedBy: fixture.accountFor(adminSession)
		})
	)
	await owner.expectDenied((db) =>
		db.insert(app.simplefinSyncAttempts, { ...attempt(), organizationId: crypto.randomUUID() })
	)
	await owner.expectDenied((db) =>
		db.insert(app.simplefinSyncAttempts, { ...attempt(), outcome: 'succeeded' })
	)
	await owner.expectDenied((db) =>
		db.update(app.simplefinSyncAttempts, row.id, { startedAt: new Date() })
	)
	await owner.expectDenied((db) => db.delete(app.simplefinSyncAttempts, row.id))
})
