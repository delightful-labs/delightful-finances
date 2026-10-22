# Mapping transaction ownership

Scope: account write, its new transaction child, account creation, mapping, unlink,
and the operation's mapping state. Six production files; review before adding/running tests.

The existing commit promise is a workflow: open a transaction, read provider links,
decide whether creation is already satisfied, read destination/account, validate,
choose account/link writes, commit, and await persistence. It must become a machine.

Ownership:

```text
operation (holds bank lock)
└── mapping
    ├── account write
    │   └── transaction (owns one mergeable transaction)
    └── account creation
        └── account write
            └── transaction
```

The installed Jazz `Transaction` supports explicit `beginTransaction`, reads and staged
writes across awaits, `commit` returning a write handle, and asynchronous `rollback`.
`Db.transaction` uses the same mergeable transaction API; no transaction kind change
is intended. `rollback` cannot run while commit is pending. A write handle's local
wait can reject; that does not establish rollback. SDK sources inspected:
`runtime/db.js` (`Transaction`, `runInTransaction`, `Db.beginTransaction`) and
`runtime/client.js` (`WriteHandle.wait`).

Statechart before effects:

- Parallel control region: active → cancelling → closing, with shutdown taking
  precedence and no late event reopening work.
- Work region: open → read provider links → guarded duplicate/existing-creation
  checks → read destination/account → guarded conflict/account eligibility checks
  → choose/stage account creation → choose/stage link insert/update → commit → settle.
- Each acquisition/read/stage completion checks interruption before starting the next
  effect. Each promise performs one leaf operation. No promise chooses write policy.
- Existing creation needs no write; close that transaction through rollback and return
  unchanged. Policy/read/staging failures also roll back before returning.
- Cancellation before commit waits for the current leaf, then rolls back. Cancellation
  during commit or settlement waits for actual settlement. Failed settlement attempts
  rollback to release a transaction that the SDK may still retain after commit failure;
  failed/unconfirmed rollback remains unresolved.
- Finite outcomes: succeeded, unchanged, failed, cancelled, closed. Settlement facts:
  notStarted, rolledBack, locallyPersisted, unresolved. Terminal states publish once.
- Account write consumes child output, keeping existing `Result<undefined>` contracts
  for mapping callers. Cancellation maps to the existing disconnected result. The
  transaction output retains exact settlement for subsequent protocol improvements.
- Mapping and creation forward cancellation only to their live owned write workflow.
  Operation's mapping invocation survives working/cancelling/failing substates. A
  later lock failure cannot override cancellation; a lock failure must still wait for
  mapping cleanup. No acknowledgement is requested after child output/error.

Keep preflight authorization and existing eligibility checks; repeat transaction-time
checks on the same transaction snapshot before writes. Preserve atomic account/link
creation, deterministic IDs, existing-creation idempotency, original scope and current
mergeable transaction semantics. No new retry/provider request behavior.

Unlink has no open transaction; cancellation during its issued-delete wait enters a
draining substate and retains that invocation until output/error. It does not start
another delete after cancellation. The mapping owner retains that finite child,
rather than stopping it and claiming rollback. Import, disconnect, and outcome
persistence cancellation remain separate work.

## Implementation review

Implementation is ready for review. `pnpm check`, focused Prettier and
`git diff --check` passed. No tests added or run for this implementation yet.

The recursive actor/helper review found no hidden read/check/write orchestration:
all new effect actors open, read, stage one chosen write, request commit, wait, or
request rollback. The destination/account query pair is one related snapshot read.
`resource`, `linkWrite` and `required` only transform/narrow inputs; the create-stage
input invariant repeats a guarded kind decision. Existing authorization and preflight
policy remain unchanged, and transaction-time policy repeats those checks on the
owned transaction before staging.

Callers inspect child liveness only when forwarding interruption. They do not inspect
private transaction state or wait for a second acknowledgement after output/error.
Operation owns the cancellation/failure intent and its lock lifetime; transaction owns
rollback/settlement. The agent server used for the prior review was stopped before
the static check; the user's persistent environment was untouched.

After approval, verification should cover duplicate/provider/destination conflicts,
missing/archived/foreign accounts, existing creation and account reuse, insert/update
choices, cancellation during open/read/staging/commit/settlement/rollback, failed or
unconfirmed rollback, lock failure/cancellation priority, already-finished children,
unlink settlement, and the complete operation→mapping→creation→write→transaction
chain. Browser checks should retain existing explicit creation/remapping/unlink and
idempotency behavior. Static checks do not establish these runtime properties.
