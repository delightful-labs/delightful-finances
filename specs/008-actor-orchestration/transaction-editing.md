# Transaction editing ownership

Status: implementation reviewed and verified. The editing slice of D005/D006 is complete;
avatar preparation remains unfinished.

## Model before effects

The edit integration is the only production caller of `data.ts:updateTransaction`. Its callback
transaction hides queries, eligibility decisions, updates, tag reconciliation, check-detail checks,
commit and settlement. Replace it with one resource-owning machine invoked by the existing scoped
form write boundary. Jazz binding, subscriptions and teardown remain in the integration/controller.

```text
edit integration → scoped form → submission → prewrite readiness → edit persistence
                                                                └── one Jazz transaction

validate → open → read transaction → eligibility → read relationships → check details
         → plan tag/row changes → stage → commit → local settlement → succeeded
```

Each precommit stage has an interruption gate. Retain acquisition and reads until they resolve;
then rollback on cancellation, scope replacement or shutdown. Retain rollback until it settles.
After commit is issued, drain local settlement. Preserve interruption priority and report actual
settlement: no acquisition is `notStarted`, confirmed precommit rollback is `rejected`, successful
local settlement is `locallyPersisted`, and false/rejected rollback or postcommit failure is
`unknown`. Separate success, failure, cancelled, scope-changed and closed final states clear inputs
and resources. Creation and editing remain separate domain owners; no generic transaction framework
is needed merely because their SDK cleanup protocol is the same.

## Guarded invariants and planning

- Read the captured transaction ID in the owned transaction before any mutation. Reject missing,
  imported, wrong-workspace or wrong-kind rows. Preserve the existing restriction against check
  payment conversion and moving an existing check to another account.
- Read tag links, scoped tags (including archived tags) and check details as one related snapshot.
  For check input, require exactly one details row matching the existing `checkDetailsId`.
  Non-check input must have no check-detail rows. These are guarded transitions before staging.
  The read adapter converts synchronous query throws into rejected reads and awaits all issued
  queries with `Promise.allSettled` before propagating failure. Its result unwrapping is SDK error
  handling, not another business eligibility decision.
- Plan retained/removed/new tag assignments without writing. Preserve unresolved historical links.
  Retain explicitly selected historical names, including archived assignments; only new assignments
  require an unambiguous active tag or a newly planned tag. Preserve existing tags' categories.
- Compute normalized transaction updates, optional check updates, deletions, new tag IDs and link
  inserts before staging. Keep organization/kind/source identity and check-link invariants intact.
  Check edits retain optional payer/bank/check-memo metadata under existing behavior.
- Stage the decided changes in the same transaction, then commit once and await the SDK handle's
  local settlement. Promise actors perform individual reads/effects or pure preparation; they must
  not hide read/check/write callbacks or another orchestration workflow.

The installed Jazz begin/commit/rollback semantics were inspected for the creation slice and apply
to the same SDK here. Commit can reject through its handle; cancellation cannot undo an issued
write. Fresh shared form readiness still checks submitted intent and original scope before the
resource owner starts. SDK authorization continues to enforce actual writes.

## Focused implementation scope

1. New `src/lib/machines/transaction-edit-persistence.ts`: domain checks, planning and resource owner.
2. `src/lib/machines/transaction-entry.ts`: separate edit/create composition functions using the shared
   readiness policy, while retaining existing edit draft comparison and creation navigation.
3. `src/lib/components/TransactionEditEntry.svelte`: invoke edit composition with the bound database.
4. `src/lib/data.ts`: remove the obsolete update workflow and its now-unused imports.

The implementation was reviewed before coverage was added or run. Relevant verification covers
historical tags, ambiguity, check invariants, atomic staging, acquisition/read interruption, rollback
and settlement failures, scope changes and offline repeated edits. Creation tests remain relevant
because composition shares the domain policy; avatar preparation stays separate.

## Implementation review

The four-file production migration is implemented. Create/edit form factories now have separate
typed persistence dependencies while sharing the same readiness/schema composition. The edit
integration supplies its bound database; there is no production update promise callback or manual
actor bridge. Original draft equality, historical baseline conversion, retained form success and
creation navigation behavior remain in their existing boundaries.

Recursive actor/helper review found validation and planning to be synchronous transformations,
the relationship read to be one fully drained SDK snapshot read, and staging to materialize an
already-decided write plan. Transaction acquisition, current-row read, guarded eligibility,
relationship read, guarded check compatibility, planning, staging, commit, settlement and rollback
are visible stages. No write is staged before all domain checks succeed.

## Approved verification

The former `updateTransaction` helper cases now test the real edit persistence machine, using a
shared SDK-effect fixture and typed transaction/relationship rows. The old callback-transaction test
scaffolding was removed. Form tests now use the separate edit factory with the bound database.

All 336 relevant unit tests pass across 16 files. After correcting fixture metadata types, a focused
rerun of the two changed machine-test files passed all 88 cases. Coverage includes archived and
unresolved assignments, ambiguity for new names versus retained historical names, ineligible tag
reuse, normalized updates, check conversion/account restrictions, missing/duplicate/mismatched check
details, retained optional check metadata, precommit cancellation, acquired-resource retention,
rollback failures, postcommit settlement, shutdown priority and original transaction-ID invalidation
through switching away and back. Both rejected and synchronously thrown relationship-query failures
are verified to wait for the other issued reads before rollback.

`pnpm check` passes with zero errors/warnings. `pnpm check:tests`, Prettier and `git diff --check`
also pass; the former fixture diagnostics are resolved. No production fixes were needed during
verification.

All 32 relevant Playwright checks pass on disposable in-memory Jazz storage: nine form-presentation
checks, eight transaction-edit checks and 15 transaction-workspace checks. These cover repeated
offline edits, reverted drafts, archived-tag retention/removal, check details and payment-conversion
restrictions, read-only historical transactions, plus desktop/mobile creation, cancellation,
pagination/reload and repeated offline sample batches. Creation and shared-form regressions were
included because both composition factories share readiness/schema policy. No browser assertions
needed changes in this cycle.
