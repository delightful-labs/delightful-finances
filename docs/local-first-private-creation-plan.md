# Private workspace creation: local-first baseline

Fresh feature branches: `feat/private-workspace-creation`, based on Finance main `48b0284`
and Delightful Local First main `c0f9f63`. Previous PRs are merged.

## Startup audit

- The layout configures `initial: 'local-first'`. The shared acquisition adapter delegates directly
  to SDK session creation; it adds no authoritative query or permission preflight.
- Workspace initialization starts with explicit `ReadTier.LocalFirst`. Its existing authoritative
  fallback is conditional on missing initialization provenance. Suspected profile-link repair also
  has an authoritative branch. These safeguards must not be replaced with bootstrap from cache
  absence, nor spread into ordinary locally usable reads or saves.
- Navigation uses local session, catalog, and membership observations. An explicit selected route
  can remain usable while provenance initialization is pending; creation and repair retain their
  separate eligibility rules. Catalog absence is not proof that no remote workspace exists.
- The shared selection workflow receives local facts and owns drain/access decisions, not network
  acquisition. New workspace creation is an explicit operation, never part of session acquisition.
- Existing creation reconciliation explicitly reads LocalFirst; transaction persistence waits for
  `local`. Its schema, starter records, durable attempt identity, and conflict recovery remain
  Finance-owned in the initial extraction.

## Verification of merged behavior

The existing two production cold-start scenarios pass against this exact Finance main snapshot in
an isolated checkout with its own node_modules and generated files. Each closes the browser and its
SharedWorker, preserves the browser profile, clears the HTTP cache, and reopens from the service
worker. One runs fully offline; the other connects to a real proxy that never answers. Both read
retained transactions, save edits, reload, create an account locally, and reload the saved account.

These checks establish that the tested foreground paths do not require a remote response. They do
not measure a startup latency budget, cover every partial replica, or establish the cause of the
reported slowdown. SDK background connection activity can start concurrently; the requirement is
that local usability must not await its response. No performance improvement is claimed yet.

The isolated production preview was http://127.0.0.1:4185; test-owned services and browser profiles
were disposable. The user's development server and persisted data were not changed.

## Next review boundary

The library's first private-creation batch defines a resource-owning local transaction workflow.
It does not replace Finance's creation actor yet. Its implementation review is approved; all 22 focused
statechart cases and the built-package consumer checks pass. Qualify the Jazz leaf adapter next
and adopt only the additional-workspace transaction seam. Keep the
organization, owner membership, and starter categories atomic; do not introduce a server preflight,
exclusive transaction, global wait, or navigation inside creation. Unknown settlement must retain
its journal and original IDs for reconciliation before retry.

## Finance adoption implementation model

The additional-workspace path becomes creation form → operation/journal → persistence/reconciliation
→ Finance result adapter → shared transaction owner. Factories bind the database once at the
creation owner. Runtime database references are not serialized into the durable draft/journal.

The shared child owns open → readLocal → guarded eligibility → stage → commit → persistLocal,
including rollback and retained commit/settlement during CANCEL/SHUTDOWN. The Finance adapter has
one invoked child and maps its finite output back to the current domain result. Its Jazz leaves
only acquire the mergeable transaction, read one related local snapshot, stage the unconditional
organization/membership/category bundle, commit, wait locally, or roll back. Pure eligibility
returns profileUnavailable or conflict. The owner routes those outcomes; no branching async
workflow is hidden inside an adapter promise. Bootstrap keeps the existing native statechart.

The current journal already identifies an attempt by its organization UUID. The shared operation
ID uses that same UUID; stable workspace/membership/category IDs and the journal format do not
change. The parent still reconciles before retry and never selects/navigates as a creation effect.

Affected tests for the implementation review: workspace-creation fixture, persistence, operation,
and form-machine unit suites; new real-policy adapter coverage; multiple-workspace creation,
offline journal recovery, cancellation and identity/scope replacement browser scenarios. Update
factory imports/mocks and inspect local-tier expectations before executing these after approval.

## Adoption review status

Implemented the Finance-owned Jazz adapter and database-bound creation/operation/persistence
factories. Only additional-workspace persistence invokes the shared transaction owner; native
bootstrap remains unchanged. Existing journals keep their payloads and UUIDs. The schema,
permissions, UI, strings, route policy, and startup acquisition are unchanged.

The updated local package snapshot is
`vendor/delightful-local-first-0.0.0-private-creation.tgz`, SHA-256
`6130f25fb5c02514d0258ec062e3734d6d858ab290db7d29af19fe4d2be99f14`.
It contains the reviewed transaction core with its 22 passing library cases and public-consumer
qualification. The superseded selection archive is removed, and both manifest and lockfile point
to the new archive. No application dependency versions are changed otherwise.

Production-only Svelte/TypeScript checking passes with zero errors and warnings in the isolated
checkout; the production app/service-worker build also passes. Existing unit fixtures still import the retired static operation/persistence exports;
the normal combined source/test check is not qualified until those fixtures and mocks are migrated
after implementation review. No Finance adoption tests have been added or run for this change yet.

The recursive audit finds no hidden async decisions: related local reads are one leaf; staging is
unconditional after pure eligibility; commit, local durability, and rollback remain individual
operations under the shared statechart. The wrapper only forwards interruption to the live invoked
child and translates its terminal result. A closing/cancelled invocation retains the transaction
until rollback or issued commit/local persistence finishes. Unknown results retain the existing
journal/reconciliation path rather than issuing a new attempt.
