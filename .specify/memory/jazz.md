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

Before relying on a new policy shape, validate it against the installed Jazz version and its actual
policy test/runtime path. Include both accepted and rejected cases for the precise relationship and
correlation being introduced.
