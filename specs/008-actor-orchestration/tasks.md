# Deferred actor orchestration tasks

The workspace phase (W001–W012) is complete, reviewed and verified. Its ownership, contracts and
cleanup model are documented in [plan.md](plan.md) and the
[workspace architecture](../006-multiple-workspaces/plan.md). Completed implementation checklists
and historical test-count logs are omitted.

The tasks below remain unimplemented. Retaining them is not authorization to start a broader refactor.
Each subsystem needs its own audit and implementation review, followed by approved relevant tests.
Bank orchestration has been resumed. D001's source audit is recorded in
[bank-audit.md](bank-audit.md); implementation scope remains subject to review.

## Resumed: bank orchestration — focused review cycles

- [x] D001 Audit the bank tree's ownership, actor contracts, snapshot coupling and resource lifetimes; record which boundaries to retain, merge or change (FR-014). Source audit complete; no runtime verification claimed.
- [ ] D002 After separate scope approval, improve bank command/status contracts and responsibility boundaries identified by D001. Preserve credential disposal, explicit user initiation and actual cancellation semantics (FR-014).
      The reviewed setup persistence settlement slice is implemented and verified in
      [setup-settlement.md](setup-settlement.md). Mapping transaction ownership,
      operation/import draining and availability reports remain unfinished.
- [ ] D003 Review that implementation, then verify cancellation, identity/scope replacement, partial results, observer errors, provider request races and resource cleanup (FR-014).

## Deferred: generic form orchestration — do not implement now

- [ ] D004 Audit scoped-form availability/submission/write/completion composition, forwarding wrappers, snapshot copying and shutdown ownership (FR-014).
- [ ] D005 After separate scope approval, implement only justified form boundary changes; retain original write scope and independently owned completion effects (FR-014).
- [ ] D006 Review that implementation, then verify permission changes, input/reset/cancellation, submitted writes, completion failures and unmount draining (FR-014).

## Deferred: application/session supervision — do not implement now

- [ ] D007 Audit root/session attachment, retry, observer failure, replacement and supervision contracts beyond the minimal workspace boundary wiring (FR-014).
- [ ] D008 After separate scope approval, implement justified supervision changes with explicit live/completed/failed dependent handling (FR-014).
- [ ] D009 Review that implementation, then verify startup acquisition, observer failure, session retry, replacement races and application teardown (FR-014).

## Deferred: inspection and architecture follow-through — do not implement now

- [ ] D010 Design opt-in actor-system inspection of lifetimes and event causality with sensitive payloads excluded (FR-015).
- [ ] D011 After separate scope approval, implement and review diagnostics; then verify correlation and absence of credentials/private payloads (FR-015).
- [ ] D012 Reconcile lessons from completed subsystem audits into orchestration memory and remove only abstractions demonstrated to be redundant. Record final ownership diagrams and remaining exceptions (FR-013–FR-015).
