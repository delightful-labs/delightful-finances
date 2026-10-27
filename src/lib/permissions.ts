import { ACCOUNT_ACCESS } from '#lib/domain/account-access.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
import { schema as s } from 'jazz-tools'
import { type RowContext, type RowRefValue } from 'jazz-tools/permissions'
import {
	app,
	type InternalTransfer,
	type OrganizationMember,
	type Tag,
	type TransactionRow
} from './schema.js'
import { checkReferenceCondition } from './check-reference-permissions.js'

type Role = NonNullable<OrganizationMember['role']>
type IdExpression = string | RowRefValue
type TransactionContext = Pick<
	RowContext<TransactionRow>,
	| 'id'
	| 'accountId'
	| 'categoryId'
	| 'organizationId'
	| 'amountMinor'
	| 'currency'
	| 'kind'
	| 'paymentMethod'
	| 'checkDetailsId'
	| 'checkId'
	| 'internalTransferId'
>
type InternalTransferContext = Pick<
	RowContext<InternalTransfer>,
	| 'id'
	| 'organizationId'
	| 'expenseTransactionId'
	| 'incomeTransactionId'
	| 'expenseAccountId'
	| 'incomeAccountId'
	| 'expenseAmountMinor'
	| 'expenseCurrency'
	| 'incomeAmountMinor'
	| 'incomeCurrency'
	| 'amountMinor'
	| 'currency'
>

