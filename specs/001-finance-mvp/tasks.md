# Tasks: Delightful Finance MVP

**Input**: [spec.md](spec.md), [plan.md](plan.md)
**Feature**: `001-finance-mvp`

## Checkpoint status

Reconciled against the implementation, existing tests, and recorded verification on 2026-10-14. Checked tasks have implementation and relevant recorded passing checks. Test results below reflect separate checkpoints and runs, not one combined passing current-tree verification.

### Remaining MVP work

- **T040 — Remaining browser verification:** Authentication network/session failure and retry coverage is now verified under T058. Remaining: native installation-prompt review and the combined offline/access matrix.

### Verified foundations

- Scaffold, strict TypeScript, source/test layouts, XState form workflow, Paraglide integration, and approved Delightful UI integration are implemented. Application/service-worker and browser-test type checks have recorded passing results.
- Core entity schemas, canonical Zod adapters, integer money helpers, account create/list/archive, income/expense forms and grouped lists/details, categories/tags, workspace switching/naming, and transaction attribution have recorded unit/browser coverage in the task notes below.
- Check-detail integrity (T009) is verified with the detail-first model: initial reference checks, immutable selection, account/workspace grants, required dates, and atomic rollback. Latest focused checkpoint: 106 unit tests and 23 relevant browser scenarios passed.
- Real-server permission coverage includes roles, selected/all account access, zero/orphan grants, viewer write denials, admin-only provider credential reads, category-move rejection, and transaction-tag workspace/archived-history constraints. Full invite/grant-management UI stays deferred (T047).
- Authentication, personal-workspace bootstrap/reuse, protected starter categories, profile names/avatars, and shared-profile reads are implemented. Latest profile checkpoint: 43 persistence/bootstrap unit tests and 19 relevant browser scenarios passed; type/format checks passed. See T049–T051.
- Native service-worker/PWA coverage includes offline direct navigation/reload, public cache boundaries, and updates preserving drafts. Multiple-tab activation is now verified under T040; installation prompts still need review.
- Pre-alpha resets were explicitly authorized. No migration files are retained; another destructive reset still needs separate authorization.

Deferred T043–T048 are outside MVP. T023 was removed when account-detail/history routes were dropped; its number is intentionally unused. The composition refactor is T057 (formerly a duplicated T052).

## Phase 1: Scaffold

- [x] T001 Create SvelteKit app using the Jazz Svelte starter and configure strict TypeScript.

- [x] T003 Establish accessible native HTML controls and minimal layout CSS; add visual styling only after user approval.
  - Verified foundation: native controls and the approved Delightful UI theme are integrated (T052–T056). Broader responsive/keyboard review is deferred under T039 until after the post-MVP design revision.
- [x] T004 Add XState and `@xstate/svelte` for stateful feature workflows.
- [x] T005 Add Paraglide JS with an English message catalog and route all visible UI text through messages.
  - Verified integration: nested English catalog, Paraglide compiler and message calls are present. The complete visible-string/formatting audit remains T041.
- [x] T006 Add a native SvelteKit service worker, web app manifest, and prerendered public page shells without caching Jazz data/auth/sync.
- [x] T007 Establish source and test layouts for schema, permissions, money helpers, machines, routes, and static assets.

## Phase 2: Schema and Permissions

- [x] T008 Define Jazz schemas for profiles, organizations, organizationMembers, accounts, accountMemberships, categories, tags, transactions, and transactionTags.
  - Verified implementation: composed entity schemas in src/lib/schema; boundary/domain units and recorded real-server permission tests cover their use. Shared-profile schema publication is verified in T050.
- [x] T009 Define checkDetails as a one-to-one related record and model check-income requirements in application types.
  - Verified detail-first model: checkDetails stores organizationId/accountId relations and insertion uses account write permission plus matching active-account validation. The writer inserts the detail before its parent in one database transaction. Parent insert/update policies require an existing detail matching transaction/account/workspace IDs. Selection is singular/immutable; detail edits preserve ownership references, reassignment and deletion are denied, and reads follow account grants.
  - Verified on 2026-10-15 after explicit reset/test authorization: schema and permissions published successfully; 106 focused unit tests, 10 check-detail integrity/access browser scenarios, and 13 transaction form/detail/tag browser scenarios pass. Application, browser-test and worker type checks pass; changed-file formatting/diff checks pass. Fixtures verify detail-first order and context. Coverage includes initial absent/shared/cross-account/cross-workspace references, rejection of details on archived accounts or mismatched account/workspace pairs, required dates, valid edits, atomic rollback, competing selections, reassignment/deletion, all nine role/grant cases, and offline/tag/detail workflows. Five stale amount-label locators were updated to the current approved form label. No migration files retained; no commit made.
  - Scope of one-to-one association: directly written unselected candidates are permitted under account authorization, but a transaction selects only one matching record and another transaction cannot share it. Concurrent dependent attempts can return cascade_rejected after a root permission denial; assertions also verify the selected record remains unchanged. Earlier reverse-collection/negative-existence/circular-check attempts are superseded; the initial-reference gap is now closed.

