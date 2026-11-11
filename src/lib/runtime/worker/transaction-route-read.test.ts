import { expect, it } from 'vitest'
import { creationFacts } from '../../machines/transactions/transaction-create.fixture.js'
import { projectTransactionRoute } from './transaction-route-read.js'
import { transactionRouteViewSchema } from './transaction-route-protocol.js'

it('keeps selected defaults available outside bounded catalog pages', () => {
	const facts = creationFacts({})
	const account = facts.accounts[0]!,
		category = facts.categories[0]!
	const accounts = Array.from({ length: 501 }, (_, index) => ({
		...account,
		id: crypto.randomUUID(),
		name: `Account ${index}`
	}))
	const categories = Array.from({ length: 501 }, (_, index) => ({
		...category,
		id: crypto.randomUUID(),
		name: `Category ${index}`,
		isSystem: index === 500
	}))
	const selected = accounts[500]!
	const view = transactionRouteViewSchema.parse(
		projectTransactionRoute({
			view: {
				generation: 1,
				mode: 'active',
				route: { kind: 'expense', pathname: '/expenses/new' },
				form: undefined
			},
			pathname: '/expenses/new',
			observation: { ...facts, accounts, categories },
			isSelected: (id) => id === selected.id
		})
	)
	expect(view.accounts).toHaveLength(500)
	expect(view.categories).toHaveLength(500)
	expect(view.defaultAccount).toEqual(
		expect.objectContaining({ id: selected.id, amountPattern: expect.any(String) })
	)
	expect(view.defaultCategory?.id).toBe(categories[500]?.id)
	expect(view.accountPage).toEqual({ offset: 0, total: 501, hasMore: true })
})
it('omits private catalogs and defaults when a controller belongs to an obsolete route', () => {
	const facts = creationFacts({})
	const view = projectTransactionRoute({
		view: {
			generation: 1,
			mode: 'active',
			route: { kind: 'expense', pathname: '/expenses/new' },
			form: undefined
		},
		pathname: '/income/new',
		observation: facts
	})
	expect(view).toMatchObject({
		mode: 'draining',
		accounts: [],
		categories: [],
		tagSuggestions: [],
		defaultAccount: null,
		defaultCategory: null
	})
	expect(view.form.canSubmit).toBe(false)
})
it('pages transfer candidates and projects only worker-owned command capabilities', () => {
	const facts = { ...creationFacts({}), transactionId: crypto.randomUUID() },
		accountId = facts.accounts[0]!.id
	const candidates = Array.from(
		{ length: 501 },
		() =>
			({
				id: crypto.randomUUID(),
				organizationId: facts.organizationId!,
				accountId,
				kind: 'income',
				amountMinor: 234,
				currency: 'USD',
				bookedOn: '2026-11-09',
				internalTransferId: null
			}) satisfies import('../../domain/internal-transfer.js').InternalTransferCandidate
	)
	const selected = candidates[500]!
	const view: import('../../contracts/transaction-route-contract.js').TransactionRouteView = {
		generation: 1,
		mode: 'active',
		route: {
			kind: 'expense',
			pathname: `/expenses/${facts.transactionId}`,
			transactionId: facts.transactionId
		},
		form: undefined,
		transfer: {
			state: 'matches',
			statusLabel: () => 'Worker status',
			deleteFeedback: { label: () => 'Worker deletion feedback', variant: 'error' },
			canDelete: true,
			candidates,
			selectedCandidateId: selected.id,
			writableCandidateIds: new Set([selected.id]),
			linkedTransfer: null,
			unlinkWritable: false,
			linkPending: false,
			unlinkPending: false,
			deletePending: false,
			linkOutcome: null,
			unlinkOutcome: 'recoveryRequired',
			deleteOutcome: 'recoveryRequired'
		}
	}
	const result = transactionRouteViewSchema.parse(
		projectTransactionRoute({
			view,
			pathname: `/expenses/${facts.transactionId}`,
			observation: facts,
			transferOffset: 500
		})
	)
	expect(result.transfer?.page).toEqual({ offset: 500, total: 501, hasMore: false })
	expect(result.transfer?.candidates).toEqual([
		expect.objectContaining({
			id: selected.id,
			accountId,
			amountMinor: 234,
			currency: 'USD',
			bookedOn: '2026-11-09',
			writable: true,
			organizationId: facts.organizationId,
			kind: 'income',
			internalTransferId: null,
			accountName: null,
			description: null,
			amountLabel: '$2.34'
		})
	])
	expect(result.transfer?.selectedCandidateId).toBe(selected.id)
	expect(result.transfer?.statusText).toBe('Worker status')
	expect(result.transfer?.deleteFeedback).toEqual({
		text: 'Worker deletion feedback',
		variant: 'error'
	})
	expect(result.transfer?.canDelete).toBe(true)
	expect(Object.hasOwn(result.transfer ?? {}, 'statusLabel')).toBe(false)
	expect(result.transfer?.unlinkOutcome).toBe('recoveryRequired')
	expect(result.transfer?.deleteOutcome).toBe('recoveryRequired')
	expect(
		projectTransactionRoute({ view, pathname: '/income/new', observation: facts }).transfer
	).toBeNull()
})

it('projects bounded private new-tag pages and opaque catalog IDs without clipping the stored draft', () => {
	const facts = creationFacts({}),
		name = 'Long tag '.repeat(800)
	const doc = {
		items: Array.from({ length: 1001 }, (_, id) => ({
			id,
			name: id === 1000 ? name : `Tag ${id}`
		})),
		nextId: 1001,
		offset: 1000,
		feedback: null
	}
	const tagId = crypto.randomUUID()
	const view = transactionRouteViewSchema.parse(
		projectTransactionRoute({
			view: {
				generation: 1,
				mode: 'active',
				route: { kind: 'expense', pathname: '/expenses/new' },
				form: undefined,
				newTags: doc
			},
			pathname: '/expenses/new',
			observation: {
				...facts,
				tags: [
					{
						id: tagId,
						organizationId: facts.organizationId ?? '',
						name,
						kind: 'expense',
						categoryId: null,
						archivedAt: null
					}
				]
			}
		})
	)
	expect(view.newTags.items).toEqual([{ id: 1000, name: name.slice(0, 4096) }])
	expect(view.newTags.page).toEqual({ offset: 1000, total: 1001, hasMore: false })
	expect(view.tagChoices).toEqual([{ id: tagId, name: name.slice(0, 4096) }])
	expect(doc.items[1000]?.name).toBe(name)
	expect(structuredClone(view)).toEqual(view)
})
