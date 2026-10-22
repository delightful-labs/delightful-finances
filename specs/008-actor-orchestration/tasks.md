# Actor orchestration tasks

Checkboxes distinguish implemented work from pending review/verification. Documentation creation and static checks do not establish runtime verification. Follow [plan.md](plan.md); the user authorized workspace implementation as a single review batch. Current scope is W tasks only. The subsequent instruction to fix failing tests authorized their migration and execution after the combined implementation review. Deferred D tasks remain unchecked when workspace work is done.

## Current: workspace orchestration

- [x] W001 Review the first-cycle integrity report protocol, invalidation/generation rules, statechart and affected files before implementation (FR-001, FR-002, FR-006). Design reviewed through the user’s continue instruction; see [workspace-integrity-report.md](contracts/workspace-integrity-report.md).
- [x] W002 Implement typed binding/generation-specific integrity reports and public view; remove readiness's full integrity snapshot and private-context dependency. Preserve partial-repair policy and bank command protocol (FR-006, FR-009).
- [x] W003 Present W002 for implementation review; after approval, add/run focused tests for stale reports, authority changes, A → B → A, partial results, failures and draining (FR-002, FR-008, FR-012).
- [x] W004 Review and implement public initialization status reporting; assess startup/creation/integrity wrappers by resource lifetime before merging or retaining them (FR-004, FR-006, FR-010).
- [x] W005 Present W004 for review; after approval, verify identity replacement, initialization failure/retry and creation recovery/settlement (FR-008, FR-010, FR-012).
- [x] W006 Review and implement workspace-owned navigation and a single access decision boundary; replace Svelte translation of private readiness internals with observation wiring (FR-001, FR-003, FR-007).
- [x] W007 Present W006 for review; after approval, verify explicit invalid scope, legacy resolution races, management without selection, tabs/history and loss of access (FR-002, FR-003, FR-012).
- [x] W008 Review and implement workspace attachment independent of bank presentation, with explicit identity-wide versus selected-binding lifetimes. Limit application/bank edits to required boundary wiring (FR-004, FR-005).
- [x] W009 Present W008 for review; after approval, verify no-bank startup/management, selection-independent creation, attachment replacement and shutdown (FR-004, FR-005, FR-008, FR-012).
- [x] W010 Audit the complete changed workspace actor tree recursively for hidden orchestration, private-child dependencies, duplicated policy, stale reports, impossible acknowledgements and teardown bypasses (FR-001–FR-011).
- [x] W011 Following implementation approval, finish relevant unit/browser regressions, static checks and production build; record actual evidence and outstanding limitations separately from prior feature verification (FR-011, FR-012).
- [x] W012 Mark the workspace phase complete only after its acceptance criteria pass. Leave every unimplemented deferred task unchecked and link the next recommended task (FR-013).

## Deferred: bank orchestration — do not implement now

- [ ] D001 Audit the bank tree's ownership, actor contracts, snapshot coupling and resource lifetimes; record which boundaries to retain, merge or change (FR-014).
- [ ] D002 After separate scope approval, improve bank command/status contracts and responsibility boundaries identified by D001. Preserve credential disposal, explicit user initiation and actual cancellation semantics (FR-014).
- [ ] D003 Review that implementation, then verify cancellation, identity/scope replacement, partial results, observer errors, provider request races and resource cleanup (FR-014).

## Deferred: generic form orchestration — do not implement now

- [ ] D004 Audit scoped-form availability/submission/write/completion composition, forwarding wrappers, snapshot copying and shutdown ownership (FR-014).
- [ ] D005 After separate scope approval, implement only justified form boundary changes; retain original write scope and independently owned completion effects (FR-014).
- [ ] D006 Review that implementation, then verify permission changes, input/reset/cancellation, submitted writes, completion failures and unmount draining (FR-014).

## Deferred: application/session supervision — do not implement now

- [ ] D007 Audit root/session attachment, retry, observer failure, replacement and supervision contracts beyond the minimal workspace boundary wiring (FR-014).
- [ ] D008 After separate scope approval, implement justified supervision changes with explicit live/completed/failed dependent handling (FR-014).
- [ ] D009 Review that implementation, then verify startup acquisition, observer failure, session retry, replacement races and application teardown (FR-014).

## Deferred: inspection and architecture follow-through — do not implement now

- [ ] D010 Design opt-in actor-system inspection of lifetimes and event causality with sensitive payloads excluded (FR-015).
- [ ] D011 After separate scope approval, implement and review diagnostics; then verify correlation and absence of credentials/private payloads (FR-015).
- [ ] D012 Reconcile lessons from completed subsystem audits into orchestration memory and remove only abstractions demonstrated to be redundant. Record final ownership diagrams and remaining exceptions (FR-013–FR-015).

## Workspace completion and verification

The user reviewed the workspace implementation batch and then authorized test migration/execution. All workspace tasks are complete. The [plan’s batch entry](plan.md#workspace-implementation-batch--review-entry-point) records the final ownership tree and contracts.

- Related unit suite: **198 tests across 15 files pass**, covering initialization, integrity, creation/recovery/persistence, navigation, attachment supervision, rename and transaction completion.
- Public-protocol cases cover stale generations and mismatched bindings, A → B → A during repair draining, membership loading/error/role changes, explicit retry, usable/blocked partial integrity, unresolved write settlement during shutdown, obsolete initialization reports, pending attachment cancellation and duplicate attachment handling.
- Workspace browser suite: **12 flows pass**, covering duplicate-named isolated creation, recovery/retry/reload, warm offline creation, independent tabs/history, input discard, legacy details, required-only repair, lost access, journal failures, actual server authorization, one management link, copied scoped URLs, and malformed/duplicate explicit scope.
- Existing rename, sidebar navigation/session persistence and overview browser regressions: **3 pass**, including the existing Svelte ownership-warning assertions.
- Full `pnpm check`: **zero errors and warnings**, including service-worker TypeScript.
- Browser TypeScript (`pnpm check:tests`): **passes**.
- Formatting and whitespace checks: **pass**.
- Production compilation passed for the reviewed implementation batch; no production source changes were needed during this test migration.

Test doubles now implement typed request/report contracts instead of publishing private state tags. Tests use native page paths and `?workspace=` URLs, the single `/settings/workspace` management route, and current shared message labels. The former 45 static test errors are resolved. Tests run against disposable in-memory Jazz storage; no persistent development data or servers were changed.

This records relevant workspace verification, not a claim that the entire application or production PWA suite was rerun. Earlier feature-006 query-migration follow-ups remain tracked there. All D tasks remain deferred and unchecked. The next optional orchestration task is **D001**, a separately authorized bank-tree audit; do not start it automatically.