- [x] T010 Define SimpleFIN connections and account links; make Access URL owner/admin-readable only.
  - Verified schema/policy readiness: integration tables exist; role/grant browser cases cover owner/admin credential access and member/viewer exclusion. Claim/import UI remains deferred.
- [x] T011 Add transaction source/externalId/batchId and schema stubs for file/attachment and batch records.
  - Verified schema readiness: transaction provenance/batch fields and attachment/file/batch tables are defined. Full UI/worker implementations remain deferred; transaction boundary tests cover manual/imported variants.
- [x] T012 Implement org role and account-grant read/write policies, using explicit `accountAccessMode`: `all` grants org-wide access; `selected` requires account grants and zero grants means no account access.
  - Verified by recorded real-server role/grant cases, including selected mode, zero grants, orphan grants, and viewer write denial; affected detail/profile cases were rerun at T050.
- [x] T013 Enforce account/org/category consistency and required category/kind/currency relationships in writes.
  - Verified implementation: account/category workspace, currency, kind, and archive guards are in permissions.ts and canonical adapters. Recorded coverage includes category-move rejection and transaction-tag cross-workspace rejection. Check-detail integrity is verified in T009.
- [x] T014 Document/resolve Jazz permission limitations around grant-aware queries before enabling selective sharing.
  - Verified scope: plan.md documents explicit all/selected access; real-server tests cover zero/orphan grants and readable transaction/category counts. Queries remain permission-scoped. Shared profiles require a declared membership profileId relation (T050); missing links grant no shared reads. Sharing-management UI remains deferred, not enabled by this task.
- [x] T015 Add unit tests for schema-boundary adapters and permission rules, including unauthorized and grant edge cases.
  - Verified at the appropriate boundaries: canonical/schema-adapter unit tests plus real-server permission tests cover unauthorized roles, grants, category moves, and tag links. Permission enforcement is exercised against Jazz rather than a mocked rule evaluator.

## Phase 3: Authentication and Personal Organization

- [x] T016 Wire Jazz authentication and app session state.
  - Verified: shared local-first session, restore flow, malformed recovery phrases, and cross-device recovery have passing authentication coverage. Network/session failure and retry coverage is verified separately in T058.
- [x] T017 Create/reuse a profile, personal organization, and owner membership on first login.
  - Verified: bootstrap idempotency, reload/recovery reuse, profile linkage/repair, local persistence, and existing-workspace isolation have unit/browser coverage (T020/T050).
- [x] T018 Seed protected Uncategorized expense and income categories for each new organization.
  - Verified: bootstrap seeds both protected system categories; units and category/default-category browser cases cover reuse and protection (T028/T031).
- [x] T019 Add a minimal signed-in shell and route guards based on Jazz permissions.
  - Verified: bootstrap gates app rendering, the app shell preserves session/workspace across navigation, and scoped queries/server policies enforce access. Permission and missing/other-workspace detail scenarios have passing browser coverage.
- [x] T020 Add unit tests for bootstrap idempotency and Playwright coverage for first sign-in/workspace setup.

## Phase 4: Accounts

- [x] T021 Build the organization account list and account creation flow for USD ledgers.
  - Verified: canonical account validator, shared form/data writer, active account list/sidebar, and recorded create/list/workspace/reload browser coverage. See T024.
- [x] T022 Support archiving accounts and exclude archived accounts from new transaction selection.
  - Verified: AccountList offers Archive to owners/admins and members with write access. A shared form-machine action validates account/workspace IDs and waits for local persistence. The account/transactions are retained; existing queries exclude archived accounts from active lists and new-entry options. After review, 44 focused unit tests and eight browser tests pass, including offline archive/sync, retained history, new-entry exclusion, list regressions, admin/member writes, and read-only member/viewer server denials. Application/browser-test type checks pass. Run type checks before browser suites: generated-file updates can trigger dev-server reloads during fixtures.
