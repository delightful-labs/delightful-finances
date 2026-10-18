# Merge code audit against the ordinary copy workflow

## Decision

Reuse the working data transformations and domain decisions. Consolidate redundant
owners before connecting the full workflow. The target remains read source ->
validate/save copy -> connect destination -> prepare/preview -> insert additions.
No Jazz changes or globally coordinated source snapshot are required.

This is a source/import-reference audit, not runtime verification. No production
code or tests were changed or run for this audit.

## Current reachability

The `/account-merge` page runs `presentation.ts`, which mounts
`AccountMergeDestinationIntegration.svelte` and its destination machine on Check.
That check examines the currently signed-in workspace, not a separately connected
destination. It is temporary demonstration UI, not the first step of a real merge.

Capture has a concrete integration component but is not mounted. Journal and
preview/preparation are exercised by tests but are not connected to the merge page.
Preview already composes references -> mapping, conflict classification and dependency
checks; those children are not separate user-facing flows. Receipt schema/policies
are registered in the application. No coordinator or destination importer exists yet.

## Consolidate or replace

| Current code                                                 | Proposed change                                                                                                                                                                                            | Behavior that must survive                                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `machines/account-merge/presentation.ts`                     | Replace with the real coordinator when wiring the route; remove the CHECK-only statechart and its selector. Do not retain two roots tracking the same merge phase.                                         | Session/workspace observations, stale-result protection, explicit cancel/shutdown, localized views.                                                                       |
| `machines/account-merge/journal-write.ts`                    | Fold write-policy states into `journal.ts`, then delete this child. The public journal commands already constrain creation, origin and destination changes.                                                | Guarded decisions stay visible in XState; storage owns actual commit/abort settlement and atomic compare/write. Preserve destination binding and immutable saved source.  |
| `machines/account-merge/references.ts`                       | Combine allocation and rewriting into one preparation machine, reusing/refining `mapping.ts`; then delete the wrapper. Keep the pure `account-merge/references.ts` transformation.                         | Deterministic IDs, system-category reuse, provider canonical IDs, exact foreign-key rewriting, typed failures and cancellation.                                           |
| Capture and destination integration components               | Share the repeated session/workspace subscription binding when the coordinator integration is wired. Retain distinct source local-first and destination authority queries.                                 | Integration owns subscriptions; scope/client changes invalidate work; child cleanup precedes stopping owners. Do not add a generic framework merely to share a few lines. |
| `components/AccountMerge.svelte`, route wiring, translations | Evolve into source counts, capture confirmation, connection, preview and result views. Remove the standalone destination-check panel and obsolete capture-unavailable messages as their replacements land. | Keep `/account-merge` isolated from login/navigation; opening the route performs no writes or identity replacement.                                                       |

The journal and preparation changes can be separate small review cycles. Their
existing tests reference internal child actors, so approved coverage must move to
the retained public behavior rather than preserving deleted layers for tests.
Page tests should likewise evolve from the temporary Check interaction to the real
copy workflow. Keep existing authorization and resource-cleanup coverage.

## Keep

| Code                                                            | Reason it still serves a normal copy                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Snapshot schema/validator and capture machine                   | Select known fields, preserve values, reject invalid relationships, produce the saved source copy. Capture is currently untested and still needs approved coverage.                                                            |
| Journal public machine, storage machine and native IDB adapters | Preserve data across identity replacement/reload. Storage owns resources and resolves cancellation racing a commit; this is different from choosing a journal command.                                                         |
| ID allocation and pure reference transformation                 | New rows need new IDs and correct account/category/tag/check links. Stable IDs also make retries recognizable.                                                                                                                 |
| Preview, conflict and dependency machines plus pure helpers     | Preview additions, recognize previous copies, avoid overwriting destination edits, and block children whose dependencies cannot be copied. Per-record equality and graph dependency decisions have different responsibilities. |
| Typed origin receipts and permissions                           | Remember a previous copy even if its destination row was later edited or deleted; deterministic IDs alone do not remember a deleted row.                                                                                       |
| Canonical validators and derived TypeScript types               | Validate untrusted stored data and machine boundaries. Reusing a schema across boundaries is not duplicate validation logic.                                                                                                   |

The eight typed receipt tables are an SDK relationship-policy constraint of the
existing implementation, not eight new workflows. The legacy `mergeOrigins` table
has no operational merge use, but remains in the additive migration chain with
all access denied. Removing it requires a deliberate schema/migration cleanup;
do not delete published migration history as part of this runtime consolidation.

## Remove obsolete assumptions

There is no implemented whole-database freeze/barrier subsystem to delete. The
unnecessary requirement lived primarily in planning text and UI messages.
`capture-contract.md` already replaces it with local-copy semantics, but older
sections of `data-model.md`, `plan.md` and `lifecycle.md` still mention completeness
gates. Update those sections alongside the affected consolidation, so they do not
reintroduce a global snapshot prerequisite. Retain checks for malformed references,
wrong identity/workspace, write authorization, and local versus server acceptance.

## Proposed review order

1. Consolidate journal command/write policy; retain the storage resource owner.
2. Consolidate allocation/reference preparation; retain conflict/dependency children.
3. Wire the real coordinator and source-copy views, replacing the temporary
   presentation root and check-only UI in the same change. Discuss the file set
   first if this exceeds the normal focused review scope.
4. Connect normal destination writes using the prepared IDs and existing policies.

After each implementation review, update and run only its relevant approved tests.
Do not add another readiness or presentation machine while these consolidations
are pending. New machines need a distinct domain responsibility, not another
copy of a parent workflow's lifecycle.
