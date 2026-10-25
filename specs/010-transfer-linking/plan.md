# Implementation Plan: Link Internal Transfers

**Branch**: `feat/transfer-suggestions` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

## Summary

Implement internal transfers as a permission-protected relationship between an expense and income transaction. The transaction editor suggests exact opposite-side matches from another account within seven days; a separate paired-entry flow creates both sides for manually maintained accounts in one user action. Both flows persist two ordinary transaction rows and their relationship atomically, exclude linked entries from workspace totals, and provide explicit unlink and deletion choices. The schema must retain each movement and all imported transaction provenance.

## Technical Context

**Language/Version**: TypeScript 6, Svelte 5
**Primary Dependencies**: SvelteKit 3, Jazz Tools 2.0.0-alpha.59, XState 5, Paraglide JS
**Storage**: Jazz local-first replicated workspace database; link invariants use exclusive authoritative transactions
**Testing**: Vitest and Playwright; implementation tests remain behind the user's code review gate
**Target Platform**: Responsive browser/PWA with offline-capable local reads and writes
**Project Type**: SvelteKit web application
**Performance Goals**: Candidate suggestions are computed from the active workspace's locally available transactions without a network wait
**Constraints**: Integer minor-unit matching, no currency conversion, workspace and account authorization, no `switch`/`case`, machine-first async workflows, localized text, additive migration (no data reset), small review batches, no tests before implementation review. Suggestions can be read offline, but link/unlink success requires authoritative acceptance.
**Scale/Scope**: Existing-transaction matching plus one-action paired creation; one expense plus one income in different accounts of one workspace; seven calendar days for matching; linked entries remain in both account histories

## Constitution Check

- **Local-first and financial integrity**: Pass. Candidate matching uses replicated local records; links preserve both transaction rows and their account-specific amounts/currencies/dates.
- **Access and privacy**: Pass with a new transfer relationship policy. Creating, changing, or removing a relationship requires edit access to both accounts. The relationship and counterpart details are readable only when both transactions are readable.
- **Machine-first workflows**: Pass. Link, unlink, and linked deletion are separate statechart workflows that own reads, eligibility decisions, atomic staging, commit settlement, rollback, cancellation, and failure results. Promise actors perform leaf operations only.
- **Integration ownership**: Pass. `TransactionEditEntry` owns Jazz subscriptions and actor binding. Presentation components receive data and callbacks.
- **Localization and presentation**: Pass. New text follows `.specify/memory/localization.md`; no decorative UI is introduced.
- **Migration and testing gates**: Pass. Add a migration from the current schema hash; do not reset data. Identify affected tests during review, then edit/run them only after approval.
- **Batch size**: Pass. Deliver schema/permissions, linking/matching UI, reporting, and lifecycle in separate focused review cycles of 4–6 implementation files.

## Design Decisions

1. Add an `internalTransfers` record containing the workspace and expense/income transaction references, plus immutable account, amount, and currency facts used by Jazz policy checks. Paired creation stages two ordinary transaction rows and this relationship in one authoritative operation. No third transaction is created and no existing transaction is rewritten to encode transfer status. This feature supports same-currency equal-amount pairs; cross-currency links remain deferred.
2. Enforce the pair shape and both-account authority in the Jazz policy as well as the application workflow. Jazz policy checks each endpoint against the relationship's immutable facts because its permission DSL cannot directly compare two sibling transaction rows. Read access to a transfer record requires read access to both endpoint transactions, so a user with one-account access sees their ordinary transaction without counterpart details.
3. Match exact `amountMinor` and currency, opposite kinds, different accounts, same organization, unlinked state, and dates within seven calendar days. Sort suggestions by absolute date distance, then date and stable transaction ID.
4. Link, paired creation, unlink, and paired deletion through Jazz exclusive transactions with explicit open/read/assess/stage/commit/settle/rollback states. Exclusive transactions validate reads and writes serializably at the authority, preventing concurrent linking of one transaction to two counterparts and preventing a user-visible one-sided paired creation. Do not hide the workflow in an async helper or a `fromPromise` actor. The UI reports pending/failure accurately when authority acceptance is not yet available.
5. Filter linked transactions from workspace expense totals and categorized totals while preserving account histories and balances. Do not infer transfer status from `paymentMethod`.
6. Deletion uses explicit choices. The existing account-grant model does not have a distinct delete capability; add an explicit account-level delete authorization and a way for administrators to manage it before exposing delete-both or unlink-and-delete actions. Do not reinterpret write access as delete access.

## Project Structure

### Documentation

```text
specs/010-transfer-linking/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md
```

### Source Code

```text
src/lib/schema/transactions.ts
src/lib/schema/accounts.ts
src/lib/schema/identity.ts
src/lib/schema.ts
src/lib/permissions.ts
src/lib/domain/internal-transfer.ts
src/lib/domain/organization-permissions.ts
src/lib/machines/internal-transfer.ts
src/lib/machines/transaction-save.ts
src/lib/components/TransactionEditEntry.svelte
src/lib/components/InternalTransferEntry.svelte
src/lib/components/TransactionForm.svelte
src/lib/components/InternalTransferSuggestions.svelte
src/routes/transfers/new/+page.svelte
src/lib/components/TransactionDetails.svelte
src/lib/components/AccountList.svelte
src/routes/+page.svelte
src/routes/accounts/+page.svelte
src/lib/components/ExpenseOverview.svelte
src/lib/migrations/
messages/en.json
```

**Structure Decision**: Keep Jazz subscriptions and actor lifecycle in `TransactionEditEntry`; put pure match rules in the domain layer, resource-owning transfer operations under `src/lib/machines/`, and props-only transfer suggestions in a presentation component. Keep reporting filtering beside the existing expense overview data flow. Extend existing permission/schema modules and add an additive migration rather than creating a transfer controller or a new app layer.

## Implementation Review Slices

1. **Data model and migration**: relationship record and additive migration. Keep this to 4–6 files and review before policy or UI work.
2. **Policy and grant management**: link/privacy/dual-account authorization, explicit delete checks, and administrator controls for separate account delete grants. Review before building the transfer UI.
3. **Match and link**: pure candidate eligibility/order, editor query and transfer state, machine-first existing-link workflow, and localized selection UI. Review before paired creation.
4. **Paired entry**: a dedicated transfer entry route/integration and a machine-first exclusive workflow that stages the expense, income, and relationship together. Share only existing reusable form/domain pieces; review before reporting work.
5. **Totals**: linked-relationship observation and filtering from workspace expense and categorized totals. Review before lifecycle work.
6. **Lifecycle**: unlink, paired edit protection, and delete choices. Review each cohesive 4–6-file batch.

No tests are added or run in these slices until the user reviews and approves the implementation they cover. During each slice, inspect existing unit and Playwright coverage and report the affected files/scenarios for approval.

## Complexity Tracking

No constitution violations are planned. The new relationship table, one persistence statechart, and account-level delete capability each directly enforce approved transfer invariants and do not introduce a generic abstraction.