- [x] T024 Add unit tests for account validation/behavior and Playwright tests for account create, list, archive, and retained history in the income/expense views.
  - Verified: canonical account and persistence unit tests; create/list/archive browser checks cover validation/retry, workspace draft resets, retained history, selected grants, offline archive/sync, and server denials (T022).

## Phase 5: Transactions, Categories, and Tags

- [x] T025 Add integer minor-unit money parsing/formatting helpers and USD form controls.
  - Verified: parseAmountMinor/formatMoney unit tests cover decimal parsing, invalid/overflow inputs, nonnegative integer values and currency formatting. Form/list browser tests cover USD entry and displayed amounts.
- [x] T026 Implement expense/income transaction domain unions and Jazz boundary mapping without `any` or `as`.
  - Verified: canonical transaction unions, boundary mapping and normalization have recorded unit coverage; form/check/tag browser cases exercise persisted shapes.
- [x] T027 Build XState transaction form: draft, validate, save, success/error; support local-first writes.
  - Verified: the shared XState form machine supplies validation/save/success/error/reset actors; machine, schema and persistence units plus form retry/reset/local-write browser tests pass. No separate transaction-specific machine is required.
- [x] T028 Require matching-kind category and default to the corresponding Uncategorized category.
  - Verified: the native category select defaults to the active workspace’s unarchived system category for the transaction kind. The Zod adapter uses the same fallback only when no category ID is submitted; explicit choices remain validated. Matching uses system identity rather than the category name. Unit coverage and both expense/income browser cases pass for defaults, explicit overrides, live category updates preserving selections, reset, and workspace switching. Native date reset restores today through `defaultValue`.
- [x] T029 Add income payment methods; require and save check details only for check income.
  - Verified: check-number/date inputs only render for Check and both are required. Canonical check-income validation requires a valid date and nonblank number; its writer always persists the date. Inputs remain uncontrolled, with a small visibility state synchronized by the native select and Svelte attachment. After review, 68 focused unit tests and five browser regressions pass, including missing/empty/invalid check dates, persisted required dates, conditional visibility, native required validation, Zod validation retry, and workspace/form resets. Application/browser-test type checks pass.
- [x] T030 Build transaction list/detail views with date, account, amount, category, memo, and tags.
  - After review, six detail browser cases pass for keyboard list-link navigation, related account/category/tag records, check-income details, live updates/reload/back navigation, selected-workspace/missing-row handling, viewer account grants, and member editor attribution. Browser-test type checks pass. Run `pnpm test:workspace --grep "transaction details"`.
- [x] T031 Build category settings with org-scoped create/archive and protected system categories.
  - Verified after review: category creation, trimmed-name validation/retry, both kinds, workspace switching/draft reset, reload persistence, connected transaction/tag counts, offline archiving/sync, retained history, archived-category exclusion from new entry, and system-category protection. Admin/member creation and archiving pass; viewers have disabled controls and server-denied writes. Selected-account count coverage confirms unreadable transactions are excluded. 43 focused unit tests and six browser tests pass; browser-test type checks pass. Run `pnpm test:workspace --grep "category page"`.
- [x] T032 Build tag settings with optional category assignment and archive behavior.
  - Verified after review: tag creation with/without categories, trimmed names and validation retry, active workspace category options, retained names for archived categories, reload persistence, workspace draft reset/isolation, offline archive/sync, and retained category connections/counts. Admin/member creation and archiving pass; viewer controls are disabled and direct writes are denied by the server. 50 focused unit tests and five browser tests pass; browser-test type checks pass. Run `pnpm test:workspace --grep "tag page"`. Transaction tag selection/assignment is verified in T033; the workspace-reference permission change has passing real-server coverage.
- [x] T033 Use Delightful UI TagInput for search, create, multi-select, and archived-tag exclusion, with the shared XState transaction form handling validation/save.
  - Verified after review: repeated FormData values are collected as arrays; canonical validation trims/deduplicates names. Saving reuses existing tags without changing their categories and creates new tags with the selected transaction category in the same database transaction. Local persistence gates success. 87 focused unit tests and four browser tests pass for expense/income tag entry, removal/deduplication/reset, category inheritance, archived-selection rollback/retry, workspace isolation, and offline creation/sync. Browser-test type checks pass. Run `pnpm test:workspace --grep "transaction tags"`.
