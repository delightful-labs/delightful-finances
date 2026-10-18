import { providerAccountIdentity } from '#lib/integrations/simplefin.js'
import type { AccountMergeMappingInput } from '#lib/schema/account-merge-mapping.js'

export const id = (value: number) =>
	`00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`
export const providerId = JSON.stringify([
	providerAccountIdentity({
		id: 'checking',
		name: 'Checking',
		currency: 'USD',
		org: { 'sfin-url': 'https://bank.example', domain: 'bank.example' }
	}),
	'provider-transaction'
])
export function fixture(): AccountMergeMappingInput {
	const scope = { organizationId: id(2) }
	const expense = {
		...scope,
		id: id(9),
		accountId: id(5),
		categoryId: id(6),
		amountMinor: 1234,
		currency: 'USD',
		kind: 'expense',
		bookedOn: '2026-10-17',
		memo: 'Unchanged memo',
		paymentMethod: null,
		checkDetailsId: null,
		source: 'manual',
		externalId: null,
		batchId: id(13)
	} satisfies AccountMergeMappingInput['snapshot']['transactions'][number]
	return {
		destination: { identityId: id(3), organizationId: id(4) },
		categories: [
			{ id: id(20), organizationId: id(4), kind: 'expense', isSystem: true, archivedAt: null }
		],
		snapshot: {
			version: 1,
			sourceIdentityId: id(1),
			sourceOrganization: {
				id: id(2),
				ownerId: id(1),
				kind: 'personal',
				name: 'Personal',
				defaultCurrency: 'USD'
			},
			accounts: [id(5), id(18)].map((recordId) => ({
				...scope,
				id: recordId,
				name: 'Same account name',
				kind: 'bank',
				currency: 'USD',
				archivedAt: '2026-10-16T00:00:00Z'
			})),
			categories: [
				{
					...scope,
					id: id(6),
					name: 'Uncategorized',
					kind: 'expense',
					isSystem: true,
					archivedAt: null
				},
				{ ...scope, id: id(7), name: 'Income', kind: 'income', isSystem: false, archivedAt: null }
			],
			tags: [{ ...scope, id: id(8), name: 'Tag', categoryId: id(6), archivedAt: null }],
			transactions: [
				expense,
				{ ...expense, id: id(17) },
				{
					...expense,
					id: id(10),
					categoryId: id(7),
					kind: 'income',
					paymentMethod: 'check',
					checkDetailsId: id(11)
				},
				{ ...expense, id: id(12), source: 'simplefin', externalId: providerId }
			],
			checkDetails: [
				{
					...scope,
					id: id(11),
					transactionId: id(10),
					accountId: id(5),
					checkNumber: '001',
					checkDate: '2026-10-17',
					payerName: null,
					bankName: null,
					memoOnCheck: null
				}
			],
			transactionTags: [{ ...scope, id: id(15), transactionId: id(9), tagId: id(8) }],
			transactionBatches: [{ ...scope, id: id(13), name: null }],
			batchTemplates: [{ ...scope, id: id(14), name: 'Template' }],
			bankAccountLinks: [
				{
					...scope,
					id: id(16),
					accountId: id(5),
					simplefinAccountId: 'checking',
					simplefinOrgId: 'bank.example'
				}
			],
			transactionAttachments: [],
			excludedConnectionCount: 1
		}
	}
}
