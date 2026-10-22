import { describe, expect, it } from 'vitest'
import {
	assess,
	brokenRecords,
	membership,
	records,
	scope,
	systemCategories
} from './workspace-integrity.fixture.js'

describe('workspace integrity assessment', () => {
	it('prepares only the two validated required categories with deterministic identities', async () => {
		const { prepareWorkspaceSystemCategories } =
			await import('../domain/workspace-system-categories.js')
		expect(await prepareWorkspaceSystemCategories(scope.organizationId)).toEqual(systemCategories)
		expect(systemCategories.map((row) => [row.kind, row.isSystem])).toEqual([
			['expense', true],
			['income', true]
		])
	})
	it('accepts renamed system categories with noncanonical IDs and no optional starters', () => {
		const snapshot = records()
		const result = assess({
			records: {
				...snapshot,
				categories: snapshot.categories.map((row, index) => ({
					...row,
					name: 'Legacy name',
					id: index === 0 ? scope.profileId : membership.id
				}))
			}
		})
		expect(result.value).toBe('complete')
		expect(result.output).toEqual({ outcome: 'complete' })
	})
	for (const role of ['owner', 'admin'] satisfies (typeof membership.role)[]) {
		it(`allows ${role} to repair the existing profile link and required categories`, () => {
			const result = assess({ records: brokenRecordsWithRole(role) })
			expect(result.value).toBe('repair')
			expect(result.output).toEqual({
				outcome: 'repair',
				remaining: [],
				plan: {
					profileLink: { membershipId: membership.id, profileId: scope.profileId },
					categories: systemCategories
				}
			})
		})
	}
	it('allows member category repair while retaining a separate profile-link issue', () => {
		expect(assess({ records: brokenRecordsWithRole('member') }).output).toEqual({
			outcome: 'repair',
			plan: { profileLink: undefined, categories: systemCategories },
			remaining: ['profileLink']
		})
	})
	it('does not grant viewer repair authority from workspace creator identity', () => {
		const snapshot = brokenRecordsWithRole('viewer')
		snapshot.organizations = snapshot.organizations.map((row) => ({
			...row,
			ownerId: scope.userId
		}))
		const result = assess({ records: snapshot })
		expect(result.value).toBe('partial')
		expect(result.output).toEqual({
			outcome: 'partial',
			issues: ['profileLink', 'expense', 'income']
		})
	})
	for (const [name, snapshot] of [
		['missing membership', records({ memberships: [] })],
		['missing workspace', records({ organizations: [] })],
		['missing profile', records({ profiles: [] })]
	] satisfies [string, ReturnType<typeof records>][]) {
		it(`reports ${name} without planning replacement records`, () => {
			expect(assess({ records: snapshot }).value).toBe('unavailable')
		})
	}
	it('rejects duplicate or mismatched login profiles and memberships', () => {
		const snapshot = records()
		expect(
			assess({ records: records({ profiles: [...snapshot.profiles, ...snapshot.profiles] }) })
				.output
		).toEqual({ outcome: 'conflict', reason: 'profileAmbiguous' })
		expect(assess({ profileId: membership.id }).value).toBe('conflict')
		expect(assess({ records: records({ memberships: [membership, membership] }) }).output).toEqual({
			outcome: 'conflict',
			reason: 'membershipAmbiguous'
		})
		expect(
			assess({ records: records({ memberships: [{ ...membership, userId: membership.id }] }) })
				.value
		).toBe('conflict')
	})
	it('rejects archived, duplicate, foreign-scope, or occupied system identities', () => {
		const snapshot = records()
		const expense = snapshot.categories[0]
		if (!expense) throw new Error('Missing expense fixture')
		for (const categories of [
			[...snapshot.categories, { ...expense, id: membership.id }],
			snapshot.categories.map((row) => ({ ...row, archivedAt: new Date() })),
			snapshot.categories.map((row) => ({ ...row, organizationId: membership.id })),
			[{ ...expense, isSystem: false }]
		])
			expect(assess({ records: records({ categories }) }).output).toEqual({
				outcome: 'conflict',
				reason: 'systemCategories'
			})
	})
	it('rejects incomplete or duplicate required definitions', () => {
		expect(assess({ systemCategories: [] }).value).toBe('conflict')
		expect(assess({ systemCategories: [...systemCategories, ...systemCategories] }).value).toBe(
			'conflict'
		)
	})
})

function brokenRecordsWithRole(role: typeof membership.role) {
	return { ...brokenRecords(), memberships: [{ ...membership, profileId: null, role }] }
}