- [x] T034 Add organization switcher state and settings shell; second-org creation/join flow may remain deferred.
  - Workspace naming: `WorkspaceNameForm`, active-workspace/role wiring, `/settings/workspace`, and unit/browser coverage are implemented. The sidebar link and navigation coverage are complete.
  - Shared form workflow: generic `Form` API reviewed; `WorkspaceNameForm` now supplies its schema, save operation, fixed workspace ID, and field/control/feedback snippets. The integration and settings page are reviewed; five form-machine unit tests and five workspace browser tests pass.
- [x] T035 Add unit tests for money/date/domain validation and transaction/tag state machines.
  - Verified on 2026-10-15: 111 focused unit tests pass across date-only/money helpers, transaction domain/grouping, canonical transaction/tag validation and the shared form machine. New todayDateOnly coverage has 18 cases, each passing in separate UTC, America/New_York and Pacific/Auckland processes. Covers zero padding, month/year boundaries, leap/century dates, New York daylight-saving boundaries, years below 1000, input immutability, default current time and repeated calls across local midnight. Production code is unchanged; no browser tests needed for this test-only addition. The shared form machine covers transaction/tag workflow states; no separate machines were introduced.
- [x] T036 Add Playwright coverage for expense/income entry (including check details), transaction history, category management, and tag selection/archive behavior.
  - Verified through recorded transaction/default-category/check/list/detail, category, and tag-selection/archive browser cases in tests/workspace.e2e.ts (T028–T033).

## Phase 6: Offline Shell and Polish

- [x] T038 Complete PWA offline shell behavior and ensure cache rules do not conflict with Jazz data.

- [ ] T040 Add Playwright coverage for org access boundaries, credential visibility, sync/pending state, and supported offline writes/sync.
  - Partial: role/grant/credential visibility and offline account/category/tag/profile write/sync cases have recorded passing coverage. All six current production-preview PWA browser checks pass, including a two-tab update lifecycle: drafts/controllers remain intact while waiting, closing one tab does not activate the update, closing the last controlled tab activates it, and a reopened tab uses the active worker. The generated worker fixture is restored after the test; production code is unchanged. Remaining: install-prompt review and review of the combined offline/access matrix. Authentication failures are verified under T058.
- [x] T041 Confirm all user-visible strings use Paraglide and all currency/date display uses locale-aware APIs.
  - Audited on 2026-10-15: page/component labels, titles, feedback, accessibility labels, bootstrap defaults, manifest metadata, and every money/date display. Localized bootstrap names while preserving deterministic seed IDs and existing saved names; moved install metadata to a prerendered Paraglide manifest endpoint at the existing URL; localized category counts and transaction tag-list punctuation with Intl. Existing money/date displays already pass the active locale, with UTC for calendar dates. Static application/service-worker checks pass without warnings. Full build generated the manifest but fails on the unchanged dynamic transaction route inheriting prerender=true without entries. Implementation reviewed and focused tests verified: 88 unit tests and four browser scenarios pass, including translation-driven seed names with original UUIDs/reuse, locale-aware count/tag formatting, manifest metadata/language/install URLs, and existing category/history/currency display regressions. Browser-test TypeScript checks pass. Follow-up production verification now passes for the manifest cache and transaction-detail route. Details are in plan.md under T041 Localization and Formatting Audit.
- CI verification attempt (2026-10-15): app/service-worker checks and browser-test TypeScript checks pass; all 264 unit tests pass; all 15 authentication tests pass; all six production-preview PWA tests pass after a successful production build. The base Playwright suite had two passing and five failing tests: an obsolete `src/routes/finance.e2e.ts` is matched, and several UI-integration cases timed out while workspace bootstrap was still loading. The permissions suite had 30 failures because its startup locator expects a complementary navigation landmark absent from the current shell. The workspace suite lost its development-server connection and reported 49 failures. Parallel attempts also contended for the Jazz dev-server RocksDB catalogue lock. These failures need investigation before claiming the browser suites pass; this work was not retained as CI configuration.

## Deferred Follow-up

