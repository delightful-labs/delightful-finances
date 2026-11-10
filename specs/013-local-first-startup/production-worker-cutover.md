# Production Jazz application worker cutover

Updated: 2026-11-10. This is the active execution checklist for PR #67.

## Current truth and immediate priority

**Production Finance still starts Jazz and its application/domain root in Window.**
`src/routes/+layout.svelte` creates `createApplicationReadinessMachine`, calls
`getJazzStartupBinding`, and mounts `JazzSessionProvider`. Worker integration tests
exercise a separate runtime. Their passing results do not prove production migration.

The next milestone is moving this actual production entry point to the existing
application worker. Do not defer that milestone behind further generic transport
or optional feature work. Keep the complete feature migration in scope, but prove
production ownership before calling subsequent feature adapters production-ready.

Existing implementation/evidence history is in
[xstate-v6-worker-handoff.md](xstate-v6-worker-handoff.md). Its chronological
checkpoints are supporting evidence, not the execution order or completion checklist.

## Clipper implementation inspected

Reference checkout: `/Users/matt/Projects/worktrees/delightful-clipper/worker-runtime`,
branch `feat/worker-runtime`, HEAD `7541e18` at inspection. The default Clipper
checkout is a different branch; these observations refer specifically to this worktree.

- `apps/web/src/routes/+layout.svelte` imports `integrations/Application.svelte`
  instead of the old `Account.svelte` implementation.
- `integrations/Application.svelte` opens `openApplicationClient` on mount, puts a
  worker client in Svelte context, renders projected account/recovery views, and
  posts scoped commands. It does not create the Jazz application in Window.
- `runtime/worker/client.ts` creates the module worker and storage/broker channels.
  Its native lifecycle chart requests shutdown and waits for the owner's CLOSED
  receipt before disposing native resources.
- `runtime/worker/application.worker.ts` builds `accountInput` and starts
  `workerHostMachine`; the host owns the application/library/recovery graph and
  publishes render views. `runtime/worker/context.ts` exposes the client, not a DB.

Apply that ownership pattern to Finance using its existing worker runtime and
unpatched XState v6 APIs. Do not copy Clipper's domain models, older XState authoring
syntax, or replace Finance's stricter custody/backpressure safeguards blindly.

## Milestone 1 — actual production entry point

- [x] P001 Inspect Clipper's actual layout, integration component, worker client,
  worker entry point and UI context. Record the exact checkout above.
- [x] P002 Verify Finance's actual production startup and distinguish it from the
  worker harness. Inventory reachable SDK/context consumers before changing ownership.
- [ ] P003 Replace production layout startup with `FinanceWindowConnection` and
  `createFinanceWindowRuntime` (or a thin production integration component composing
  them). Bind route observations and native lifecycle on mount; retain the existing
  account namespace and persisted identity. Mount exactly one application SDK.
- [ ] P004 Move startup, workspace/shell admission, navigation and recovery controls
  to worker views/intents. Remove the Window application actor, startup binding,
  `JazzSessionProvider`, restoration adapter and direct SDK session context from the
  served layout. Preserve PWA admission/update behavior and native WebAuthn bridging.
- [ ] P005 Rebind every SDK consumer reachable from the new production shell and its
  migrated routes. Reuse existing WorkerAccounts, WorkerOverview/ledger and transaction
  adapters. Do not leave a second SDK/provider available to satisfy old consumers.
- [ ] P006 Run a browser test against the **normal SvelteKit root and real routes**.
  Make the test fail if Window starts the Jazz client/application root or performs
  domain queries. Prove usable local startup and reads/writes through the worker.
- [ ] P007 Close every client and reopen the normal app with the remote withholding
  replies; prove the same persisted identity and data. Verify honest shutdown,
  route changes, worker failure, and a pending write without early termination.

Milestone 1 is complete only with evidence from the served production layout.
The `/__worker_runtime` harness alone cannot close P003–P007.

## Remaining production feature integrations

Initial SDK/context consumers found in routes/components include account and login,
workspace settings/creation/bootstrap, category/tag settings, transaction creation
and editing, internal transfers, saved transaction images, sample transactions,
recovery and developer diagnostics. Extend this inventory with an import-graph audit;
a text search is not proof of complete removal.

- [ ] P008 Complete workspace lifecycle, identity/profile/login/recovery/settings
  integrations and mutation-rejection feedback using worker-owned workflows.
- [ ] P009 Complete bank connection, consent, history, import, reconnect and provider
  controls without moving crypto/SDK/provider orchestration back into Window.
- [ ] P010 Complete attachment preview/download/removal and image-selection/editor
  ownership. Preserve native file/canvas/display capabilities and real drain semantics.
- [ ] P011 Complete backup/restore file handling, independent deletion, checks and
  sample-data operations through scoped commands and bounded views.
- [ ] P012 Finish and qualify worker-owned new transaction-tag drafts, bounded
  suggestion IDs and paging. The current in-progress slice has focused unit coverage
  and a Chromium harness pass; it is not fully qualified or production-mounted.
- [ ] P013 Remove obsolete Window domain/query/session integrations and temporary
  legacy branches once their production consumers are migrated. Preserve all existing
  financial operations and canonical validation; do not hide missing features to claim
  migration complete.

## Release gates

- [ ] P014 Audit queued storage writes/account-generation fencing and subscription
  cleanup, including failed unsubscribe, cross-tab account replacement, late replies
  and retained unknown financial outcomes.
- [ ] P015 Run appropriate model/unit tests, all production-route browser flows,
  cold/PWA cases, worker/host/Svelte type checks and production build. Verify the built
  Window import/runtime boundary and worker assets, not only source conventions.
- [ ] P016 Review the complete diff, reconcile this checklist with evidence, commit
  and publish/update PR #67, and verify CI. Leave unfinished requirements unchecked.

The full migration is finished only when P003–P016 are verified. There is no claim
that the production application is currently off the UI thread.
