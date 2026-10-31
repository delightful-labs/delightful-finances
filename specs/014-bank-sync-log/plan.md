# Implementation Plan: Bank Sync Log

## Scope

Implement spec.md on the current feature branch in focused review cycles. Keep
transaction revision history and system-account display naming as separate work.
Existing manual-only provider requests and passkey authorization remain intact.

## Storage

Add schema/bank-sync-log.ts and register its tables in schema.ts:

- simplefinSyncAttempts: organizationId, connectionId, initiatedBy, startedAt,
  optional finishedAt, outcome, nullable importedCount/existingCount/omittedCount,
  bounded optional failureCode and importSettlement.
- simplefinSyncAccountResults: attemptId, organizationId, accountId,
  accountName snapshot, outcome, nullable counts and optional failureCode.

Attempt outcomes: unfinished, succeeded, partial, failed, cancelled. Settlement:
notStarted, locallyPersisted, confirmed, unresolved. Unknown counts are null;
known zero counts are zero. Use Jazz audit fields for record audit timestamps.
Use stable attempt IDs and one account result identity per attempt/account.
Domain validation lives in validation/bank-sync-log.ts beside derived adapters.
Generate additive migrations only after the schema and permissions are reviewed.
Do not deploy or modify existing financial records.

## Authorization

Attempts require organization/connection ownership consistency. Active
owner/admin membership grants reads; the connection owner with current admin
authority may insert and settle records. Account results inherit their attempt's
scope and require a matching organization/account relationship. Immutable fields
must be checked against the existing record on updates. Terminal transitions
must not reopen or retarget attempts. Initially deny deletion; enable the narrow
retention delete rules with the retention workflow. Account deletion must not
silently cascade away retained history.

Verify exact full-app predicates using the installed SDK before accepting them;
permission publication alone is insufficient. Do not widen general permissions.

## Machine-first gate

The attempt owner performs authorization, start persistence, the existing bank
operation, result classification, terminal persistence and cleanup. Implement
these as explicit states and invoked children, with leaf actors for single I/O
operations. Preserve the existing bank operation's credential and lock ownership.
Inspect new actor helpers recursively for hidden orchestration before review.

State sequence: authorize -> recordingStart -> operating -> recordingResult ->
settled. Explicit alternatives: denied, startFailed, cancelled, resultUnrecorded.
Cancellation while a write is issued drains it before exit; cancellation before
provider fetching prevents the fetch. A terminal log-write failure retains the
financial result and produces separate logging feedback. No automatic retry of
provider work. Pass the existing classified result onward rather than deriving
it again during persistence. Keep per-account counts at the import owner where
the decisions are made; aggregate those results once.

## Retention

Use a separate child statechart: assess authorization -> establish sufficient
completed-history knowledge -> select candidates -> delete related account rows
and parent attempts together -> settle. Keep the latest 100 completed attempts
per connection by finish time and stable ID. Never prune unfinished attempts.
Partial local knowledge or an unanswered authority yields deferred cleanup.
Concurrent deletion must recheck candidate eligibility and preserve the newest
100 completed attempts. Cleanup failures must not change a sync's import result.
Do not promise physical erasure of underlying replica history.

## Presentation and ownership

BankSyncIntegration owns queries and actor binding. A pure BankSyncLog component
receives rows and callbacks; BankSync composes it under Bank Sync settings.
Use DUI Details/Table and Paraglide labels without new decoration. Query a bounded
recent page for the selected connection and explicitly load earlier entries.
Retain latest-result feedback and distinguish empty, loading, failed and partial
history availability. Observed workspace or identity changes invalidate bindings.

## Review and verification

Constitution compliance: local-first ordinary reads/writes; provider activity stays
explicit; no secrets in logs; strict types and no casts/switch statements; machine
ownership before effects; schema and validation names match; translations reuse
shared actions/nouns. Each production slice is reviewed before tests are added or
run. Unit tests cover validation, policies and statecharts; browser tests cover
logs, account expansion, outcomes, reload/offline, isolation and retention.

Use small related batches and the disposable agent server. Save diagnostics per
batch. Record actual results rather than carrying forward results from old source.
No commits or deployments without user authorization.

## Logging actor protocol — implementation review

The standalone createSyncLogMachine receives a stable attempt ID and authorized
organization/connection/user/start facts. It validates and saves the start, then
sends SYNC_LOG_READY to its parent. The parent must not unlock/fetch for that
attempt before readiness. The existing bank operation remains resource owner.

The parent sends FINISH with its classified, drained financial result and safe
failure code. The log actor validates finish timing/counts and saves completion.
Its output distinguishes recorded, notStarted and resultUnrecorded, preserving
the supplied financial result even if completion logging fails.

CANCEL during start persistence drains the write and records cancellation with
no imports; it never signals readiness. CANCEL while awaiting the operation's
result enters a cancelling state and waits for FINISH rather than inventing an
import outcome. CANCEL during result persistence drains that write. The parent
must cancel/drain both actors before stopping them. Invalid input and start/result
write failures are explicit final states. No credentials enter the log actor.

The first implementation contains only the typed protocol and standalone actor;
live operation integration and per-account persistence remain T006. Review this
slice before actor tests are added or run. This actor is not yet user-visible.

### Account persistence extension — implementation review

FINISH now accepts terminal account results alongside the operation's financial
result. Validate all rows and reject duplicate account IDs before any account
write. For each row the state sequence is nextAccount -> identifyingAccount ->
recordingAccount -> nextAccount; only after all rows settle does recordingResult
finish the parent attempt. ID derivation and each individual write are leaf
actors. IDs are derived deterministically from attempt and account identities.

The attempt stays unfinished if account persistence fails; report accountWriteFailed
separately and preserve the financial result. Already saved rows remain attached
to the unfinished attempt. No automatic retry or rollback of imported transactions
occurs. Cancellation during account persistence drains those writes and the final
attempt write, retaining the operation's already-supplied result. These ordered
writes are not claimed to be atomic. The attempt is deliberately finalized last
because account writes require an unfinished parent under the reviewed policy.

Review before extending lifecycle/full-policy coverage for multiple accounts,
stable IDs, duplicate/invalid inputs, write failures and cancellation while an
account row settles. Live operation integration remains outstanding.

## Account-result projection — implementation review

The account import actor now projects one report from its already-classified
terminal result: provider identity, known local account ID/name, counts and import
settlement. Unmapped/unavailable local accounts remain explicitly absent; do not
invent an account identity or a name for an unreadable account.

The multi-account importer appends each drained child's report in the same action
that replaces transient progress with final totals. It returns those reports on
success, failure or cancellation. The operation owner retains and returns them
through its final cleanup; no provider payloads or raw exception messages are
added to the account report. This is payload projection, not a new workflow.

The added report field is optional at existing actor boundaries while their
adapters/fixtures are migrated; production import actors always return an array.
A child that errors without a final report leaves its account details unknown;
the aggregate operation still preserves the existing partial counts/settlement.
Live log creation and account-result writes remain the next wiring slice.

Before running tests, review this four-file slice. Affected coverage includes
bank-sync import/operation tests and fixtures using exact output equality; update
those expectations by inspecting each scenario, and add multi-account assertions
for counts, account-name snapshots, cancellation and late-child outcomes.