- [ ] T039 Revisit responsive layout, keyboard/focus behavior, and interaction states after the planned post-MVP design and layout revision. Existing shell behavior has focused responsive/keyboard coverage; perform the broader review against the revised design rather than polishing the current layout prematurely.
- [ ] Revisit Jazz pending/sync-completion observability and the app-shell status indicator when the SDK exposes a supported whole-device signal. The current shell reports only local mode, browser offline state, or sync configuration; do not claim a completed sync. See the deferred sync-status observability investigation in plan.md.
- [ ] Add GitHub Actions CI for application checks, unit tests, and Playwright suites. Existing package scripts and Playwright configurations are available; workflow setup and reliable execution are deferred beyond MVP. Latest attempted local run: app/service-worker checks, browser-test type checks, 264 unit tests, 15 authentication tests, production build, and six PWA tests passed. Base Playwright, permissions, and workspace runs did not pass; investigate stale test discovery/readiness selectors and Jazz dev-server startup/connection before adding required CI gates.
- [ ] T043 Implement server-side SimpleFIN claim and scheduled/on-demand import worker with idempotent external IDs; include unit and Playwright coverage.
- [ ] T044 Build SimpleFIN account linking and transaction import UI; include unit and Playwright coverage.
- [ ] T045 Implement transaction image upload and attachment UI using Jazz blob APIs; include unit and Playwright coverage.
- [ ] T046 Implement transaction batch/template flows; include unit and Playwright coverage.
- [ ] T047 Add business-org creation, invite UX, and fine-grained account grant management; include unit and Playwright coverage.
- [ ] T048 Evaluate multi-currency entry/FX and native wrappers as separate specifications.

## Transaction Attribution and Login Profiles

- [x] T049 Select and display Jazz creator/latest-editor metadata for transactions, resolving author identities to profiles with fallbacks.
  - Verified in detail browser coverage: own display names resolve; authorized shared authors resolve to display names; missing names retain stable account-ID fallbacks. A member edit preserves creator identity/timestamp and updates latest editor identity/timestamp.
- [x] T050 Add owner-editable login profile name and avatar upload/replace/remove, with permissions for authorized workspace members to read author display profiles.
  - Verified after review: /account includes a props-only profile name form, canonical profile/form validation, and an identity-scoped save workflow that waits for local persistence. Blank names clear the display name for the existing account-ID fallback. All 62 focused validation/persistence/shared-machine unit tests and 23 browser scenarios pass across authentication and affected form workflows, covering trim/clear/reload, recovery on another device, workspace reuse, offline saving, attribution, owner-only writes, and ownership-transfer rejection. A shared form lifecycle fix uses a derived identity key so reactive profile updates do not reset save feedback. Application/service-worker and browser-test type checks pass. Shared-profile read permissions are verified below.
  - Avatar implementation reviewed: /account composes a pure ProfileAvatarForm with upload/replace/remove actions and a preview. The installed SDK's binary column primitive stores nullable bytes and MIME type on the profile; Zod validates PNG/JPEG/WebP uploads up to 10 MiB. Pica resizes them proportionally to at most 256 pixels, encodes a WebP avatar, and canonical validation caps the stored image at 256 KiB. Both fields update together and wait for local persistence under existing owner-only permissions. Identity guards are shared with the name save workflow. Type checks pass; all four avatar browser scenarios pass after the authorized development database reset and app namespace rotation. No migration files are retained.
  - Superseded attempt: the server rejected a userId-based join with JoinNotRefCompatible. The declared profileId reference implementation below replaced it and is now published/verified.
  - Verified revised implementation: nullable membership profileId and explicit profile/memberships relations replace the unsupported userId correlation. Bootstrap links or repairs the personal owner membership using the actual profile ID; future shared membership creation must supply that user’s profileId. After explicit authorization, development data and the app namespace were reset and the schema/policy published successfully. Seven real-server browser tests pass for admin/member/viewer shared reads, avatar bytes, missing links, unrelated/private-workspace isolation, reciprocal revocation on membership removal, named transaction authors, and owner-only edits/ownership-transfer rejection. 43 persistence/bootstrap unit tests pass, including linked-profile reuse and missing/incorrect link repair. All 11 authentication/profile/avatar browser regressions and the offline profile/workspace/attribution browser regression pass (19 relevant browser scenarios total). No migration files are retained.
