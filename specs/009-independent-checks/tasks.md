# Independent checks tasks

One focused reviewed slice at a time; no new tests before implementation review.

- [x] Confirm independent Check identity, received/written shared backend and deferred written controls.
- [x] Confirm optional payment method for both income and expense, paired with checkId for Check.
- [x] Investigate negative-existence and reciprocal assignment prototypes; record actual SDK limitations.
- [x] User approved deferring exclusive assignment and staging Check creation before transaction save.
- [x] Remove abandoned assignment schema/helpers and obsolete prototype tests.
- [x] Simplify canonical Check contracts and transaction reference predicate; update staged-save plan.
- [x] Review this simplified implementation before its new tests.
- [x] Test sequential SDK creation, compatible references, multiple permitted references and cross-scope rejection.
- [ ] Verify organization roles and selected-account authorization during root-policy adoption.
- [x] Review a root schema/permission adoption batch; implement and test after review.
- [ ] Resolve shared Check account-movement behavior before implementing dependent moves.
- [x] Review the Check creation resource child, then add/run its settlement and interruption tests.
- [x] Review staged-save-statechart.md and its ownership/recovery protocol.
- [x] Implement and review form checkpoint retention/forwarding, then test after review.
- [ ] Adopt shared canonical transaction values and caller-owned transaction IDs.
- [ ] Implement and review the staged-save coordinator and integrate its children.
- [ ] Test partial failure, stable-ID retries, uncertain settlement, cancellation, scope replacement and offline behavior.
- [ ] Adopt create/edit integration and inline income controls in focused reviewed slices.
- [ ] Add/run browser workflow coverage after review.
- [ ] Reconcile MVP/workflow specs with the final implemented behavior.
- [ ] Perform an existing-environment schema/data transition only when explicitly authorized.

Historical test counts in check-assignment-protocol.md concern rejected models.
The simplified contract has focused runtime coverage as recorded below. Root
application adoption, role authorization and staged workflow coverage remain pending.

Simplified-reference tests: 79 focused tests pass. Coverage includes both kinds,
multiple transactions sharing one Check, direct write payment/reference validation,
missing and cross-scope Check rejection, and direct transaction updates. Static and
format checks pass. Staged persistence effects and retries remain unimplemented.

Root adoption slice for review: composed checksSchema into the application, added
optional transactions.checkId/check relation, and integrated the verified reference
predicate with existing organization/account/category/provenance permissions.
The existing checkDetails workflow remains available until persistence and forms
are migrated; simultaneous checkId and checkDetailsId are rejected. Check scope
is immutable for now; shared-reference account movement remains a separate task.
Root adoption coverage: 29 authority tests pass across root permissions and isolated
references. Tests cover selected-member writes, viewer reads/update denial, scope
immutability, deletion denial, both transaction kinds and incompatible references.
An existing test caught and fixed a manual-income payment-method regression.
The complete role/grant matrix remains pending. Static checks pass.

Check creation resource child: 18 focused unit tests pass. Coverage includes
validation, acquisition/staging/commit/settlement failures, rollback uncertainty,
interruption before staging and commit, draining local settlement, retained Check
identity, and shutdown priority over late cancellation/invalidation and failures.
These are resource-owner tests; they do not verify the pending coordinator, actual
offline synchronization, or browser workflow.

Form checkpoint plumbing: 43 focused tests pass across scoped form ownership,
submission and write handling. Coverage includes partial-result retention and retry
forwarding, interrupted-write propagation, reset/scope clearing, and rejection of a
late checkpoint after a scope change. Prettier and static checks pass.

Shared independent transaction schema and stable creation identity: 97 focused tests
pass across validation and transaction creation. Coverage includes both kinds with
and without Check references, invalid pairings, caller-supplied ID reuse for linked
writes, invalid ID rejection before opening the SDK transaction, and allocation
failure. The existing form path still uses its prior transaction contract; the staged
coordinator has not adopted this schema yet.
