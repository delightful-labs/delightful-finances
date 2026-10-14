# Tasks: Delightful Finance MVP

**Input**: [spec.md](spec.md), [plan.md](plan.md)
**Feature**: `001-finance-mvp`

## Checkpoint status

Checked tasks have completed their relevant verification. Unchecked tasks can include implemented portions whose coverage or remaining scope is still pending; they are not all unstarted.

- **Verified**: T006 and T038 have production build/type checks and passing Playwright coverage for offline direct navigation/reload with a persisted account, public cache boundaries, and updates preserving an unsaved form. Browser installation prompts and multi-tab activation still need review.
- **Implemented; remaining verification**: scaffold/tooling/layout/localization (T001, T003–T005, T007), schema and permissions (T008–T013), local-first authentication/workspace bootstrap (T016–T018), account create/list (T021), money/domain helpers and transaction form (T025–T027). Relevant automated coverage is incomplete or has not been rerun for the current implementation.
- **Partially implemented**: T002 has test tooling but no CI; T014 has permission limitation comments but selective sharing remains unverified; T019 has an app shell; T030 has verified date-grouped expense/income lists with account/category/tag names and per-currency daily totals; transaction list/detail views have passing relevant browser coverage; T035/T036 have limited money/domain tests and one account/expense browser flow.
- **Transaction-tag permissions verified**: links carry `organizationId`; inserts require transaction edit access, matching transaction/tag workspaces, and an active tag. Ten real-server tests pass for same-transaction creation, cross-workspace and missing references, archived history/removal, immutable links, and all role/grant cases. After user authorization, the pre-alpha development database and migration history were reset; no migration files or snapshots are retained. Application/browser-test type checks pass. Tag assignment UI remains T033. Run `pnpm test:permissions --grep "transaction tag"`.
- **Authentication verification**: traced the rejected write to workspace bootstrap recreating existing profile/workspace/membership/category records after cold reloads. Bootstrap now hydrates existing records with Jazz `ReadTier.LocalFirstUnlessEmpty` before opening a write transaction, skips writes when setup already exists, recognizes starter category IDs, and waits for local persistence before showing the app. Eight consecutive restoration checks passed, covering workspace/account reuse and isolation from the previous identity; the final three also verified starter category counts. The existing account creation/expense entry check passed. Permission rules and SDK shutdown safeguards remain enforced. Run `pnpm test:auth` against the development server on port 5173; Six bootstrap unit tests now cover initial setup, reuse without writes, renamed categories, missing-category repair, read failures, and local persistence failures. Invalid recovery phrase word counts, words, and checksums have passing browser coverage; network/session failure paths remain pending.
- **Workspace authorization verification**: nine real-server role/grant cases pass for workspace/account/transaction reads, account writes, admin-only connection visibility, zero grants, viewer read-only behavior, and orphan grants. The category-move regression exposed missing destination-organization authorization. The T013 category update guard now checks owner/admin/member access to both the original and destination organizations and keeps system categories protected. After implementation review, `pnpm test:permissions` passed all ten checks, including the category-move regression; browser-test TypeScript checks also passed.
- **Workspace settings verification**: five shared form-machine unit tests pass. Five browser tests pass for sidebar navigation preserving the workspace and database session, trimmed names, whitespace rejection and retry, reload persistence, owner/admin renaming, member/viewer read-only controls and server-denied renames, and switching between workspaces. Run `pnpm test:workspace`; browser-test TypeScript checks pass. The sidebar link is reviewed and its navigation test passes.
- **Account-list query verification**: `AccountList` uses Jazz’s reactive `QuerySubscription` and shared `QueryContent`. Two focused browser tests pass for empty results, creation/reload persistence, name ordering, archived-account exclusion, live archive updates, and switching workspaces. Run `pnpm test:workspace --grep "account list"`; browser-test TypeScript checks pass. Account management uses the shared sidebar and existing list/create forms; retained history is reviewed in the income/expense views.
- **Transaction-list query verification**: Income/expense pages now initialize a shared `queries/transaction-list.svelte.ts` integration module using Jazz’s reactive subscriptions. `TransactionList` and `TransactionListItem` receive presentation data through props; pages compose shared `QueryContent`. After review, the boundary refactor passes all 16 focused unit tests and six relevant list/archive-history browser checks, with browser-test type checks passing. Two focused browser tests pass for empty income/expense views, descending date order, amount formatting, individual/all-account filters, workspace switching, live inserts, and reload persistence. Run `pnpm test:workspace --grep "transaction list"`; browser-test TypeScript checks pass. After review, T030 date-grouped lists pass 16 focused grouping/money unit tests and six browser checks for empty results, kind/date order, filters, per-currency daily totals, live updates, workspace switching, reloads, optional memos, archived/renamed category/tag/account labels, and retained archive history. Transaction details use a props-only presentation component and a scoped query module initialized by `/transactions/[id]`; list links and six detail browser cases now pass after review. Run `pnpm test:workspace --grep "transaction list|archives offline|account archive works offline"`.
- **App shell query verification**: `AppShell` now uses Jazz reactive query subscriptions and shared `QueryContent` for workspace/account loading and errors. Account queries follow the active workspace and exclude archived accounts. After review, all nine workspace/account/transaction browser tests pass against this implementation; browser-test TypeScript checks pass. `TransactionForm` now also uses Jazz reactive subscriptions and shared `QueryContent`; its account/category queries follow the active workspace and exclude archived records. After review, three focused form browser tests pass for no-account handling, expense/check-income saves, workspace-specific options, archived and wrong-kind filtering, persisted check details, and adding another transaction; browser-test TypeScript checks pass. No components retain manual query subscriptions.
- **Shared transaction form migration**: `TransactionForm` now uses the shared `Form` and machine. A Zod adapter resolves current account/category selections and transforms native fields into the existing transaction domain schema. Workspace/kind changes reset the form; native reset handles adding another transaction. The unused transaction-specific machine was removed. After review, 29 adapter unit tests and five shared-machine unit tests pass. Three form browser regressions pass, including draft reset on workspace change and correcting missing check details without losing entered fields. Application and browser-test TypeScript checks pass.
- **Shared account form migration**: `AccountForm` now uses the shared `Form` and machine with Zod name/type validation, fixed workspace context, and reset on workspace changes. `createAccount` waits for local persistence before success. After review, 11 schema tests and three local-persistence tests pass, along with the shared-machine and bootstrap regressions (25 unit tests total). Three focused browser tests pass for whitespace-name rejection/correction, cash/bank/card creation, workspace draft reset and selected-workspace saves, and listing after reload. Application and browser-test TypeScript checks pass.
- **Canonical transaction schema refactor**: `appTransactionSchema` supplies the canonical transaction rules. The form adapter derives fields with `.pick()`, reuses validators from the canonical schema, and uses Zod trim/default/transform/pipe APIs. Manual reflection and type checks were removed; custom code resolves current rows and maps the transport shape. Memo normalization, required check dates, and the manual-income cash default live on the canonical schema; `createTransaction` persists its parsed output. The form no longer repeats those normalizations. After review, canonical/form/persistence unit coverage passes. Seven account/list/transaction-form browser regressions pass. The two default-category cases exposed a date-reset bug; after review, both pass with the native date input using `defaultValue`. The focused checks total 80 unit tests and nine browser tests, with passing application/browser-test type checks.
- **Canonical account schema consolidation**: `appAccountSchema` now owns name/type/workspace/currency/archive validation and defaults. `accountFormSchema` derives name/type with `.pick()`. Jazz reuses the canonical name/currency validators and enum values; `createAccount` saves parsed values. After review, canonical/form/persistence unit coverage and the account browser regressions pass. The focused unit run has 80 passing tests across both entity validators, persistence, the shared machine, and transaction-domain validation; application/browser-test type checks pass.
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
- [x] T020 Add unit tests for bootstrap idempotency and Playwright coverage for first sign-in/workspace setup.