- [x] T051 After implementation review, add unit and Playwright coverage for attribution, profile permissions, avatar lifecycle, missing-profile fallbacks, and persistence across workspace switches/recovery.
  - Profile-name coverage is implemented and passing. Avatar implementation was reviewed and tests authorized. All 219 unit tests pass, including resizing, initialization/resource cleanup, file/storage validation, and local persistence. A real browser processing check passes large-image resizing, proportion preservation, and no-upscale behavior; it caught a missing Pica initialization call, now fixed and regression-covered. After the authorized pre-alpha development database reset and app namespace rotation, all 11 authentication browser tests pass, including four end-to-end avatar scenarios. No migration files are retained. Both related workspace browser tests pass, including owner-only permission enforcement for avatar writes and rejection of profile ownership transfers. Shared-profile visibility is verified in the T050 notes above.

## Delightful UI Integration Trial

- [x] T052 Create an isolated Finance integration branch/worktree and consume a packed local Delightful UI snapshot with a compatible Svelte peer range.
- [x] T053 Apply the approved global theme and migrate applicable existing controls while preserving native forms, localization and business logic.
- [x] T054 Record evidence-based future component suggestions in code, integration documentation and the active spec/plan.
- [x] T055 Prepare implementation review: packaging/publint, production build, application/service-worker static checks and changed-file formatting pass; isolated preview was verified at http://127.0.0.1:5180 during that checkpoint (not a statement of current server availability). Implementation approved by the user.
- [x] T056 After approval, verify 89 focused unit tests and 27 browser scenarios for form defaults/resets, conditional check fields, workspace/filter state, recovery/restore, modal dismissal, archiving and permissions. Browser-test type checks pass.

## Page Composition Boundary Refactor

- [x] T057 Apply the clarified composition boundary across all pages.
  - Earlier page-specific controller extraction was superseded by the user's clarification: integration logic stays in pages or shared integration components, which compose imported pure components without declaring native HTML.
  - Implementation: moved login/recovery, account list/create, workspace/category/tag settings, transaction detail, and bootstrap/shell workflows into their owning Svelte integration scripts. Removed page-specific controller/query modules and their factory-style state wrappers.
  - Shared TransactionEntry and TransactionView integrations serve income/expense routes without duplicating workflows. Pure form/list/detail/shell components remain separate and receive props/callbacks. The genuinely shared form actor lifecycle remains in forms.svelte.ts.
  - AGENTS.md, constitution v2.1.0, plan, and form documentation reflect the clarified boundary. User explicitly authorized this full batch and immediate tests.
  - Verified: application/service-worker type checks report zero errors or warnings; browser-test type checks pass; all 175 unit tests, 45 workspace browser scenarios, and five authentication browser scenarios pass. Changed-file formatting and diff checks pass. A source audit confirms 12 integration files compose imported components without native body HTML, and no page-specific controller/query modules remain. No commit was made as part of that verification.

## Remaining Authentication Verification

- [x] T058 After reviewing the relevant implementation, add/run authentication network/session failure and retry coverage without replacing the active identity or exposing recovery phrases. Invalid phrase validation and successful recovery are already covered by T016/T050.
  - Verified 2026-10-15: startup and session errors offer retry through a shared XState machine. Restore feedback survives remounts; duplicate submissions/retries are blocked. Jazz owns identity selection and recovery. All 14 focused unit tests and 15 authentication browser tests pass, covering startup/network failures, repeated shutdown failures, selection-storage failures, shared-client errors, and existing recovery/profile flows. Recovery phrases stay out of error output, diagnostics, and URLs. Browser-test TypeScript and Finance static checks pass. See plan.md for details.

## Delightful UI component adoption, second review batch

- [x] Create a separate worktree from committed main for the refreshed UI snapshot.
- [x] Adopt the new components in query feedback, transaction entry, account list, app shell and avatar form; preserve business behavior.
- [x] Prepare static/build/format verification and a separate preview for implementation review. Static/service-worker and formatting checks pass; build compiles but reports the existing dynamic transaction route prerender configuration as a blocker. Preview: http://127.0.0.1:5181.
- [x] After user review, run 110 focused unit checks and eight browser scenarios for money/transaction/form/avatar behavior, table creation, sidebar layout/scrolling, mobile dismissal/focus, workspace navigation, recovery and avatar submission/removal. Browser-test type checks pass. Detailed invalid-field announcement coverage remains a follow-up.
