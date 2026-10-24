# Independent checks: implementation plan

Status: user approved staged creation and deferred exclusive assignment.
Branch: `feat/independent-checks`.

## Records and permissions

A Check has its own ID, organization/account authorization scope, number/date and
optional existing metadata. `transactions.checkId` references that Check. Both
income and expense use the same structure; direction follows transaction kind.
Payment method is optional for both kinds, with method Check and checkId required
together. Written-check controls remain deferred.

There is no check-assignment table or reciprocal ownership pointer. Multiple
transactions may reference a Check. Insert/update permission predicates require
the referenced Check to exist in the same organization/account and preserve the
payment/reference pairing. Integrating policies must enforce organization/account
read/write authorization. Detached Checks remain scoped to their account.

The failed negative-existence and reciprocal assignment candidates are historical
research in check-assignment-protocol.md. Their prototype code and obsolete
publication-only/blocked tests have been removed. Prior pass counts do not verify
the simplified reference predicate. Add new positive authority coverage only after
this implementation review.

## Machine-first save design

Staged saving is an explicitly approved change to the former atomic-creation
requirement. It is a workflow with independently committed effects, partial failure
and cleanup, so its implementation must start with a statechart.

```text
transaction integration: subscriptions and SDK dependency binding
  existing scoped form/submission owner
    staged Check + transaction save owner
      focused Check persistence child when needed
      existing transaction/tag persistence child
```

The staged owner retains IDs and observed settlement results. Leaf actors perform
one read or SDK operation; persistence children retain their transaction resource
through open/read/guarded checks/stage/commit/settle/rollback states. Do not put the
staged orchestration into a promise callback or commit the Check/transaction through
an unmodeled sequence of helpers.

```text
validate draft -> fresh scope/authority assessment -> assess Check selection
  existing compatible Check -> retain Check ID
  new Check -> allocate stable ID -> persist Check -> await local settlement
retain Check ID -> persist transaction and tags atomically -> await local settlement
  -> succeeded

Check failure before commit -> failed
transaction failure after Check save -> partial (Check retained)
uncertain issued write -> reconcile using stable IDs -> succeeded | partial | unresolved
RETRY from partial -> reassess authority and Check -> retry transaction with same Check
CANCEL / scope invalidation / shutdown
  -> drain issued operation and settle/rollback its resource
  -> cancelled | scopeChanged | closed, retaining the actual saved Check result
```

Generate the transaction identity once too. An uncertain transaction commit must
be reconciled before retry, preventing a duplicate ledger entry. Partial retry
retains the Check ID in the active form/save owner; reload recovery is not promised
without a separately designed durable draft. Do not automatically delete a saved
Check on transaction failure. Cancellation before Check persistence creates no
record; after persistence it may leave an authorized detached record.

Local settlement is not global acceptance. Verify ordered remote settlement for
separate Check and transaction writes and late rejection handling. Avoid turning
ordinary saves into authority-dependent operations. Existing Check metadata edits
also need explicit partial results if committed before a failed transaction update.

## Focused implementation cycles

1. Simplify shared schema/validation/reference predicates and feature artifacts;
   remove abandoned assignment prototypes. No live adoption or actors in this slice.
2. After review, test sequential direct SDK creation/reference writes, valid and
   invalid payment pairing, missing/foreign Checks, both transaction kinds,
   multiple permitted references and account/viewer authorization.
3. Adopt root schema/permissions in a small reviewed batch, keeping the alpha-data
   transition as a separate authorized action. Discuss any inseparable larger batch.
4. Implement the staged save statechart and resource ownership before effects;
   adopt create/edit readiness and persistence in focused reviewed cycles.
5. After each review, test partial failure, retry without duplicate Check/transaction,
   uncertain settlement, cancellation, scope replacement, shutdown and offline use.
6. Adopt inline income Check controls using existing presentation/localization
   conventions; test the user workflow after implementation review.

Account movement needs a reviewed decision because a Check may now have several
references. Do not auto-move its account scope when editing a single transaction.
Keep the existing-check selector/catalog scope in review until persistence is sound.
No data reset, deployment, commit or new written-check visual control is included.

## Root schema and permission adoption review

Three implementation files: schema.ts, schema/transactions.ts and permissions.ts.
The root app now composes Checks, exposes optional transaction.checkId/check,
and authorizes Check reads/writes through existing organization/account decisions.
Metadata updates preserve Check organization/account, and deletion is denied to
protect existing references. Transaction permissions compose reference compatibility
with category/account/kind/provenance invariants. Legacy checkDetails references
remain supported during the staged form conversion, but cannot coexist with checkId.
The detail query and current UI still use the existing detail workflow.

This is a declarative schema/policy change. It adds no actor, async helper, acquired
resource or hidden orchestration. After review, verify actual root authority
publication, role/grant behavior, missing/foreign references, optional methods for
both kinds, multiple references, metadata/scope rules and existing legacy workflows.
The isolated 79-test result is not proof of the newly composed root policies.
No environment data reset, schema deployment or staged-save effect is included.

Generated TransactionRow types also require mechanical checkId:null additions in
five existing fixture/test files. No test cases or workflows are added by those
fixture adjustments; they keep the additive schema adoption type-safe.