## Phase 4: Accounts

- [ ] T021 Build the organization account list and account creation flow for USD ledgers.
- [x] T022 Support archiving accounts and exclude archived accounts from new transaction selection.
  - Verified: AccountList offers Archive to owners/admins and members with write access. A shared form-machine action validates account/workspace IDs and waits for local persistence. The account/transactions are retained; existing queries exclude archived accounts from active lists and new-entry options. After review, 44 focused unit tests and eight browser tests pass, including offline archive/sync, retained history, new-entry exclusion, list regressions, admin/member writes, and read-only member/viewer server denials. Application/browser-test type checks pass. Run type checks before browser suites: generated-file updates can trigger dev-server reloads during fixtures.
- [ ] T024 Add unit tests for account validation/behavior and Playwright tests for account create, list, archive, and retained history in the income/expense views.

## Phase 5: Transactions, Categories, and Tags

- [ ] T025 Add integer minor-unit money parsing/formatting helpers and USD form controls.
- [ ] T026 Implement expense/income transaction domain unions and Jazz boundary mapping without `any` or `as`.
- [ ] T027 Build XState transaction form: draft, validate, save, success/error; support local-first writes.
- [x] T028 Require matching-kind category and default to the corresponding Uncategorized category.
  - Verified: the native category select defaults to the active workspace’s unarchived system category for the transaction kind. The Zod adapter uses the same fallback only when no category ID is submitted; explicit choices remain validated. Matching uses system identity rather than the category name. Unit coverage and both expense/income browser cases pass for defaults, explicit overrides, live category updates preserving selections, reset, and workspace switching. Native date reset restores today through `defaultValue`.
