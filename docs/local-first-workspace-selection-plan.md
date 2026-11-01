# Shared workspace selection: Finance adoption

Status: implemented on `plan/workspace-lifecycle`; qualification is blocked by transfer recovery.
The shared selection package is integrated and normal switching/recovery checks pass. A real locally
persisted transfer can remain unacknowledged remotely, leaving Jazz identity restoration waiting.
Keep the PRs draft until this is resolved; this document does not certify release readiness.

## Ownership

The library owns selected-workspace eligibility, lease invalidation, request/epoch correlation, and
its exact drain handshake. It does not choose routes, create workspaces, import Finance schemas,
initialize financial records, or call SDK identity mutations.

Finance retains Jazz subscriptions, organization/member policy, initialization, creation and
reconciliation, bank operations, transfer mutations, integrity, routes, and navigation. This slice
changes no persisted schema, permissions, localization catalog, CSS, or user-facing component design.
Existing Finance data needs no migration.

The application supervises these independent lifetimes:

- A selection attachment binds one shared actor to a captured database/client, identity, and
  application attachment. It retains that actor until finite completion before replacing it.
- The workspace coordinator consumes library leases. Identity-bound initialization, navigation,
  and creation survive ordinary selected-workspace changes.
- Selected resources own bank/retention and integrity work. Their terminal output supplies cleanup
  evidence; component unmount and actor liveness do not prove release.
- The transfer mutation owner retains issued operations through commit and settlement, rejects
  queued old-scope requests, and acknowledges exact scoped drains without terminating itself.
- A finite drain join combines selected-resource and transfer-owner evidence for one library token.

## Observation and lease protocol

WorkspaceBootstrap owns SDK subscriptions and dependency binding. It sends raw target facts to the
application's observation adapter; it does not construct a second SDK session. Locally observed
membership must match both target and identity. Empty/loading/failed directories are independent
facts, never an extra target-access gate or proof of revocation. Unknown target facts cannot grant
access. Explicit denial and observation failure remain distinct outcomes.

Selection attempts and observation generations advance monotonically. Fresh attachment tokens
prevent A -> B -> A and same-client restoration from reusing an old lease. Both transfer integrations
capture the original request scope at actor construction. The application validates that scope
against the current lease, database, identity, workspace, and globally increasing transfer generation.
Late requests and reports cannot acquire the replacement workspace's authority.

## Exact resource drain

1. Library invalidation immediately removes the usable lease and closes new scoped action admission.
   Finance retains the latest requested target while the old scope drains.
2. The application captures the library's exact drain token and old lease. It requests old selected
   resources and transfer work to shut down independently; neither leg may impersonate the other.
3. Issued writes remain retained through local settlement and cleanup. Cancellation does not erase
   a committed write. A bank import cancelled after confirmed local persistence is retained business
   progress, not cleanup failure; unresolved writes or logging still prevent clean release.
4. The join accepts finite evidence from both legs, including explicit absence of acquisition and
   already completed owners. Preclosed resource evidence enters the join as input, avoiding a late
   message to an immediately completed actor. Old tokens and foreign scopes are rejected.
5. Only the matching combined result acknowledges release to the library. Failure requires explicit
   recovery; unresolved ownership cannot authorize replacement or certify clean shutdown.
6. The next allowed library lease attaches the next selected-resource lifetime. Generic pending
   attachment does not bypass the shared decision.

Identity retry/restoration additionally waits for actual finite coordinator completion and shared
selection release. The coordinator's terminal-entry `WORKSPACE_CLOSED` notice is informational;
only its correlated dynamic completion proves release. The transfer owner stays alive while
selection requests its scoped drain. SDK calls already issued stay retained until they settle.

Route-local form/image actors retain their existing old-scope checks and independent shutdown.
This slice does not claim a root acknowledgement for every historical route actor or migrate all
Finance actor ownership into the library.

## Qualification

The integrated handoff previously passed 191 distinct focused unit cases and 16 browser scenarios.
The final cancellation correction adds two bank-owner cases; the focused four-file rerun passes
216 cases (49 bank, 73 application, 47 coordinator, 47 drain join). Source/service-worker checking
reports zero errors/warnings; browser-test types and browser-scope validation pass.

Real held-write browser checks retain the acknowledgement only after actual SDK local persistence.
They do not replace the database with a fake. Bank import switching and recovery and transfer
switching pass: issued source writes persist exactly once, destination work cannot mount early,
and restoration cannot start before application release. No stopped-actor assertion was removed.
The final combined browser run and GitHub CI results belong in the PR; local results do not imply
that every application/PWA scenario has been rerun.

Five production cold-start/remote-boundary checks pass in an isolated checkout with its own
dependencies and generated environment:

- Cold local reads and saves with an open remote that never answers.
- Cold local reads and saves with the browser offline.
- Local saves after a negotiated connection stops answering.
- Later real server rejection after a locally successful stale-authority write.
- Bank history surviving cold unanswered/offline restarts without provider fetches.

These use retained browser storage, cleared HTTP cache, all clients/SharedWorker closed before
restart, the production service worker, and the real local Jazz authority. They do not establish
remote acceptance of an unrelated pending transfer.

## Blocking transfer-recovery result

The retained regression is `retains an issued transfer write through workspace recover` in
`tests/transfer-create.e2e.ts`. Local persistence completes and the application correctly waits for
its deliberately held acknowledgement before calling SDK restoration. After release, the SDK
enters `restoreLocalFirst` but remains transitioning rather than reopening the workspace within the
existing assertion deadline. No timeout was raised and no expected-failure/skip annotation was added.

An isolated browser probe bypassing all Finance workflow actors reproduced the remote boundary:
ordinary account insertion and a simple account transaction received global acknowledgement;
a three-row transaction inserting both transfer endpoints and their link persisted locally but
its global wait neither resolved nor rejected within the same 15-second deadline. Pre-acknowledging
fixture accounts and using SPA navigation did not resolve the application regression.

The installed Jazz `2.0.0-alpha.59` session implementation calls client shutdown with
`waitForSync: true` before restoration, and that shutdown waits for pending writes at global tier.
This explains where recovery waits; it does not prove whether the underlying cause is SDK handling,
the existing transfer permission graph, or their interaction. Local success must not be relabeled
server acceptance, and identity replacement must not bypass pending-write synchronization.

Next: reduce the paired-write/permission reproduction and fix or obtain an SDK correction, rerun the
retained recovery regression, then require green CI before merging either PR. Shared private
workspace creation remains the next extraction after this gate, with Finance-specific schemas,
financial starter records, and reconciliation journals retained by the host.

The known disposable agent server is http://127.0.0.1:5184. User development servers and persistent
browser/Jazz data were not changed.
