# Jazz schema and permission design memory

Read this before designing Jazz data relationships, permissions, or persistence behavior.

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
