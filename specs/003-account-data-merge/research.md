# Research and decisions

## Session replacement

Evidence: `src/routes/login/+page.svelte` calls `session.restoreLocalFirst(secret)` directly. Installed `jazz-tools/dist/session/state.js` shuts down the old client with `waitForSync: true` before selecting/opening the new identity. Its type contract provides no AbortSignal for restore. `dist/accounts/persistence.js` retains known local roots, but the app exposes no account chooser.

Decision: capture source before restore, keep coordinator outside the workspace subtree, and rebind all destination dependencies. Never retain an old db handle for post-switch imports. Cancellation must await/reconcile session replacement. Offline account switching may fail waiting for synchronization; preserve a retryable snapshot. Source retention is not a user-facing recovery mechanism until a supported source-selection action is implemented.

Alternative: maintain concurrent authenticated clients or transfer source organization ownership. Rejected for initial design: more lifecycle complexity, expanded sharing semantics, and a result that is a second workspace rather than a combined personal ledger.

## Data and permissions

Evidence: `src/lib/schema/` defines organization-scoped accounts/categories/tags/transactions/check details/batches and attachment references. `src/lib/permissions.ts` prevents inserting archived accounts, disallows protected system-category updates and requires active transaction references. File tables currently deny access. `src/lib/data.ts` hydrates before workspace initialization and provides stableUuid. Bank import derives transaction IDs from destination organization and canonical externalId in `src/lib/machines/bank-sync/import-transaction.ts`.

Decision: copy the supported graph with deterministic identities, map system categories by kind, preserve manual duplicates and canonical provider identity, detect attachments before writing. Recreate archive flags after dependent history where policies permit; source graph inconsistency is an explicit failure, never silent omission. Never relax authorization generally to make imports work.

## Recovery and secrets

Decision: use a versioned IndexedDB source snapshot + journal, bound to source and destination; persist no recovery phrases, root secrets, passkey material, provider ciphertext or Access URLs. Re-enter phrases for source/target recovery if the SDK exposes no supported secret-free selection. Source raw data remains unchanged. New row audit authorship belongs to the importing user; store explicit source provenance.

Alternative: memory-only snapshot rejected because reload loses recovery; exporting raw credentials rejected because merge does not need them.

## Readiness and concurrency gates

Decision: destination absence requires supported hydration/sync evidence; local empty reads and navigator.onLine are insufficient. Implementation cycle 1 must inspect the installed SDK for exact read guarantees, shutdown failure behavior and existing account selection APIs. Cross-tab lock precedes snapshot/switch/import, with stale ownership recovery after tab termination. Finance editing in sibling tabs must be blocked or cause source revalidation before snapshot finalization. Resume imports the immutable captured snapshot, not a changing source dataset. No network API or new dependency is selected at planning time.

These are explicit implementation feasibility checks, not unresolved user preferences. Failure of a check stops the dependent implementation for review.

## Exact SDK read/write tiers

Installed SDK inspection confirms `ReadTier.Remote` reads the current remote query scope but excludes pending local writes; `ReadTier.LocalFirst` includes local knowledge and pending writes. Source capture must reconcile remote hydration and local pending records by identity, or use a confirmed source sync barrier followed by remote hydration. Conflicting versions must not be merged by arbitrary array order. Destination planning likewise includes remote scope and pending local writes; `LocalFirstUnlessEmpty` alone is insufficient.

Write handles support `.wait({ tier: 'local' })` for device persistence and `.wait({ tier: 'global' })` for server acceptance. Model globally confirmed success separately from locally saved/pending synchronization. A server rejection after local acceptance must leave a recoverable partial/failed result, not permanent success.

## XState error handling at the IndexedDB boundary

Research sources: [invocation error handling](https://stately.ai/docs/invoke),
[callback actor error reporting](https://stately.ai/docs/actors),
[promise actor errors and cancellation](https://stately.ai/docs/promise-actors),
[IndexedDB transaction lifecycle](https://www.w3.org/TR/IndexedDB/), and
[abort exceptions](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/abort).
Also inspected the installed XState callback implementation and actor error/stop
paths; this is source inspection, not runtime verification.

Findings:

- Invoked actor failures belong in `invoke.onError`; promise rejection and actor
  startup errors do not need to be manually translated by broad orchestration catches.
- Errors in actions fail their machine rather than becoming a recoverable error
  transition in that same machine. Moving throwing effects into entry actions is
  not an error-handling fix. Async actions are not awaited.
- Native event handlers run outside the actor's processing call. XState cannot
  automatically catch their exceptions. Callback actors must send typed error
  events, while promise adapters must explicitly reject on native failure.
- `fromPromise` is suitable for one bounded I/O operation, not as a wrapper hiding
  the journal lifecycle. Stopping its actor discards its result; cancellation must
  still settle a possible commit before reporting no writes.
- IndexedDB requests must execute while the transaction is active. Keep the atomic
  comparison/mutation synchronous in a request callback; splitting its steps into
  arbitrary awaited effects can invalidate the transaction.
- `abort()` can throw `InvalidStateError` after commit/abort. This is a platform
  race, not a domain decision. Preserve a narrowly justified boundary handler and
  obtain the actual outcome from native commit/abort events.

Initial audit result: `journal-storage.ts` lacked `invoke.onError` on the native
connection and transaction children. Those paths are required before relying on
XState for their failures. Merely removing local catches would leave a missing failure
transition. Installed callback actor error/stop code also does not justify assuming
that every thrown failure runs the callback disposer; explicitly owned cleanup is
still necessary after resource acquisition.

Implemented correction (awaiting review): pre-acquisition actor failures now use
`invoke.onError`. A synchronous open failure goes directly to failure because no
connection exists and the failed child cannot acknowledge CLOSE. Transaction
acquisition failure goes through connection closing. The blanket open catch and
transaction-acquisition catch have been removed.

Three catches remain specifically at native boundaries: request setup after a
transaction is acquired (abort and await acknowledgement), the later request
callback/atomic mutation (same cleanup), and abort racing a finished transaction.
They do not orchestrate business decisions. Commit and abort acknowledgements
still determine the actual persisted outcome. No generic catch helper or actor
created solely to hide catch syntax was added. TypeScript/format checks apply;
tests for the revised implementation still require review approval.
