import { schema as s } from 'jazz-tools'
import type { RowContext, RowRefValue } from 'jazz-tools/permissions'
import { app, type OrganizationMember, type TransactionRow } from './schema.js'

type Role = NonNullable<OrganizationMember['role']>
type IdExpression = string | RowRefValue
type TransactionContext = Pick<
	RowContext<TransactionRow>,
	| 'id'
	| 'accountId'
	| 'categoryId'
	| 'organizationId'
	| 'currency'
	| 'kind'
	| 'paymentMethod'
	| 'checkDetailsId'
>

export default s.definePermissions(app, ({ policy, session, anyOf, allOf, allowedTo }) => {
	const isMember = (organizationId: IdExpression) =>
		policy.organizationMembers.exists.where({ organizationId, userId: session.user.account })

	const hasRole = (organizationId: IdExpression, role: Role) =>
		policy.organizationMembers.exists.where({ organizationId, userId: session.user.account, role })

	const isAdmin = (organizationId: IdExpression) =>
		anyOf([hasRole(organizationId, 'owner'), hasRole(organizationId, 'admin')])

	const canReadAllAccounts = (organizationId: IdExpression) =>
		anyOf([
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user.account,
				role: 'member',
				accountAccessMode: 'all'
			}),
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user.account,
				role: 'viewer',
				accountAccessMode: 'all'
			})
		])

	const canWriteAllAccounts = (organizationId: IdExpression) =>
		anyOf([
			hasRole(organizationId, 'owner'),
			hasRole(organizationId, 'admin'),
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user.account,
				role: 'member',
				accountAccessMode: 'all'
			})
		])

	const canReadAccount = (accountId: IdExpression, organizationId: IdExpression) =>
		anyOf([
			isAdmin(organizationId),
			canReadAllAccounts(organizationId),
			allOf([
				isMember(organizationId),
				policy.accountMemberships.exists.where({
					organizationId,
					accountId,
					userId: session.user.account
				})
			])
		])

	const canWriteAccount = (accountId: IdExpression, organizationId: IdExpression) =>
		anyOf([
			canWriteAllAccounts(organizationId),
			allOf([
				hasRole(organizationId, 'member'),
				policy.organizationMembers.exists.where({
					organizationId,
					userId: session.user.account,
					accountAccessMode: 'selected'
				}),
				policy.accountMemberships.exists.where({
					organizationId,
					accountId,
					userId: session.user.account,
					access: 'write'
				})
			])
		])

	const transactionReferencesAreValid = (transaction: TransactionContext) =>
		allOf([
			policy.categories.exists.where({
				id: transaction.categoryId,
				organizationId: transaction.organizationId,
				kind: transaction.kind,
				archivedAt: { isNull: true }
			}),
			policy.accounts.exists.where({
				id: transaction.accountId,
				organizationId: transaction.organizationId,
				currency: transaction.currency,
				archivedAt: { isNull: true }
			})
		])

	const canWriteTransaction = (transaction: TransactionContext) =>
		allOf([
			canWriteAccount(transaction.accountId, transaction.organizationId),
			transactionReferencesAreValid(transaction),
			anyOf([
				{ kind: 'expense', checkDetailsId: { isNull: true } },
				allOf([
					{ kind: 'income', checkDetailsId: { isNull: true } },
					anyOf([
						{ paymentMethod: { isNull: true } },
						{ paymentMethod: 'cash' },
						{ paymentMethod: 'transfer' },
						{ paymentMethod: 'electronic' }
					])
				]),
				allOf([
					{ kind: 'income', paymentMethod: 'check' },
					policy.checkDetails.exists.where({
						id: transaction.checkDetailsId,
						transactionId: transaction.id,
						organizationId: transaction.organizationId,
						accountId: transaction.accountId
					})
				])
			])
		])

	policy.organizations.allowRead.where((organization) => isMember(organization.id))
	policy.organizations.allowInsert.where({ ownerId: session.user.account })
	policy.organizations.allowUpdate
		.whereOld((organization) => isAdmin(organization.id))
		.whereNew((organization) => isAdmin(organization.id))
	policy.organizations.allowDelete.never()

	policy.organizationMembers.allowRead.where((member) =>
		anyOf([{ userId: session.user.account }, isAdmin(member.organizationId)])
	)
	policy.organizationMembers.allowInsert.where((member) =>
		anyOf([
			isAdmin(member.organizationId),
			allOf([
				{ userId: session.user.account, role: 'owner' },
				policy.organizations.exists.where({
					id: member.organizationId,
					ownerId: session.user.account
				})
			])
		])
	)
	policy.organizationMembers.allowUpdate
		.whereOld((member) => isAdmin(member.organizationId))
		.whereNew((member) => isAdmin(member.organizationId))
	policy.organizationMembers.allowDelete.where((member) =>
		anyOf([{ userId: session.user.account }, isAdmin(member.organizationId)])
	)

	policy.profiles.allowRead.where((profile) =>
		anyOf([
			{ userId: session.user.account },
			policy.exists(
				policy.organizationMembers
					.where({ profileId: profile.id })
					.join(policy.organizationMembers, {
						left: 'organizationId',
						right: 'organizationId'
					})
					.where({ userId: session.user.account })
			)
		])
	)
	policy.profiles.allowInsert.where({ userId: session.user.account })
	policy.profiles.allowUpdate
		.whereOld({ userId: session.user.account })
		.whereNew({ userId: session.user.account })
	policy.profiles.allowDelete.never()

	policy.accounts.allowRead.where((account) => canReadAccount(account.id, account.organizationId))
	policy.accounts.allowInsert.where((account) =>
		allOf([isAdmin(account.organizationId), { archivedAt: { isNull: true } }])
	)
	policy.accounts.allowUpdate
		.whereOld((account) => canWriteAccount(account.id, account.organizationId))
		.whereNew((account) => canWriteAccount(account.id, account.organizationId))
	policy.accounts.allowDelete.never()

	policy.accountMemberships.allowRead.where((grant) =>
		anyOf([{ userId: session.user.account }, isAdmin(grant.organizationId)])
	)
	policy.accountMemberships.allowInsert.where((grant) => isAdmin(grant.organizationId))
	policy.accountMemberships.allowUpdate
		.whereOld((grant) => isAdmin(grant.organizationId))
		.whereNew((grant) => isAdmin(grant.organizationId))
	policy.accountMemberships.allowDelete.where((grant) => isAdmin(grant.organizationId))

	policy.categories.allowRead.where((category) => isMember(category.organizationId))
	policy.categories.allowInsert.where((category) =>
		anyOf([isAdmin(category.organizationId), hasRole(category.organizationId, 'member')])
	)
	policy.categories.allowUpdate
		.whereOld((category) =>
			allOf([
				anyOf([isAdmin(category.organizationId), hasRole(category.organizationId, 'member')]),
				{ isSystem: false }
			])
		)
		.whereNew((category) =>
			allOf([
				anyOf([isAdmin(category.organizationId), hasRole(category.organizationId, 'member')]),
				{ isSystem: false }
			])
		)
	policy.categories.allowDelete.where((category) =>
		allOf([isAdmin(category.organizationId), { isSystem: false }])
	)

	policy.tags.allowRead.where((tag) => isMember(tag.organizationId))
	policy.tags.allowInsert.where((tag) =>
		anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, 'member')])
	)
	policy.tags.allowUpdate
		.whereOld((tag) => anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, 'member')]))
		.whereNew((tag) => anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, 'member')]))
	policy.tags.allowDelete.where((tag) => isAdmin(tag.organizationId))

	policy.transactions.allowRead.where((transaction) =>
		canReadAccount(transaction.accountId, transaction.organizationId)
	)
	policy.transactions.allowInsert.where((transaction) => canWriteTransaction(transaction))
	policy.transactions.allowUpdate
		.whereOld((transaction) => canWriteAccount(transaction.accountId, transaction.organizationId))
		.whereNew((transaction) =>
			allOf([
				canWriteTransaction(transaction),
				// A check's selected detail cannot be replaced or shared with another transaction.
				anyOf([
					allOf([
						{ checkDetailsId: { isNull: true } },
						policy.transactions.exists.where({
							id: transaction.id,
							checkDetailsId: { isNull: true }
						})
					]),
					policy.transactions.exists.where({
						id: transaction.id,
						checkDetailsId: transaction.checkDetailsId
					})
				])
			])
		)
	policy.transactions.allowDelete.where((transaction) =>
		canWriteAccount(transaction.accountId, transaction.organizationId)
	)

	policy.transactionTags.allowRead.where((link) =>
		allOf([
			allowedTo.read('transaction'),
			policy.transactions.exists.where({
				id: link.transactionId,
				organizationId: link.organizationId
			}),
			policy.tags.exists.where({ id: link.tagId, organizationId: link.organizationId })
		])
	)
	policy.transactionTags.allowInsert.where((link) =>
		allOf([
			allowedTo.update('transaction'),
			policy.transactions.exists.where({
				id: link.transactionId,
				organizationId: link.organizationId
			}),
			policy.tags.exists.where({
				id: link.tagId,
				organizationId: link.organizationId,
				archivedAt: { isNull: true }
			})
		])
	)
	// Links are immutable; replace an assignment through delete/insert.
	// Archived tags remain readable and removable from historical transactions.
	policy.transactionTags.allowDelete.where((link) =>
		allOf([
			allowedTo.update('transaction'),
			policy.transactions.exists.where({
				id: link.transactionId,
				organizationId: link.organizationId
			}),
			policy.tags.exists.where({ id: link.tagId, organizationId: link.organizationId })
		])
	)

	policy.checkDetails.allowRead.where((details) =>
		canReadAccount(details.accountId, details.organizationId)
	)
	policy.checkDetails.allowInsert.where((details) =>
		allOf([
			// The detail is written before its transaction, using the ledger's authority.
			canWriteAccount(details.accountId, details.organizationId),
			policy.accounts.exists.where({
				id: details.accountId,
				organizationId: details.organizationId,
				archivedAt: { isNull: true }
			})
		])
	)
	policy.checkDetails.allowUpdate.whereOld(allowedTo.update('transaction')).whereNew((details) =>
		allOf([
			allowedTo.update('transaction'),
			// The existing row must already belong to this transaction.
			policy.checkDetails.exists.where({
				id: details.id,
				transactionId: details.transactionId,
				organizationId: details.organizationId,
				accountId: details.accountId
			}),
			policy.transactions.exists.where({
				id: details.transactionId,
				checkDetailsId: details.id,
				organizationId: details.organizationId,
				accountId: details.accountId,
				kind: 'income',
				paymentMethod: 'check'
			})
		])
	)
	// Removing a referenced detail would leave a check transaction incomplete.
	policy.checkDetails.allowDelete.never()

	const ownsConnection = (connection: { organizationId: IdExpression; ownerId: IdExpression }) =>
		allOf([isAdmin(connection.organizationId), { ownerId: session.user.account }])
	policy.simplefinConnections.allowRead.where((connection) => isAdmin(connection.organizationId))
	policy.simplefinConnections.allowInsert.where((connection) =>
		allOf([ownsConnection(connection), { accessUrl: '' }])
	)
	policy.simplefinConnections.allowUpdate
		.whereOld((connection) => ownsConnection(connection))
		.whereNew((connection) =>
			allOf([
				ownsConnection(connection),
				{ accessUrl: '' },
				policy.simplefinConnections.exists.where({
					id: connection.id,
					organizationId: connection.organizationId,
					ownerId: connection.ownerId
				})
			])
		)
	policy.simplefinConnections.allowDelete.where((connection) => ownsConnection(connection))

	policy.simplefinAccountLinks.allowRead.where((link) => isAdmin(link.organizationId))
	const validBankMapping = (link: {
		organizationId: IdExpression
		accountId: IdExpression
		connectionId: IdExpression
	}) =>
		allOf([
			isAdmin(link.organizationId),
			policy.accounts.exists.where({
				id: link.accountId,
				organizationId: link.organizationId,
				archivedAt: { isNull: true }
			}),
			policy.simplefinConnections.exists.where({
				id: link.connectionId,
				organizationId: link.organizationId,
				status: 'active'
			})
		])
	policy.simplefinAccountLinks.allowInsert.where((link) => validBankMapping(link))
	policy.simplefinAccountLinks.allowUpdate
		.whereOld((link) => isAdmin(link.organizationId))
		.whereNew((link) => validBankMapping(link))
	policy.simplefinAccountLinks.allowDelete.where((link) => isAdmin(link.organizationId))

	policy.transactionAttachments.allowRead.where((attachment) =>
		policy.transactions.exists.where({ id: attachment.transactionId })
	)
	policy.transactionAttachments.allowInsert.where(allowedTo.update('transaction'))
	policy.transactionAttachments.allowDelete.where(allowedTo.update('transaction'))

	policy.files.allowRead.never()
	policy.files.allowInsert.never()
	policy.files.allowUpdate.never()
	policy.files.allowDelete.never()
	policy.fileParts.allowRead.never()
	policy.fileParts.allowInsert.never()
	policy.fileParts.allowUpdate.never()
	policy.fileParts.allowDelete.never()
	policy.uploads.allowRead.never()
	policy.uploads.allowInsert.never()
	policy.uploads.allowUpdate.never()
	policy.uploads.allowDelete.never()

	policy.transactionBatches.allowRead.where((batch) => isMember(batch.organizationId))
	policy.transactionBatches.allowInsert.where((batch) => canWriteAllAccounts(batch.organizationId))
	policy.transactionBatches.allowUpdate
		.whereOld((batch) => canWriteAllAccounts(batch.organizationId))
		.whereNew((batch) => canWriteAllAccounts(batch.organizationId))
	policy.transactionBatches.allowDelete.where((batch) => isAdmin(batch.organizationId))
	policy.batchTemplates.allowRead.where((template) => isMember(template.organizationId))
	policy.batchTemplates.allowInsert.where((template) =>
		canWriteAllAccounts(template.organizationId)
	)
	policy.batchTemplates.allowUpdate
		.whereOld((template) => canWriteAllAccounts(template.organizationId))
		.whereNew((template) => canWriteAllAccounts(template.organizationId))
	policy.batchTemplates.allowDelete.where((template) => isAdmin(template.organizationId))
})