- [x] T029 Add income payment methods; require and save check details only for check income.
  - Verified: check-number/date inputs only render for Check and both are required. Canonical check-income validation requires a valid date and nonblank number; its writer always persists the date. Inputs remain uncontrolled, with a small visibility state synchronized by the native select and Svelte attachment. After review, 68 focused unit tests and five browser regressions pass, including missing/empty/invalid check dates, persisted required dates, conditional visibility, native required validation, Zod validation retry, and workspace/form resets. Application/browser-test type checks pass.
- [x] T030 Build transaction list/detail views with date, account, amount, category, memo, and tags.
  - After review, six detail browser cases pass for keyboard list-link navigation, related account/category/tag records, check-income details, live updates/reload/back navigation, selected-workspace/missing-row handling, viewer account grants, and member editor attribution. Browser-test type checks pass. Run `pnpm test:workspace --grep "transaction details"`.
- [x] T031 Build category settings with org-scoped create/archive and protected system categories.
  - Verified after review: category creation, trimmed-name validation/retry, both kinds, workspace switching/draft reset, reload persistence, connected transaction/tag counts, offline archiving/sync, retained history, archived-category exclusion from new entry, and system-category protection. Admin/member creation and archiving pass; viewers have disabled controls and server-denied writes. Selected-account count coverage confirms unreadable transactions are excluded. 43 focused unit tests and six browser tests pass; browser-test type checks pass. Run `pnpm test:workspace --grep "category page"`.
- [x] T032 Build tag settings with optional category assignment and archive behavior.
  - Verified after review: tag creation with/without categories, trimmed names and validation retry, active workspace category options, retained names for archived categories, reload persistence, workspace draft reset/isolation, offline archive/sync, and retained category connections/counts. Admin/member creation and archiving pass; viewer controls are disabled and direct writes are denied by the server. 50 focused unit tests and five browser tests pass; browser-test type checks pass. Run `pnpm test:workspace --grep "tag page"`. Transaction tag selection/assignment remains T033; the workspace-reference permission change has passing real-server coverage.
- [x] T033 Use Delightful UI TagInput for search, create, multi-select, and archived-tag exclusion, with the shared XState transaction form handling validation/save.
  - Verified after review: repeated FormData values are collected as arrays; canonical validation trims/deduplicates names. Saving reuses existing tags without changing their categories and creates new tags with the selected transaction category in the same database transaction. Local persistence gates success. 87 focused unit tests and four browser tests pass for expense/income tag entry, removal/deduplication/reset, category inheritance, archived-selection rollback/retry, workspace isolation, and offline creation/sync. Browser-test type checks pass. Run `pnpm test:workspace --grep "transaction tags"`.
