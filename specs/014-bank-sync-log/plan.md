# Implementation Plan: Bank Sync Log

## Scope and ownership

Persistent connection-level Bank Sync attempt history, per-account results,
settings presentation and fixed retention. Transaction revision history and
system-account display naming remain separate features. No provider request,
passkey prompt or financial mutation is triggered by viewing or retaining logs.

The bank supervisor composes `createLoggedBankOperationMachine`. Its raw bank
operation retains ownership of credentials, Web Locks, imports and cleanup.
`BankSyncIntegration` owns foreground Jazz queries and the independent retention
coordinator. `BankSyncLog` is a pure presentation component with data/callback
props, native disclosures and localized labels. No new custom CSS properties.

## Persistence and permissions

`schema/bank-sync-log.ts` declares `simplefinSyncAttempts` and
`simplefinSyncAccountResults`; `validation/bank-sync-log.ts` owns canonical
validation. The additive migration creates only these tables. Existing financial
records are unchanged. Attempts use stable IDs, and account-result IDs are
stable derivations of attempt/account identity. Counts distinguish null from zero.
Persist bounded failure codes, never raw exceptions, provider payloads or secrets.

Current owner/admin membership permits organization-scoped reads, including other
users' connection logs. Only the connecting owner with current admin authority
can create or settle attempts. Organization, connection, initiator, start and
account identities are immutable. Account results require an unfinished matching
parent and a local account in the same organization. Terminal records cannot be
reopened or edited. Deletion is restricted to completed, finished attempts owned
by the current admin user; account-result deletion inherits that permission.
The fixed cap is enforced by the exclusive workflow, not an unsupported policy
aggregate. No manual edit/delete/replay controls are exposed.

## Logging statecharts

Composed operation: capture identity -> prepare authorization -> save start ->
wait for readiness -> existing bank operation -> drain its cleanup -> classify
safe log completion -> save account results -> save terminal attempt -> return
financial result with separate logging outcome. Only explicit SYNC commands log;
setup, discovery and disconnect retain existing behavior.

Logging child: validate start -> record start -> await actual operation result ->
validate completion/accounts -> derive account ID -> save account (repeat) ->
finalize attempt. The terminal attempt is saved last because account writes need
an unfinished parent. Start failure prevents provider work; completion failure
preserves actual financial results and leaves readable unfinished history.

Cancellation drains issued start/account/final writes. While the operation owns
imports, logging waits for its actual drained result rather than inventing
rollback or settlement. Scope replacement and shutdown preserve the existing bank
owner's drain protocol. Unknown account identities are not fabricated. Unexpected logging-actor errors
are contained: before provider work they prevent startup; during an operation
they preserve its resource owner and continue draining, including cancellation.
The final financial result is returned with separate unavailable-log feedback.
Safe provider/passkey/mapping failure codes are projected from the existing classifier.

## Retention: knowledge before mutation

Retention is independent of sync, starts for an observed owned connection, and
also handles a selected retained connection owned by the current user. Its
coordinator chooses -> works -> idles, retries after 60 seconds, and handles
replacing/closing by cancelling and draining the existing child before rebinding
or final shutdown. Offline/no-access observations disable cleanup. Integration
teardown sends SHUTDOWN; it does not abruptly stop an open transaction owner.

The transaction child performs:

1. Check observed identity and authority-read membership/connection ownership.
2. Authority-read completed history ordered by `finishedAt desc, id desc`.
   At most 100 needs no mutation or transaction acquisition.
3. Authority-read every account result for attempts older than the newest 100.
4. Open one exclusive transaction and recheck membership/connection locally.
5. Read completed history locally within the transaction; require exactly the
   authority-observed attempt IDs, otherwise defer and roll back.
6. Select the older attempts, read their account rows in the same transaction,
   and require exactly the authority-observed account-result IDs.
7. Recheck observed identity, stage all child/parent deletes, recheck identity
   again, commit once and await authority acceptance.

Terminal rows and account results are immutable under the production policy, so
matching identities also preserve ordering and contents. Exclusive read conflict
checks and atomic commit protect concurrent cleanup. Unfinished attempts and
other connections are excluded. No local count is treated as global completeness.

This authority/local boundary is required by browser verification on alpha.59:
the same history query returned 101 outside a browser transaction at Remote tier
but zero inside it at Remote tier. Acquisition outside followed by LocalFirst
transaction rechecks passes browser and full-policy tests. Do not substitute an
empty transaction Remote read for sufficient history knowledge.

Each authority/local read has a bounded deadline. Before commit, cancellation,
timeout, missing knowledge, authorization loss or staging failure rolls back any
acquired transaction. Commit is issued once. Its wait drains to actual acceptance
or an explicit unresolved deadline; the latter does not claim deletion, rollback
or financial failure. Later cleanup re-queries rather than replaying provider work.
Deletion removes normal records; it promises no physical erasure of replica or
backup history.

## Settings presentation

Subscribe only on Bank Sync settings, scoped to the selected workspace and
connection. The selector includes disconnected connections and other users'
connections permitted to the current owner/admin. Labels show connection time,
owner and status without UUIDs or credentials. Read initiator names with a safe
unavailable-user fallback.

Fetch 20 attempts plus a lookahead row, load another 20 explicitly, and reset the
limit on user/workspace/connection changes. Scope-filter retained subscription
values before rendering. Expand an attempt and each account for timestamps,
counts, outcome, safe failure reasons and import settlement. Unfinished means
final result unknown; locally saved is distinct from confirmed remote acceptance.
Explain local history availability and that pre-feature syncs were not logged.
Preserve existing latest-result feedback and separate logging-write errors.

## Verification and rollout

The user authorized the remaining implementation and verification in one final
slice. Tests inspect current schemas, permissions, actor protocols and locators.
Focused unit/full-policy coverage checks validation, recording, financial results,
resource drain, authorization, partial knowledge, timeouts, retention boundary,
stable tie ordering and concurrency. Browser coverage checks live log records,
account expansion, paging/reset, connection/workspace isolation, mobile containment,
log-write failures and integrated background retention without provider requests.
A production-build persistent-profile test covers cold restart with an open but
unanswered authority and full offline history reads.

Record final outcomes in `verification.md` and tasks.md. Validate the schema and
existing additive migration; publish schema/permissions through the normal release
process. No production schema deployment is part of these local verification runs.
