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
- [ ] Implement and review staged-save statechart and resource ownership, then effects.
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
