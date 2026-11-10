# Finance application worker handoff

Status: draft implementation tracking. This branch follows merged Finance PR #66 on main,
which incorporates merged PR #65. The live SDK, domain machines and subscriptions
still run in Window. This document opens the follow-up PR; it does not claim the
worker handoff is implemented or qualified.

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

Only this tracking document is changed in the opening commit. No runtime code,
localization or production deployment is included. The draft remains unfinished
until the implementation and qualification above are complete.
