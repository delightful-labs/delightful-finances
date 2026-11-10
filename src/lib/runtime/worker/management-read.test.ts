import { expect, it } from 'vitest'
import { projectManagementData } from './management-read.js'
import { managementViewSchema, emptyManagementView } from './management-protocol.js'
import type { ManagementObservation } from '../../contracts/management-contract.js'
import type { Category, Tag } from '../../schema.js'
import { id, source } from '../../machines/bank-sync/test-fixtures.js'
class Binding {}
const binding = new Binding()
const category: Category = {
	id: id(30),
	organizationId: id(2),
	name: 'Bills',
	kind: 'expense',
	isSystem: false,
	archivedAt: null
}
const tag: Tag = {
	id: id(31),
	organizationId: id(2),
	name: 'Old label',
	kind: 'expense',
	categoryId: category.id,
	archivedAt: new Date('2026-01-01')
}
function facts(patch: Partial<ManagementObservation> = {}): ManagementObservation {
	return {
		identityId: id(1),
		organizationId: id(2),
		binding,
		sessionReady: true,
		membership: source.membership,
		categories: [category],
		tags: [tag],
		loading: false,
		failed: false,
		...patch
	}
}
function project(
	categoryFacts = facts(),
	tagFacts = categoryFacts,
	categoryOffset = 0,
	categoryFilter: 'active' | 'all' | 'archived' = 'active'
) {
	return projectManagementData({
		category: categoryFacts,
		tag: tagFacts,
		transactions: [{ categoryId: category.id }, { categoryId: category.id }],
		binding,
		categoryOffset,
		tagOffset: 0,
		categoryFilter,
		tagFilter: 'archived',
		categoryOptionsKind: 'expense',
		categoryOptionsOffset: 0
	})
}
it('counts every readable transaction and archived tag before filtering and paging', () => {
	const result = project()
	expect(result.categories[0]).toMatchObject({
		id: category.id,
		transactionCount: 2,
		tagCount: 1,
		archivable: true
	})
	expect(result.tags[0]).toMatchObject({ id: tag.id, categoryName: category.name })
	expect(
		managementViewSchema.safeParse({ forms: emptyManagementView().forms, ...result }).success
	).toBe(true)
})
it('preserves category labels for tag history while excluding archived categories from new tag options', () => {
	const result = project(
		facts({ categories: [{ ...category, archivedAt: new Date('2026-01-01') }] }),
		undefined,
		0,
		'archived'
	)
	expect(result.categoryOptions).toEqual([])
	expect(result.tags[0]?.categoryName).toBe(category.name)
	expect(result.categories[0]?.tagCount).toBe(1)
})
it('uses the same management policy for archive eligibility, including protected and read-only records', () => {
	const protectedResult = project(facts({ categories: [{ ...category, isSystem: true }] }))
	expect(protectedResult.categories[0]?.archivable).toBe(false)
	const viewer = project(facts({ membership: { ...source.membership!, role: 'viewer' } }))
	expect(viewer.categories[0]?.archivable).toBe(false)
	expect(viewer.tags[0]?.archivable).toBe(false)
})
it('bounds both catalogs and options while preserving complete counts and reachability after the first page', () => {
	const categories = Array.from({ length: 501 }, (_, index) => ({
		...category,
		id: index === 500 ? category.id : id(100 + index),
		name: `Category ${index}`
	}))
	const initial = project(facts({ categories }))
	expect(initial.categories).toHaveLength(500)
	expect(initial.categoryOptions).toHaveLength(500)
	expect(initial.categoryPage).toEqual({ offset: 0, total: 501, hasMore: true })
	expect(initial.categoryOptionsPage.hasMore).toBe(true)
	const next = project(facts({ categories }), undefined, 500)
	expect(next.categories).toHaveLength(1)
	expect(next.categories[0]).toMatchObject({ id: category.id, transactionCount: 2, tagCount: 1 })
	expect(next.categoryPage).toEqual({ offset: 500, total: 501, hasMore: false })
})
it('keeps category history query failure separate from usable tag data', () => {
	const result = project(facts({ failed: true }), facts())
	expect(result.failed).toBe(true)
	expect(result.tagFailed).toBe(false)
	expect(result.tags[0]?.categoryName).toBe(category.name)
})
