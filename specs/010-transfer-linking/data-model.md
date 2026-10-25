# Data Model: Link Internal Transfers

## InternalTransfer

Represents a single relationship between one expense and one income transaction. The transactions may predate the relationship (when linking synced or manually entered entries) or be created in the same user action as the relationship.

| Field                  | Required | Rule                                           |
| ---------------------- | -------- | ---------------------------------------------- |
| `organizationId`       | Yes      | Same workspace as both referenced transactions |
| `expenseTransactionId` | Yes      | References an expense transaction              |
| `incomeTransactionId`  | Yes      | References an income transaction               |
| `expenseAccountId`     | Policy   | Snapshot of the expense transaction's account  |
| `incomeAccountId`      | Policy   | Snapshot of the income transaction's account   |
| `amountMinor`          | Policy   | Shared amount in integer minor units           |
| `currency`             | Policy   | Shared ISO 4217 currency                       |

The four policy-fact fields are nullable in the structural schema only to support the additive
migration. New relationships must populate them. Jazz permissions compare each endpoint against
these stored facts; rows missing any fact fail closed and cannot be read, changed, or deleted through
the transfer policy. The application remains responsible for supplying the facts from both current
endpoints inside the exclusive transaction.

### Invariants

- Both references exist and belong to `organizationId` when the relationship is committed. Paired creation stages both transaction rows and this relationship in the same authoritative operation; the relationship does not require that the rows existed before the user's action.
- The expense and income are in different accounts.
- Both endpoints have the same currency and equal amounts in minor units. Cross-currency links are deferred from this feature.
- The stored account, amount, and currency facts must match both endpoints; account IDs must differ. These facts cannot be updated after linking.
- A transaction may belong to at most one internal transfer.
- Linking and unlinking use exclusive transactions so the authority validates the stable endpoint and relationship reads against concurrent writes.
- A transfer record is readable only when both endpoints are readable. Creating or removing a link requires write access to both endpoints.
- Deleting one endpoint must resolve the relationship in the same atomic workflow. Delete-both requires delete permission for both; unlink-and-delete requires delete permission for the selected endpoint and write permission for both endpoints to unlink.

## Transaction (existing)

Linking existing entries does not alter transaction values. Paired creation creates two distinct ordinary rows: one expense and one income, with equal amount, currency, and date, separate account IDs, and no provider identity. The relationship does not replace either row. Existing `paymentMethod: transfer` does not represent this relationship.

## AccountMembership (existing, extended)

Add a distinct account-level delete capability. Existing read/write semantics remain; write permission does not imply delete permission. Administrators can grant or revoke delete authority independently. Workspace owner/admin authority follows existing role policy. Existing grants migrate with deletion disabled unless existing role policy grants administrative authority.

## Suggested Counterpart (derived)

Not persisted. Candidate rows are current-workspace transactions satisfying all of the following: opposite kind; different account; equal currency and amount; within seven calendar days on either side; and not referenced by an internal transfer. Only readable transaction rows are presented.
