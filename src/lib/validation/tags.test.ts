import { describe, expect, it } from 'vitest'
import { appTagSchema, tagFormSchema, tagArchiveSchema } from './tags.js'

const organizationId = '11111111-1111-4111-8111-111111111111'
const tagId = '22222222-2222-4222-8222-222222222222'

describe('tag validation', () => {
	it('trims names and defaults to uncategorized and active', () => {
		expect(appTagSchema.parse({ organizationId, name: '  Garden  ' })).toEqual({
			organizationId,
			name: 'Garden',
			categoryId: null,
			archivedAt: null
		})
	})
	it('preserves a category and archive date', () => {
		const archivedAt = new Date()
		expect(
			appTagSchema.parse({ organizationId, name: 'Garden', categoryId: tagId, archivedAt })
		).toMatchObject({ categoryId: tagId, archivedAt })
	})
	it.each([
		{ name: ' ' },
		{ organizationId: '' },
		{ categoryId: '' },
		{ categoryId: 'bad' },
		{ archivedAt: '2026-10-13' }
	])('rejects invalid fields %j', (override) => {
		expect(appTagSchema.safeParse({ organizationId, name: 'Garden', ...override }).success).toBe(
			false
		)
	})
	it.each(['', null, undefined])('normalizes no category %j from the form', (categoryId) => {
		expect(tagFormSchema.parse({ name: '  Garden  ', categoryId })).toEqual({
			name: 'Garden',
			categoryId: null
		})
	})
	it('preserves a valid selected category and strips other fields', () => {
		expect(
			tagFormSchema.parse({
				name: 'Garden',
				categoryId: tagId,
				organizationId,
				archivedAt: new Date()
			})
		).toEqual({ name: 'Garden', categoryId: tagId })
	})
	it.each(['', ' ', '\n\t'])('rejects blank form names %j', (name) => {
		expect(tagFormSchema.safeParse({ name, categoryId: '' }).success).toBe(false)
	})
	it('accepts archive identifiers', () => {
		expect(tagArchiveSchema.parse({ organizationId, tagId })).toEqual({ organizationId, tagId })
	})
	it.each([
		{ organizationId: '' },
		{ tagId: '' },
		{ organizationId: undefined },
		{ tagId: undefined }
	])('rejects invalid archive identifiers %j', (override) => {
		expect(tagArchiveSchema.safeParse({ organizationId, tagId, ...override }).success).toBe(false)
	})
})