export default s.definePermissions(app, ({ policy, session, anyOf, allOf, allowedTo }) => {
	const isMember = (organizationId: IdExpression) =>
		policy.organizationMembers.exists.where({ organizationId, userId: session.user.account })

	const hasRole = (organizationId: IdExpression, role: Role) =>
		policy.organizationMembers.exists.where({ organizationId, userId: session.user.account, role })

	const isAdmin = (organizationId: IdExpression) =>
		anyOf([
			hasRole(organizationId, ORGANIZATION_ROLE.OWNER),
			hasRole(organizationId, ORGANIZATION_ROLE.ADMIN)
		])

	const canReadAllAccounts = (organizationId: IdExpression) =>
		anyOf([
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user.account,
				role: ORGANIZATION_ROLE.MEMBER,
				accountAccessMode: ACCOUNT_ACCESS.ALL
			}),
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user.account,
				role: ORGANIZATION_ROLE.VIEWER,
				accountAccessMode: ACCOUNT_ACCESS.ALL
			})
		])

	const canWriteAllAccounts = (organizationId: IdExpression) =>
		anyOf([
			hasRole(organizationId, ORGANIZATION_ROLE.OWNER),
			hasRole(organizationId, ORGANIZATION_ROLE.ADMIN),
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user.account,
				role: ORGANIZATION_ROLE.MEMBER,
				accountAccessMode: ACCOUNT_ACCESS.ALL
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
				hasRole(organizationId, ORGANIZATION_ROLE.MEMBER),
				policy.organizationMembers.exists.where({
					organizationId,
					userId: session.user.account,
					accountAccessMode: ACCOUNT_ACCESS.SELECTED
				}),
				policy.accountMemberships.exists.where({
					organizationId,
					accountId,
					userId: session.user.account,
					access: 'write'
				})
			])
		])

	const canDeleteAccount = (accountId: IdExpression, organizationId: IdExpression) =>
		anyOf([
			isAdmin(organizationId),
			allOf([
				hasRole(organizationId, ORGANIZATION_ROLE.MEMBER),
				policy.organizationMembers.exists.where({
					organizationId,
					userId: session.user.account,
					accountAccessMode: ACCOUNT_ACCESS.SELECTED
				}),
				policy.accountMemberships.exists.where({
					organizationId,
					accountId,
					userId: session.user.account,
					canDelete: true
				})
			])
		])

	const canWriteTransferAccounts = (transfer: InternalTransferContext) =>
		anyOf([
			canWriteAllAccounts(transfer.organizationId),
			allOf([
				policy.organizationMembers.exists.where({
					organizationId: transfer.organizationId,
					userId: session.user.account,
					role: ORGANIZATION_ROLE.MEMBER,
					accountAccessMode: ACCOUNT_ACCESS.SELECTED
				}),
				policy.accountMemberships.exists.where({
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					userId: session.user.account,
					access: 'write'
				}),
				policy.accountMemberships.exists.where({
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
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
			{ checkDetailsId: { isNull: true } },
			checkReferenceCondition({
				transaction,
				checkExists: (where) => policy.checks.exists.where(where)
			})
		])

	const transferEndpointFactsMatch = (transfer: InternalTransferContext) =>
		allOf([
			anyOf([
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.expenseAmountMinor,
					currency: transfer.expenseCurrency,
					internalTransferId: transfer.id
				}),
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: transfer.id
				})
			]),
			anyOf([
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.incomeAmountMinor,
					currency: transfer.incomeCurrency,
					internalTransferId: transfer.id
				}),
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: transfer.id
				})
			])
		])

	const transferEndpointsAreUnlinked = (transfer: InternalTransferContext) =>
		allOf([
			policy.transactions.exists.where({
				id: transfer.expenseTransactionId,
				organizationId: transfer.organizationId,
				internalTransferId: { isNull: true }
			}),
			policy.transactions.exists.where({
				id: transfer.incomeTransactionId,
				organizationId: transfer.organizationId,
				internalTransferId: { isNull: true }
			})
		])

	const transferEndpointsHaveMarkers = (transfer: InternalTransferContext) =>
		allOf([
			anyOf([
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.expenseAmountMinor,
					currency: transfer.expenseCurrency,
					internalTransferId: { isNull: false }
				}),
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: { isNull: false }
				})
			]),
			anyOf([
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.incomeAmountMinor,
					currency: transfer.incomeCurrency,
					internalTransferId: { isNull: false }
				}),
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: { isNull: false }
				})
			])
		])

	const transactionTransferRelationshipExists = (transaction: TransactionContext) =>
		anyOf([
			policy.internalTransfers.exists.where({
				id: transaction.internalTransferId,
				organizationId: transaction.organizationId,
				expenseTransactionId: transaction.id,
				expenseAccountId: transaction.accountId
			}),
			policy.internalTransfers.exists.where({
				id: transaction.internalTransferId,
				organizationId: transaction.organizationId,
				incomeTransactionId: transaction.id,
				incomeAccountId: transaction.accountId
			})
		])

	const transactionFinancialFactsAreUnchanged = (transaction: TransactionContext) =>
		policy.transactions.exists.where({
			id: transaction.id,
			organizationId: transaction.organizationId,
			accountId: transaction.accountId,
			kind: transaction.kind,
			amountMinor: transaction.amountMinor,
			currency: transaction.currency
		})

	const transactionTransferUpdateIsValid = (transaction: TransactionContext) =>
		anyOf([
			allOf([
				transactionHasNoTransfer(),
				anyOf([
					policy.transactions.exists.where({
						id: transaction.id,
						internalTransferId: { isNull: true }
					}),
					allOf([
						policy.transactions.exists.where({
							id: transaction.id,
							internalTransferId: { isNull: false }
						}),
						transactionFinancialFactsAreUnchanged(transaction)
					])
				])
			]),
			allOf([
				transactionTransferRelationshipExists(transaction),
				transactionFinancialFactsAreUnchanged(transaction)
			])
		])

	const transactionHasNoTransfer = () => ({ internalTransferId: { isNull: true } })

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
				{ userId: session.user.account, role: ORGANIZATION_ROLE.OWNER },
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
		anyOf([
			isAdmin(category.organizationId),
			hasRole(category.organizationId, ORGANIZATION_ROLE.MEMBER)
		])
	)
	policy.categories.allowUpdate
		.whereOld((category) =>
			allOf([
				anyOf([
					isAdmin(category.organizationId),
					hasRole(category.organizationId, ORGANIZATION_ROLE.MEMBER)
				]),
				{ isSystem: false }
			])
		)
		.whereNew((category) =>
			allOf([
				anyOf([
					isAdmin(category.organizationId),
					hasRole(category.organizationId, ORGANIZATION_ROLE.MEMBER)
				]),
				{ isSystem: false }
			])
		)
	policy.categories.allowDelete.where((category) =>
		allOf([isAdmin(category.organizationId), { isSystem: false }])
	)

	const tagReferencesAreValid = (tag: RowContext<Tag>) =>
		allOf([
			anyOf([{ kind: EXPENSE }, { kind: INCOME }]),
			anyOf([
				{ categoryId: { isNull: true } },
				policy.categories.exists.where({
					id: tag.categoryId,
					organizationId: tag.organizationId,
					kind: tag.kind
				})
			])
		])

	policy.tags.allowRead.where((tag) => isMember(tag.organizationId))
	policy.tags.allowInsert.where((tag) =>
		allOf([
			anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, ORGANIZATION_ROLE.MEMBER)]),
			tagReferencesAreValid(tag)
		])
	)
	policy.tags.allowUpdate
		.whereOld((tag) =>
			anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, ORGANIZATION_ROLE.MEMBER)])
		)
		.whereNew((tag) =>
			allOf([
				anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, ORGANIZATION_ROLE.MEMBER)]),
				tagReferencesAreValid(tag),
				// Kind and workspace are immutable so existing assignments stay compatible.
				policy.tags.exists.where({
					id: tag.id,
					organizationId: tag.organizationId,
					kind: tag.kind
				})
			])
		)
	policy.tags.allowDelete.where((tag) => isAdmin(tag.organizationId))

	policy.transactions.allowRead.where((transaction) =>
		canReadAccount(transaction.accountId, transaction.organizationId)
	)
	policy.transactions.allowInsert.where((transaction) =>
		allOf([
			canWriteTransaction(transaction),
			anyOf([transactionHasNoTransfer(), transactionTransferRelationshipExists(transaction)])
		])
	)
	policy.transactions.allowUpdate
		.whereOld((transaction) => canWriteAccount(transaction.accountId, transaction.organizationId))
		.whereNew((transaction) =>
			allOf([
				canWriteTransaction(transaction),
				transactionTransferUpdateIsValid(transaction),
				// Preserve tenancy, kind and provenance so edits cannot break provider deduplication.
				policy.transactions.exists.where({
					id: transaction.id,
					organizationId: transaction.organizationId,
					kind: transaction.kind,
					source: transaction.source
				}),
				anyOf([
					allOf([
						{ externalId: { isNull: true } },
						policy.transactions.exists.where({ id: transaction.id, externalId: { isNull: true } })
					]),
					policy.transactions.exists.where({
						id: transaction.id,
						externalId: transaction.externalId
					})
				])
			])
		)
	policy.transactions.allowDelete.where((transaction) =>
		allOf([
			canDeleteAccount(transaction.accountId, transaction.organizationId),
			transactionHasNoTransfer()
		])
	)

	policy.internalTransfers.allowRead.where((transfer) =>
		allOf([
			allowedTo.read('expenseTransaction'),
			allowedTo.read('incomeTransaction'),
			anyOf([
				transferEndpointFactsMatch(transfer),
				transferEndpointsAreUnlinked(transfer),
				transferEndpointsHaveMarkers(transfer)
			])
		])
	)
	policy.internalTransfers.allowInsert.where((transfer) =>
		allOf([
			transferEndpointFactsMatch(transfer),
			canWriteAccount(transfer.expenseAccountId, transfer.organizationId),
			canWriteAccount(transfer.incomeAccountId, transfer.organizationId)
		])
	)
	policy.internalTransfers.allowUpdate.never()
	policy.internalTransfers.allowDelete.where((transfer) => canWriteTransferAccounts(transfer))

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
			anyOf(
				([EXPENSE, INCOME] satisfies readonly TransactionRow['kind'][]).map((kind) =>
					allOf([
						policy.transactions.exists.where({
							id: link.transactionId,
							organizationId: link.organizationId,
							kind
						}),
						policy.tags.exists.where({
							id: link.tagId,
							organizationId: link.organizationId,
							kind,
							archivedAt: { isNull: true }
						})
					])
				)
			)
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

	policy.checks.allowRead.where((check) => canReadAccount(check.accountId, check.organizationId))
	policy.checks.allowInsert.where((check) =>
		allOf([
			canWriteAccount(check.accountId, check.organizationId),
			policy.accounts.exists.where({
				id: check.accountId,
				organizationId: check.organizationId,
				archivedAt: { isNull: true }
			})
		])
	)
	policy.checks.allowUpdate
		.whereOld((check) => canWriteAccount(check.accountId, check.organizationId))
		.whereNew((check) =>
			allOf([
				canWriteAccount(check.accountId, check.organizationId),
				policy.accounts.exists.where({
					id: check.accountId,
					organizationId: check.organizationId,
					archivedAt: { isNull: true }
				}),
				// Moving a Check requires write access to both accounts and preserves its organization.
				policy.checks.exists.where({
					id: check.id,
					organizationId: check.organizationId
				})
			])
		)
	policy.checks.allowDelete.never()

	// Retired embedded details cannot be read or mutated by production clients.
	policy.checkDetails.allowRead.never()
	policy.checkDetails.allowInsert.never()
	policy.checkDetails.allowUpdate.never()
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