- [x] T034 Add organization switcher state and settings shell; second-org creation/join flow may remain deferred.
  - Workspace naming: `WorkspaceNameForm`, active-workspace/role wiring, `/settings/workspace`, and unit/browser coverage are implemented. The sidebar link and navigation coverage are complete.
  - Shared form workflow: generic `Form` API reviewed; `WorkspaceNameForm` now supplies its schema, save operation, fixed workspace ID, and field/control/feedback snippets. The integration and settings page are reviewed; five form-machine unit tests and five workspace browser tests pass.
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

## Transaction Attribution and Login Profiles

- [x] T049 Select and display Jazz creator/latest-editor metadata for transactions, resolving author identities to profiles with fallbacks.
  - Verified in detail browser coverage: own display names resolve; other profiles use stable account-ID fallbacks under current owner-only profile-read permissions. A member edit preserves creator identity/timestamp and updates latest editor identity/timestamp. Shared profile visibility remains T050.
- [ ] T050 Add owner-editable login profile name and avatar upload/replace/remove, with permissions for authorized workspace members to read author display profiles.
- [ ] T051 After implementation review, add unit and Playwright coverage for attribution, profile permissions, avatar lifecycle, missing-profile fallbacks, and persistence across workspace switches/recovery.

## Delightful UI Integration Trial

- [x] T052 Create an isolated Finance integration branch/worktree and consume a packed local Delightful UI snapshot with a compatible Svelte peer range.
- [x] T053 Apply the approved global theme and migrate applicable existing controls while preserving native forms, localization and business logic.
- [x] T054 Record evidence-based future component suggestions in code, integration documentation and the active spec/plan.
- [x] T055 Prepare implementation review: packaging/publint, production build, application/service-worker static checks and changed-file formatting pass; isolated preview runs at http://127.0.0.1:5180. Implementation approved by the user.
- [x] T056 After approval, verify 89 focused unit tests and 27 browser scenarios for form defaults/resets, conditional check fields, workspace/filter state, recovery/restore, modal dismissal, archiving and permissions. Browser-test type checks pass.

## Page Composition Boundary Refactor

- [ ] T052 Apply the props-only presentation boundary across all pages in focused review batches.
  - Verified earlier: transaction lists/details use page-initialized query modules and props-only presentation components.
  - Verified after review: overview content moved back to its page and the redundant HomePage wrapper removed; login session/restore state moved to `controllers/login.svelte.ts`, with the page composing a pure LoginForm and PageHeader. Five authentication tests and two overview/navigation checks pass, with browser-test type checks passing. Fixtures now wait for workspace readiness before account entry and navigation completion before reload.
  - Verified after review: account recovery session/phrase/confirmation state moved to `controllers/account-recovery.svelte.ts`; `/account` initializes it and composes PageHeader plus a props-only AccountRecovery presentation component. Dialog dismissal and checkbox confirmation use callbacks rather than mutating parent props. All five authentication/recovery browser tests and browser-test type checks pass after this refactor.
  - Verified after review: `/accounts` initializes `controllers/account-list.svelte.ts` for queries, grant-aware archive eligibility, and the XState archive actor. AccountList renders accounts, permissions, and action status received through props and calls an archive callback. 61 focused unit tests and all eight account-list/archive browser checks pass, including offline archive/history and admin/member/viewer grant cases; browser-test type checks pass.
  - Awaiting review: `/accounts/new` initializes `controllers/account-form.svelte.ts` for the workspace-scoped save callback. AccountForm receives workspace ID and save callback through props; page title/header are composed by the route. Shared Form actor initialization is a separate remaining batch.
  - Remaining: transaction entry/tag input; workspace rename/settings; category settings/list/form; tag settings/list/form; shared Form actor integration; app-shell/session/bootstrap integration. Preserve existing permissions, localization, native form behavior, and shared session lifecycle.
