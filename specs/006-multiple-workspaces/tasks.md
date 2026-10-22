# Remaining create-and-switch batch

User authorized all remaining initial-release implementation and verification in one batch. This supersedes per-cycle review pauses for this batch; future sharing/ownership/archive features remain deferred. No commits, deployment, or persistent data changes are authorized.

- [x] Finish integrity lifecycle tests, scoped feedback, retry and dependent-action gating.
- [x] Implement IndexedDB journal resource statechart and creation reconciliation/owner.
- [x] Integrate reusable creation presentation and workspace chooser without automatic switching.
- [x] Implement scoped URL helpers/rerouting and navigation statechart, including legacy detail resolution.
- [x] Derive workspace scope from URL; preserve independent tabs/history; discard unfinished transaction inputs and retain submitted write scope.
- [x] Cover authorization, recovery, offline creation, lost access, duplicates and multi-workspace navigation with unit/browser tests.
- [x] Pass relevant static checks, focused regression suites and production build; align spec/plan/contracts with final behavior.

## Verification

- Static application/Svelte/service-worker checks: zero errors and warnings.
- Browser TypeScript: passes.
- Full unit suite: 723 tests across 58 files pass.
- Isolated workspace browser suite: all 9 scenarios pass, including actual server acceptance/denial, lost membership, required-only integrity repair, recovery, offline creation and independent URL scope.
- Existing rename/sidebar/overview browser regressions: all 3 pass.
- Production build: passes with disposable Jazz configuration.
- Production PWA suite: all 10 pass, including scoped offline reload, direct/reloaded transaction detail, cache boundaries and multi-tab updates.
- Completion review retained statechart ownership recursively; promise leaves contain no read/check/write orchestration.

The initial release is create-and-switch only. Future sharing/capabilities, invitations, ownership administration, archive and account merge remain deferred. Changes are uncommitted on feature/multiple-workspaces; main, production and persistent development data are unchanged by this batch.

## Query-parameter migration — current review

The verification counts above apply to the prior prefix implementation. They do not establish coverage of the query migration or subsequent message cleanup.

- [x] Replace workspace prefix parsing with explicit browser-only query scope and generic reusable query utilities.
- [x] Keep native routes, update all link callers and current-link detection, and simplify service-worker lookup.
- [x] Preserve workspace switching, history, original write scope and full-URL race handling; align the current specification/contract.
- [ ] After implementation review, update unit/browser assertions and cover generic parameter preservation/removal/encoding, invalid/duplicate scope, sidebar links, pagination, independent tabs/history, query-only races, input discard and production offline reload.

Migration implementation checks: `pnpm check` passes with zero errors/warnings; `FINANCE_PREVIEW=true pnpm build` passes, including prerendering and the service-worker build. Formatting and whitespace checks pass. No unit/Playwright tests were added or run for this migration before implementation review.

Shared-link implementation: AppLink now centralizes configured parameter inheritance; presentation anchors and UI-library pagination use it. Ordinary callers supply native page paths; explicit workspace selection supplies a query override. Review coverage must also include new-tab/copy behavior, same-origin versus external/download links, explicit overrides/removal/opt-out, repeated values, forwarded anchor attributes, existing link styles and pagination semantics. No tests have been added or run for this increment before review.

Shared-link static validation: `pnpm check` reports zero errors/warnings and `FINANCE_PREVIEW=true pnpm build` passes, including prerendering. Existing anchor styling was preserved through selector changes for child-rendered anchors. Unit/browser verification remains pending review.

Workspace page consolidation: one Settings sidebar link now opens `/settings/workspace`, combining chooser, selected-workspace rename and creation. Workspace-list selection stays on that page; `/settings/workspace` is the only workspace management URL; the temporary `/workspaces` route and redirect have been removed. Existing scoped rename authorization and persistence are reused unchanged. This increment awaits implementation review before tests.
