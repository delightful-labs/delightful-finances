# Jazz schema and permission design memory

Read this before designing Jazz data relationships, permissions, or persistence behavior.

## Local usability is independent of remote freshness

Verified against the published `jazz-tools@2.0.0-alpha.59` package and official docs during
[startup research](../../specs/013-local-first-startup/research.md). Recheck source on SDK upgrades.

- Ordinary browser reads default to local data with upstream propagation. `ReadTier.LocalFirst`
  explicitly includes cached records and pending local writes while synchronization continues.
  `LocalFirstUnlessEmpty` can wait for a remote first answer when empty; `Remote` waits offline.
  Neither belongs on a path that must immediately use already available local data.
- Ordinary mutation/mergeable-transaction completion should wait for `local` persistence, with later
  rejection observation retained. `global` means server acceptance. Exclusive transaction `wait()`
  confirms authority acceptance and cannot provide offline completion with a remote authority.
- Server permission enforcement does not require an authoritative preflight for every ordinary
  action. Use current locally known membership/grants and required records; invalidate on observed
  changes. Offline knowledge is not proof of fresh remote permission or erasure after revocation.
- Separate availability from completeness: an empty local result does not establish global absence,
  first use, or permission to recreate/repair records. Keep initialization provenance, repair,
  seeding, and uncertain-write reconciliation from blocking unrelated locally usable finance work.
  Do not remove idempotency safeguards or blindly replace remote reads in recovery/repair workflows.
- Persistent browser Jazz already uses a SharedWorker with IndexedDB; memory-driver and external
  runtime defaults differ. Moving application logic into a worker requires explicit verification of
  local-first reads, supported database access, message boundaries, and lifecycle ownership.
- A service worker cannot construct SharedWorker (Window-only API). Cache public shell/runtime
  assets; do not assume a supported early Jazz handoff, always-running session, or HTTP caching of
  Jazz sync/auth/data. Runtime asset URLs and version identity require a production-build audit.

The linked draft and backlog distinguish desired changes from current implementation and unverified
optimizations. Preserve separately approved online-only sharing/permission administration and explicit
bank-provider operations; those exceptions must not spread into ordinary local finance workflows.

## Reuse proven reference patterns; verify the exact predicate shape

The Check implementation is a working precedent for validating a row's single foreign-key
reference. `transactions.checkId` points to a Check, and `checkReferenceCondition` requires the
referenced Check to match the transaction's organization and account. The permission uses a
positive `policy.checks.exists.where(...)` query with values from the transaction row context.

That precedent does not establish that every cross-row invariant is expressible. In particular, a
single foreign-key existence check is different from comparing two referenced sibling rows to one
another, or from expressing a negative relationship-existence query. Do not infer a Jazz limitation
from a rejected policy until comparing it with the working schema, permission helper, and policy
tests already in this repository. Also do not infer support for a more complex predicate just because
a simpler Check reference works.

Atomic database writes and permission expressiveness are separate questions. An exclusive
transaction may atomically stage and settle multiple rows while the server policy still rejects the
predicate intended to validate those rows. Diagnose the exact policy expression and runtime error
before changing the data model or proposing a different persistence authority.

## Full-policy linked deletion in alpha.59

The production transfer schema uses explicit `s.rel` references from a transfer to both endpoint
transactions. A transaction endpoint must remain undeletable while a transfer row references it,
even after its `internalTransferId` marker has been cleared. Keep the marker-clear write separate;
then delete the transfer row and the selected transaction rows together in the final mergeable
bundle. The full app policy suite verifies this bundle at global durability.

The transfer deletion permission must preserve the same account security as write access to both
endpoints. In the full app, expressing this as two nested `canWriteAccount` predicates did not
settle the linked deletion globally. The equivalent transfer-specific expression—owner/admin or
all-account write access, or a selected-account member with write grants to both endpoint
accounts—settled successfully. Keep the existing insert predicate separate; applying that rewrite
to inserts caused the transfer-link browser flow to be rejected. Reverify both policy paths against
the installed Jazz version before changing either expression.

Before relying on a new policy shape, validate it against the installed Jazz version and its actual
policy test/runtime path. Include both accepted and rejected cases for the precise relationship and
correlation being introduced.
