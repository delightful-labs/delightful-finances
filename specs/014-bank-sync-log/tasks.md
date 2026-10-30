# Tasks: Bank Sync Log

Execute one review cycle at a time. Review gates precede tests for each slice.

## Foundation

- [x] T001 Inspect existing bank persistence, permissions and public history APIs;
      create the implementation plan and dependency-ordered task list.
- [x] T002 Add attempt/account-result schemas, canonical validation and exported
      row types; implement scoped read/insert/settlement policies with immutable
      identities and default-denied retention deletion.
- [ ] T003 Present T002 for implementation review before tests.
- [ ] T004 After approval, add full-app permission/validation coverage, verify
      schema publication and generate the reviewed additive migration.

## Recording

- [ ] T005 Define attempt and result contracts and the logging-owner statechart;
      compose the existing bank operation without duplicating credential/lock
      ownership. Model start failure, cancellation and result-write failure.
- [ ] T006 Extend import result ownership with per-account results and stable
      attempt/account identities; wire local start and terminal persistence.
- [ ] T007 Present recording changes and recursively audit actor helpers.
- [ ] T008 After approval, verify success/partial/failure/cancellation, interrupted
      writes, scope changes, actual financial settlement and no provider retries.

## Retention

- [ ] T009 Implement the retention child statechart and narrow deletion policy:
      sufficient knowledge, candidate selection, atomic child/parent deletion,
      concurrency checks, local settlement and deferred/failure outcomes.
- [ ] T010 Present retention implementation before tests.
- [ ] T011 After approval, verify the 100/101 boundary, tie ordering, unfinished
      protection, other connections, concurrency, partial knowledge and failures.

## Settings presentation

- [ ] T012 Add bounded log queries in BankSyncIntegration, a pure BankSyncLog,
      Bank Sync settings composition and localized labels/feedback.
- [ ] T013 Present mobile/desktop presentation and query ownership before tests.
- [ ] T014 After approval, run focused unit/E2E coverage for outcomes, account
      expansion, paging, reload/offline reads, isolation and logging failures.
- [ ] T015 Reconcile spec acceptance, plan and actual verification results; prepare
      the final review without declaring deferred or blocked checks passed.
