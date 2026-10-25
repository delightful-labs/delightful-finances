---
description: 'Dependency-ordered implementation tasks for internal transfer linking'
---

# Tasks: Link Internal Transfers

**Input**: Design documents from `/specs/010-transfer-linking/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `quickstart.md`

**Tests**: No test tasks are included before the implementation has been shown to and approved by the user. At each review, identify affected unit and Playwright coverage. Update and run only the relevant tests after that approval.

**Organization**: Tasks follow the three user stories; shared schema and authorization are foundational.

## Phase 1: Setup

**Purpose**: Existing project and tooling are already established.

No setup tasks.

---

## Phase 2: Foundational Relationship and Authorization

**Purpose**: Establish the persisted pair and enforce cross-account authorization before any UI can create or reveal one.

- [ ] T001 Add the workspace-scoped `internalTransfers` table and policy-checkable endpoint account, amount, and currency facts in `src/lib/schema/transactions.ts`, the optional `canDelete` capability in `src/lib/schema/accounts.ts`, expose the transfer row type in `src/lib/schema.ts`, and add the workspace reverse relation in `src/lib/schema/identity.ts`.
- [ ] T002 Add additive Jazz migrations and matching schema snapshots under `src/lib/migrations/` from the current schema heads, defaulting existing account grants to no delete authority and policy facts to null; do not reset local or remote data.

**Review checkpoint**: Review the pair data model and additive migration before changing authorization or UI.

### Authorization slice

- [ ] T003 Add account permission calculations in `src/lib/domain/organization-permissions.ts` so delete authority is checked independently and existing write grants do not imply delete.
- [ ] T004 Enforce internal-transfer endpoint shape, same-workspace/different-account rules, same-currency/equal-amount rules, one-pair-per-transaction, both-account write access for mutations, both-account read access for relationship details, and per-endpoint delete authorization in `src/lib/permissions.ts`.
- [ ] T005 Add administrator-facing management for workspace members' account delete grants, independent of read/write access, in `src/routes/accounts/+page.svelte` and `src/lib/components/AccountList.svelte`, with localized labels in `messages/en.json` and current account archive behavior preserved.

**Review checkpoint**: Direct Jazz reads and writes cannot create an invalid or privacy-leaking transfer relationship; administrators can assign delete authority independently of write authority.

---

## Phase 3: User Story 1 - Find and Link a Matching Movement (Priority: P1)

**Goal**: Suggest eligible existing opposite-direction transactions and atomically link the user's selection.

**Independent Test**: Two equal, opposite-direction transactions in different accounts of one workspace appear as a suggestion within seven days; confirming preserves both rows and creates no duplicate movement.

### Implementation

- [ ] T006 [P] [US1] Implement pure counterpart eligibility and deterministic ordering in `src/lib/domain/internal-transfer.ts`: opposite kind, different account, same workspace, exact amount and currency, seven-day inclusive date range, and unlinked endpoints.
- [ ] T007 [US1] Implement a machine-first link workflow in `src/lib/machines/internal-transfer.ts` using an exclusive Jazz transaction to read both current endpoints, recheck authority and compatibility, stage the relationship atomically, await authoritative settlement, and report success, cancellation, denial, or failure.
- [ ] T008 [US1] Add active-workspace transfer and counterpart observations plus actor binding and shutdown to `src/lib/components/TransactionEditEntry.svelte`; keep Jazz subscriptions and lifecycle wiring in this integration component.
- [ ] T009 [US1] Add the props-only suggestion list in `src/lib/components/InternalTransferSuggestions.svelte` and connect its selection and confirmation callbacks through `src/lib/components/TransactionForm.svelte`.
- [ ] T010 [P] [US1] Add localized transfer suggestion, empty state, confirmation, and result messages in `messages/en.json` and compile Paraglide after implementation review.

**Checkpoint**: A user can link an eligible imported or manual transaction without creating or mutating either movement.

---

## Phase 4: User Story 2 - Record Both Sides Together (Priority: P1)

**Goal**: Let a user create a manual expense and income and their relationship with one submission and one user-visible completion.

**Independent Test**: Submit a paired transfer between two writable accounts. Verify exactly two account entries and one relationship are accepted together; pending or rejected settlement never reports a completed transfer.

### Implementation

- [ ] T011 [US2] Implement an `internal-transfer-create` statechart that owns account reads, workspace/currency/authority decisions, transaction and relationship staging, authoritative settlement, rollback, cancellation, and typed outcomes. Promise actors perform leaf reads/writes only.
- [ ] T012 [US2] Add a focused paired-transfer integration component and `/transfers/new` route that own Jazz observations and actor lifecycle, and collect source account, destination account, amount, and shared date for one submission.
- [ ] T013 [US2] Add a props-only paired-transfer form using existing transaction form conventions, with clear source/destination account inputs and one completion/error result.
- [ ] T014 [US2] Add localized paired-creation labels, validation, pending, success, and failure messages in `messages/en.json` and compile Paraglide after implementation review.

**Checkpoint**: A user can record a transfer between manually maintained accounts with one submission, and no one-sided completed transfer can result.

---

## Phase 5: User Story 3 - See Correct Totals for Linked Movements (Priority: P1)

**Goal**: Keep linked movements in account histories while excluding them from workspace expense and category totals.

**Independent Test**: A linked expense appears in the source account's transactions but is excluded from the overview total and category breakdown; unlinking restores its contribution.

### Implementation

- [ ] T015 [US3] Observe readable internal-transfer rows for the active workspace and selected accounts in `src/routes/+page.svelte`, preserving current account filters and loading/error feedback.
- [ ] T016 [US3] Filter linked expense IDs from period totals, category slices, and visible expense rows in `src/lib/components/ExpenseOverview.svelte`; leave `src/lib/components/TransactionView.svelte` and account balance/history semantics intact.

**Checkpoint**: Workspace totals exclude linked movements and account transaction history still includes both sides.

---

## Phase 6: User Story 4 - Safely Manage a Transfer Link (Priority: P1)

**Goal**: Preserve pairing invariants during edits, provide explicit unlink, and require correct per-account authority for linked deletion.

**Independent Test**: Non-pairing edits preserve the link; invalidating amount/account edits cannot persist while linked; unlink preserves both transactions; deletion follows one of the two approved choices and permission outcomes.

### Implementation

- [ ] T017 [US4] Add an exclusive unlink workflow with both-account edit checks and explicit rollback/settlement states to `src/lib/machines/internal-transfer.ts`.
- [ ] T018 [US4] Observe the selected transaction's readable internal-transfer relationship in `src/lib/components/TransactionEditEntry.svelte` and expose explicit link status and unlink callbacks through `src/lib/components/TransactionForm.svelte`.
- [ ] T019 [US4] Protect linked amount/account edits in `src/lib/machines/transaction-save.ts`; preserve compatible metadata edits and require explicit unlink before a one-sided change can invalidate the pair.
- [ ] T020 [US4] Add machine-owned exclusive delete-both and unlink-and-delete operations with separate endpoint delete checks and typed outcomes in `src/lib/machines/internal-transfer.ts`.
- [ ] T021 [US4] Add the linked-transaction deletion choices and reporting-effect explanation to `src/lib/components/TransactionDetails.svelte` and `src/lib/components/TransactionEditEntry.svelte`.
- [ ] T022 [US4] Add localized link-status, unlink, delete-choice, permission-denied, delete-grant, and totals-effect messages in `messages/en.json` and compile the catalog after implementation review.

**Checkpoint**: Link lifecycle operations cannot leave an invalid pair, reveal an inaccessible counterpart, or delete an endpoint without its own delete authority.

---

## Phase 6: Review and Cross-Cutting Work

**Purpose**: Prepare the implementation for the user's review and then complete approved verification.

- [ ] T023 Inspect the complete new actor tree and helpers for hidden orchestration, cancellation/cleanup gaps, stale observations, and permission rechecks; record findings in `specs/010-transfer-linking/tasks.md`.
- [ ] T024 Identify the affected existing unit and Playwright test files and fixtures in `specs/010-transfer-linking/tasks.md` for the implementation review; keep test-file changes and execution outside this task list.

## Dependencies and Execution Order

### Phase Dependencies

- **Setup**: No work required.
- **Foundational**: T001–T005 must finish before a relationship is queried or created. T002 follows T001. Review the data model/migration after T002. T004 follows T001 and T003; T005 follows T003 and T004. Review authorization/grant management after T005.
- **User Story 1**: Depends on the complete foundation. T006 precedes T007; T007 precedes the editor integration and presentation tasks.
- **User Story 2**: Depends on the foundation and T007; T011–T014 implement paired creation.
- **User Story 3**: Depends on T001 and T011/T014; reporting tasks T015–T016 can be reviewed independently once links exist.
- **User Story 4**: Depends on all foundation tasks and T007; T017 precedes unlink UI, and T020 precedes delete choices.
- **Review**: T023–T024 follow implementation. Test files and test execution are outside this task list.

### User Story Dependencies

- **US1**: Requires the foundational relationship table and policy.
- **US2**: Requires the relationship table and authority policy; paired creation is a separate route/actor from existing transaction linking.
- **US3**: Requires the relationship table; behavior can be reviewed independently after either US1 or US2 creates a relationship.
- **US4**: Requires US1 persistence and applies to relationships created through either linking or paired creation.

### Parallel Opportunities

- After T001, migration T002 is the first review checkpoint. Account-delete grant work T003 and transfer policy T004 are sequential after that review; grant UI T005 follows the policy.
- After T006, the pure matching helper and UI-copy review can proceed independently, but machine and editor integration remain sequential.
- Reporting work T011–T012 is independent of the link editor after the schema/policy foundation.
- No concurrent implementation is planned because the repository requires one focused review cycle at a time.

## Implementation Strategy

Deliver the relationship and policy first, then existing-transaction suggestions/linking, paired manual creation, reporting, and finally lifecycle/deletion. Each stage is a focused review checkpoint. Do not expose a persistent link or paired creation until account histories, totals, and privacy behavior are coherent. Keep all test edits and execution behind review of the production code they cover.
