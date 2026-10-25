# Feature Specification: Link Internal Transfers

**Feature Branch**: `feat/transfer-suggestions`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "I want to work on the transfers feature. We already have some in the specs for basic decisions about this. Something that I noticed now that I am working with synced transactions, I have credit card payments that come from one account and then apply to another. It would be nice to do a search for the same amount from the other direction and show it as a suggested transaction (i.e. I want to convert an expense transaction to a transfer, it will show me income transactions within a reasonable time frame that I can connect to)."

This feature implements the approved transfer foundation in [001-finance-mvp](../001-finance-mvp/spec.md#approved-transfer-foundation-future-functionality), supporting both opposite-side suggestions for existing transactions and creating both sides in one user action. It does not introduce a third transaction kind. The legacy `transfer` payment-method value alone does not create a transfer relationship.

## User Scenarios & Testing

### User Story 1 - Find and link a matching movement (Priority: P1)

When a user edits an expense or income, they can mark it as an internal transfer and see eligible opposite-direction transactions that may be its other side. This makes synced credit-card payments and other movements between the user's accounts straightforward to reconcile.

**Why this priority**: Linking the two already-synced entries is the central user need and avoids creating duplicate movements.

**Independent Test**: Start with two unlinked, equal-amount, opposite-direction transactions in different accounts of the same workspace. Open one transaction, choose the other as its counterpart, and verify both retain their existing identities and details while becoming a linked transfer.

**Acceptance Scenarios**:

1. **Given** an unlinked expense and income of the same amount and currency in different accounts of the same workspace, dated within seven calendar days of each other, **When** the user starts linking either transaction as a transfer, **Then** the other is shown as a suggested counterpart.
2. **Given** multiple eligible counterpart transactions, **When** suggestions are shown, **Then** each candidate identifies its date, account, description when present, and amount, and the user can select one.
3. **Given** a selected compatible counterpart and edit access to both accounts, **When** the user confirms linking, **Then** the two existing transactions are linked without changing their IDs, source identities, amounts, dates, categories, descriptions, memos, tags, checks, or attachments.
4. **Given** an amount, currency, direction, date, account, workspace, or link-state mismatch, **When** candidates are calculated, **Then** that transaction is not suggested.
5. **Given** no eligible counterpart, **When** the user starts linking, **Then** the user is told there are no suggestions and can leave the transaction unlinked.
6. **Given** two devices attempt to link the same transaction to different counterparts, **When** both operations settle, **Then** at most one link is accepted and the rejected attempt is reported accurately.
7. **Given** the Jazz authority is unavailable, **When** the user views suggestions, **Then** suggestions remain available but no link is reported complete before authoritative acceptance.

### User Story 2 - Record both sides together (Priority: P1)

When a user moves money between two accounts that are not represented by a matching pair of synced transactions, they can record the outgoing expense and incoming income together as one transfer action. The app stores two ordinary account transactions and their relationship, and presents one completion result.

**Why this priority**: Transfers between manually maintained accounts need the same reporting and account-history behavior without requiring the user to enter each side separately.

**Independent Test**: Select two different accounts in one workspace and enter a transfer amount. Submit once and verify one expense, one income, and one relationship are persisted; both appear in their account histories and neither affects workspace income or expense totals.

**Acceptance Scenarios**:

1. **Given** two writable accounts in the same workspace, **When** the user records a transfer and submits once, **Then** one expense and one income with equal amount and currency and a shared date are created and linked, and the user sees one completion result.
2. **Given** the paired write is pending or rejected by the Jazz authority, **When** the user submits, **Then** the UI does not report success until the pair is accepted and reports rejection without leaving a one-sided completed transfer.
3. **Given** the selected accounts are the same, in different workspaces, or not both writable, **When** the user submits, **Then** the operation is rejected and no transfer is created.
4. **Given** a transfer created together, **When** the user views account histories and workspace totals, **Then** both entries remain in their respective account histories and are excluded from workspace income and expense totals.

### User Story 3 - See correct totals for linked movements (Priority: P1)

Users see each side in its account history and balance, while workspace income and expense totals exclude both sides by default.

**Why this priority**: A link is only useful if it prevents internal movements from being counted as income or spending while retaining account-level history.

**Independent Test**: Link an expense and income and verify their account histories and balances include the movements while workspace totals, including categorized totals, exclude them. Unlink them and verify they return to ordinary income and expense totals.

**Acceptance Scenarios**:

1. **Given** a linked transfer, **When** the user views either account history or balance, **Then** that account's transaction remains present and affects its balance.
2. **Given** a linked transfer, **When** workspace income or expense totals are calculated, **Then** neither side contributes to totals by default, including categorized totals.
3. **Given** a linked transfer, **When** either side is unlinked, **Then** both transactions remain and contribute to their ordinary income or expense totals.

### User Story 4 - Safely manage a transfer link (Priority: P1)

Users can unlink a pair and can edit ordinary transaction details without accidentally breaking the pairing. Changes that make a pair incompatible are handled together or require explicit unlinking.

**Why this priority**: Transfer links must remain financially consistent as synced records change over time.

**Independent Test**: Link a pair, edit non-pairing details, then attempt an incompatible amount/account change and unlink the pair. Verify the link is preserved for compatible edits and cannot be left invalid.

**Acceptance Scenarios**:

1. **Given** a linked pair, **When** a user changes dates, descriptions, categories, or tags, **Then** the link remains.
2. **Given** a linked pair, **When** a user changes one side's amount, account, or currency so the pairing rules fail, **Then** the change cannot leave an invalid pair; the user must update both sides consistently or explicitly unlink.
3. **Given** a linked pair, **When** the user explicitly unlinks it, **Then** both entries remain as ordinary transactions and regain their normal total treatment.
4. **Given** a linked transaction is deleted, **When** deletion choices are presented, **Then** the user can choose to delete both sides or unlink and delete only the selected side, and the effect on totals is explained before proceeding.
5. **Given** an account grant, **When** an administrator manages it, **Then** delete authority can be granted or revoked separately from read and write authority.

### Edge Cases

- Equal amounts with different currencies are not suggested; matching does not imply currency conversion.
- Equal same-currency amounts on the same account are not a transfer candidate.
- Transactions in another workspace are never suggested, even when their owner is the same person.
- Already linked transactions are not suggested as new counterparts.
- A candidate the user cannot read is never exposed; linking requires edit permission for both accounts.
- If access to either account changes before linking is saved, the relationship is not created.
- If the Jazz authority cannot validate a link or unlink, the app does not report it as complete; the editor shows pending or failure feedback until the authority accepts or rejects the change.
- A transfer fee remains a separate ordinary expense and is not linked as an unequal third movement.
- The existing `transfer` payment method without a counterpart link remains an ordinary transaction for reporting.
- Imported counterpart transactions retain their provider identity and are not duplicated.

## Requirements

### Functional Requirements

- **FR-001**: Users MUST be able to link two existing transactions in different accounts of the same workspace as one internal transfer: one expense and one income.
- **FR-001a**: Users MUST be able to create both sides of an internal transfer in one user action. The system MUST persist one expense, one income, and their relationship as one authoritative operation; the UI MUST report one completion result and MUST NOT report success while only one side is accepted.
- **FR-002**: This feature MUST link only same-currency transactions with equal amounts in minor units. Cross-currency transfer linking remains deferred; the app MUST NOT calculate a conversion.
- **FR-003**: Each linked side MUST retain its own business date, account currency, and account history entry.
- **FR-004**: When a user chooses to link a transaction, the system MUST suggest unlinked transactions in the same workspace that have the opposite direction, a different account, the same currency and amount, and a date no more than seven calendar days before or after the current transaction.
- **FR-005**: Suggestions MUST include only transactions readable by the user. Creating, changing, or removing a link MUST require edit permission for both accounts.
- **FR-006**: Linking MUST preserve both transaction IDs, provider source/external identity, and all existing transaction information and relationships; it MUST NOT create duplicate movements.
- **FR-007**: A linked transfer MUST remain visible in each account history and affect each account balance. Both sides MUST be excluded from workspace income and expense totals by default, including categorized totals.
- **FR-008**: Changes to dates, descriptions, categories, or tags MUST preserve a link. Amount, account, or currency changes MUST preserve the pairing rules; users MUST update both sides consistently or explicitly unlink.
- **FR-009**: Users MUST be able to unlink a pair while retaining both entries as ordinary transactions, which then count toward applicable totals.
- **FR-010**: Deleting a linked transaction MUST require an explicit choice to delete both sides, with delete permission for both, or unlink and delete only the selected side, with delete permission for that side. The effect on totals MUST be explained before proceeding.
- **FR-011**: A user who can read only one account MUST NOT learn details about a hidden counterpart through a transfer relationship.
- **FR-012**: A transaction's `transfer` payment-method value alone MUST NOT establish a link or change reporting totals.
- **FR-013**: Transactions across workspaces and movements to or from external accounts MUST remain ordinary income or expense entries.
- **FR-014**: The system MUST validate link and unlink operations against an authoritative, serializable view before reporting success, so concurrent attempts cannot link one transaction to multiple counterparts. Suggestions MAY remain visible from local data while offline, but a link MUST NOT be reported complete until accepted.
- **FR-015**: Administrators MUST be able to grant or revoke account-level delete authority separately from read and write access. Existing write access MUST NOT imply delete authority.

### Key Entities

- **Transaction**: An existing account movement with a direction, amount, currency, date, source, and user-entered details.
- **Internal transfer**: A relationship between one expense and one income in different accounts of the same workspace. The relationship does not replace or duplicate either transaction.
- **Suggested counterpart**: An unlinked, readable, opposite-direction transaction matching account, currency, amount, and date-window eligibility rules.
- **Account grant**: A user's account-specific access, including delete authority that is independent of write access.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For a transaction with one or more eligible opposite-side entries, users can see those suggestions while editing the transaction without manually searching unrelated workspaces or accounts.
- **SC-002**: Linking two eligible existing transactions changes no transaction IDs or movement amounts and creates no additional transaction entries.
- **SC-002a**: Recording a transfer between manually maintained accounts requires one user submission and produces exactly two account-history entries, one relationship, and one completion result.
- **SC-003**: All linked transfer sides are absent from default workspace income and expense totals, and both are present again after unlinking.
- **SC-004**: No user can create or change a transfer link without edit access to both involved accounts.

## Assumptions

- The initial matching window is seven calendar days on either side of the transaction date. This is a product default for the first implementation and can be revised after using the feature.
- Suggestions and links in this iteration match the full amount and currency exactly. Cross-currency linking remains deferred; no automatic conversion is permitted.
- Link and unlink operations require an available Jazz authority for the concurrency check; local suggestions remain available offline, and the UI communicates unsettled or rejected operations accurately.
- Existing-transaction linking supports imported and manual records. Paired creation creates two ordinary manual transactions with the same amount, currency, date, and user-entered description, then links them as one transfer action.
- Existing approved transfer requirements in `001-finance-mvp` remain authoritative for deletion, authorization, reporting, workspace boundaries, fees, and currency behavior.
