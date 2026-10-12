# Tasks: Delightful Finance MVP

**Input**: [spec.md](spec.md), [plan.md](plan.md)
**Feature**: `001-finance-mvp`

## Checkpoint status

Checked tasks have completed their relevant verification. Unchecked tasks can include implemented portions whose coverage or remaining scope is still pending; they are not all unstarted.

- **Verified**: T006 and T038 have production build/type checks and passing Playwright coverage for offline direct navigation/reload with a persisted account, public cache boundaries, and updates preserving an unsaved form. Browser installation prompts and multi-tab activation still need review.
- **Implemented; remaining verification**: scaffold/tooling/layout/localization (T001, T003–T005, T007), schema and permissions (T008–T013), local-first authentication/workspace bootstrap (T016–T018), account create/list (T021), money/domain helpers and transaction form/check income (T025–T027, T029). Relevant automated coverage is incomplete or has not been rerun for the current implementation.
- **Partially implemented**: T002 has test tooling but no CI; T014 has permission limitation comments but selective sharing remains unverified; T019 has an app shell; T022 excludes archived accounts but has no archive UI; T028 requires a category but does not default it; T030 has expense/income lists without detail/account/category/tag columns; T034 has a workspace switcher but no settings page; T035/T036 have limited money/domain tests and one account/expense browser flow.
- **Known limitation**: transaction-tag inserts are denied until the current Jazz server can enforce the transaction/tag workspace join. Tag assignment is not complete.
- Other unchecked items remain planned work. This checkpoint does not claim complete MVP coverage or production deployment readiness.

## Phase 1: Scaffold

- [ ] T001 Create SvelteKit app using the Jazz Svelte starter and configure strict TypeScript.
- [ ] T002 Configure unit test tooling and Playwright; add CI commands for both suites.
- [ ] T003 Establish accessible native HTML controls and minimal layout CSS; add visual styling only after user approval.
- [ ] T004 Add XState and `@xstate/svelte` for stateful feature workflows.
- [ ] T005 Add Paraglide JS with an English message catalog and route all visible UI text through messages.
- [x] T006 Add a native SvelteKit service worker, web app manifest, and prerendered public page shells without caching Jazz data/auth/sync.
- [ ] T007 Establish source and test layouts for schema, permissions, money helpers, machines, routes, and static assets.

## Phase 2: Schema and Permissions

- [ ] T008 Define Jazz schemas for profiles, organizations, organizationMembers, accounts, accountMemberships, categories, tags, transactions, and transactionTags.
- [ ] T009 Define checkDetails as a one-to-one related record and model check-income requirements in application types.
- [ ] T010 Define SimpleFIN connections and account links; make Access URL owner/admin-readable only.
- [ ] T011 Add transaction source/externalId/batchId and schema stubs for file/attachment and batch records.
- [ ] T012 Implement org role and account-grant read/write policies, using explicit `accountAccessMode`: `all` grants org-wide access; `selected` requires account grants and zero grants means no account access.
- [ ] T013 Enforce account/org/category consistency and required category/kind/currency relationships in writes.
- [ ] T014 Document/resolve Jazz permission limitations around grant-aware queries before enabling selective sharing.
- [ ] T015 Add unit tests for schema-boundary adapters and permission rules, including unauthorized and grant edge cases.

## Phase 3: Authentication and Personal Organization

- [ ] T016 Wire Jazz authentication and app session state.
- [ ] T017 Create/reuse a profile, personal organization, and owner membership on first login.
- [ ] T018 Seed protected Uncategorized expense and income categories for each new organization.
- [ ] T019 Add a minimal signed-in shell and route guards based on Jazz permissions.
- [ ] T020 Add unit tests for bootstrap idempotency and Playwright coverage for first sign-in/workspace setup.

## Phase 4: Accounts

- [ ] T021 Build the organization account list and account creation flow for USD ledgers.
- [ ] T022 Support archiving accounts and exclude archived accounts from new transaction selection.
- [ ] T023 Build account detail view with historical transactions.
- [ ] T024 Add unit tests for account validation/behavior and Playwright tests for account create, list, archive, and history.

## Phase 5: Transactions, Categories, and Tags

- [ ] T025 Add integer minor-unit money parsing/formatting helpers and USD form controls.
- [ ] T026 Implement expense/income transaction domain unions and Jazz boundary mapping without `any` or `as`.
- [ ] T027 Build XState transaction form: draft, validate, save, success/error; support local-first writes.
- [ ] T028 Require matching-kind category and default to the corresponding Uncategorized category.
- [ ] T029 Add income payment methods; require and save check details only for check income.
- [ ] T030 Build transaction list/detail views with date, account, amount, category, memo, and tags.
- [ ] T031 Build category settings with org-scoped create/archive and protected system categories.
- [ ] T032 Build tag settings with optional category assignment and archive behavior.
- [ ] T033 Build XState tag picker with search, create, multi-select, and archived-tag exclusion.
- [ ] T034 Add organization switcher state and settings shell; second-org creation/join flow may remain deferred.
- [ ] T035 Add unit tests for money/date/domain validation and transaction/tag state machines.
- [ ] T036 Add Playwright coverage for expense/income entry (including check details), transaction history, category management, and tag selection/archive behavior.

## Phase 6: Offline Shell and Polish

- [ ] T037 Surface lightweight Jazz sync/pending status in the app shell.
- [x] T038 Complete PWA offline shell behavior and ensure cache rules do not conflict with Jazz data.
- [ ] T039 Apply a coherent responsive visual system with keyboard-accessible interaction states.
- [ ] T040 Add Playwright coverage for org access boundaries, credential visibility, sync/pending state, and supported offline writes/sync.
- [ ] T041 Confirm all user-visible strings use Paraglide and all currency/date display uses locale-aware APIs.
- [ ] T042 Run relevant unit and Playwright suites in CI and confirm all shipped code paths have appropriate coverage.

## Deferred Follow-up

- [ ] T043 Implement server-side SimpleFIN claim and scheduled/on-demand import worker with idempotent external IDs; include unit and Playwright coverage.
- [ ] T044 Build SimpleFIN account linking and transaction import UI; include unit and Playwright coverage.
- [ ] T045 Implement transaction image upload and attachment UI using Jazz blob APIs; include unit and Playwright coverage.
- [ ] T046 Implement transaction batch/template flows; include unit and Playwright coverage.
- [ ] T047 Add business-org creation, invite UX, and fine-grained account grant management; include unit and Playwright coverage.
- [ ] T048 Evaluate multi-currency entry/FX and native wrappers as separate specifications.
