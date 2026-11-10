# Finance application worker handoff

Active execution checklist: [production-worker-cutover.md](production-worker-cutover.md).
Production Jazz startup is the next milestone; the chronology below is supporting evidence.

Status: native host custody implemented and tested; application handoff unfinished.
This branch follows merged Finance PR #66 on main, which incorporates merged
PR #65. The live SDK, domain machines and subscriptions still run in Window.
The draft does not claim the application worker handoff is implemented or qualified.
Main's PR #68 recovery/reconnect fixes and updated DLF artifact are also incorporated.

The approved ownership and behavior requirements remain in
[xstate-v6-migration.md](./xstate-v6-migration.md). The conversion and existing
worker foundations are recorded in
[xstate-v6-finance-implementation.md](./xstate-v6-finance-implementation.md).

## Implementation sequence

- [ ] Qualify native worker termination against queued Window storage writes and
      Web Lock release. Prevent an old host write from running after replacement
      acquires the same account-selection lock. Preserve the installed Jazz
      account namespace, earlier-selection fallback and credential scrubbing.
- [ ] Define the runtime owner chart before activation: starting, running,
      draining, release-blocked and closed, with explicit failure and replacement
      paths. Startup acquires host capabilities, account storage and the SDK in
      order; shutdown closes admission and drains their actual owners before
      disposing ports or terminating the worker. Unknown financial writes remain
      retained until their existing settlement/recovery contracts permit release.
- [ ] Define versioned, bounded schemas for UI intent, projected views, native
      capability requests and receipts. Correlate runtime/account/workspace
      generations and request identities; reject stale A -> B -> A messages.
      SDK objects, live actor references and transaction handles stay with their
      owner. Raw credentials never enter public views or diagnostics.
- [ ] Start the sole Jazz session and application/domain tree in the worker.
      Move workspace authorization, query ownership, validation, operation
      preparation, persistence and settlement behind that owner. Preserve local
      readiness and explicit provider consent.
- [ ] Replace Window SDK/domain integrations with projected subscriptions and
      validated commands for startup/recovery, profiles, workspaces, accounts,
      categories, tags, transactions, transfers, bank sync, backup and restoration.
      Retain DUI interaction and browser-only capabilities in Window: navigation,
      history, WebAuthn, file picking, image/canvas surfaces and PWA UI.
- [ ] Activate the application handoff only after the connected runtime and UI
      boundaries are complete, with one SDK owner and graceful route/root teardown.

## Qualification before ready for review

- [ ] Use published `@xstate/test` campaigns with independent admission, scope,
      cancellation and custody oracles, alongside focused resource integration
      tests. Keep XState and its declarations unpatched.
- [ ] Verify real worker/broker persistence after closing every client and a cold
      restart, including offline writes and a connection that never answers.
- [ ] Verify identity recovery/replacement, workspace switching, multiple tabs,
      membership/grant changes and stale reports.
- [ ] Verify bank consent, idempotent imports, cancellation, financial settlement,
      backup/restoration, native capability failures, lost acknowledgements,
      worker crashes and failed shutdown without abandoning resource custody.
- [ ] Run application/worker/browser-test types, relevant unit/model tests, full
      affected browser flows, formatting and CI. Record exact commands, results
      and remaining qualification limits in this document and the PR.

## Implemented: native account-selection custody

The Window host now holds account-selection Web Locks on behalf of the worker.
Terminating a worker cannot release its lock while Window can still execute
queued storage messages. Host closure removes data admission before releasing
native leases, and native lock release is acknowledged only after the actual
Web Lock request settles. Lock-port disposal alone never releases Window custody.

The existing account-store chart retains its sequence:
lock → read → transform → write → earlier-store scrub → release.
It now accepts the private native-lock adapter, retaining the original storage
namespace, earlier-selection fallback and credential-scrubbing transformations.
There is no second SDK session and no application-worker activation in this batch.

Host storage protocol **v2** requires the exact Window lease UUID on primary and
earlier-store writes. A delayed write cannot use a later acquisition of the same
key. The independent lock protocol **v1** validates version, scope, request UUID,
lease UUID and monotonically increasing sequence. It bounds outstanding leases
at two (primary plus earlier store), rejects replay and restricts lock names to
the captured namespace. Abort cancels pending acquisition; a granted lease stays
held until its callback settles. Native transport failures stay sanitized.

Same-Window replacement also synchronously closes the previous host for the same
origin and account-storage key before admitting its replacement. Stale disposers
cannot unregister the current host. Bindings are copied before native admission.
These adapters perform native operations and resource cleanup; they contain no
financial or identity workflow. They do not acknowledge uncertain financial
writes, roll back completed storage writes, or authorize terminating an SDK owner.

## Focused verification

The user authorized continuing implementation including tests. Verified locally
with Node **24.22.2**, pnpm **10.22.0** and the lockfile-pinned dependencies:

- `pnpm exec tsc --project tsconfig.worker-host.json` — passed, including native
  host/client and browser harness types.
- `pnpm --filter @delightful-finances/worker-state-tests check` — passed.
- `pnpm test:worker-host` — **51 passed**. Coverage includes storage admission,
  stale/replayed writes and leases, cancellation, native callback failure,
  legacy-key scrubbing, immutable bindings, lost ports and host replacement.
- `pnpm test:worker-state` — **20 passed**, including the existing generated
  campaigns and three account-store/Window-host integration regressions.
- `pnpm test:worker-browser` — **3 passed**: Chromium, Firefox and WebKit. Each
  uses real dedicated workers, native Web Locks, isolated browser storage and
  two competing tabs. A worker-issued write is held at Window, the worker is
  terminated, and the replacement remains blocked until Window closes the old
  host. Replaying the old write cannot overwrite the replacement's value.
- `pnpm check` — passed, zero errors/warnings, including service-worker types.
- `pnpm check:tests` and `pnpm check:e2e` — passed.
- `FINANCE_PREVIEW=true pnpm exec vitest run` — **1,955 passed** across 143 files.
- `FINANCE_PREVIEW=true pnpm build` — passed; no deployment performed.
- Focused Prettier and `git diff --check` — passed.

The browser harness starts a disposable Vite server on an available network port,
prints its local/LAN URLs and closes it after the suite. It does not start the
Finance app or touch the user's Jazz replica. CI now runs native host types and
tests plus this three-engine browser regression in a dedicated job.

The first implementation checklist item remains unchecked at application scope:
this qualifies the native account-selection boundary, not a live worker-owned
Jazz session, broker-generation recovery, cold/offline Finance persistence,
financial custody or UI migration. The affected application browser suites have
not been rerun for an activated handoff. The
remaining implementation and acceptance gates above are still required before
this PR can leave draft. No localization or deployment changes are included.
