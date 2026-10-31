# Tasks: Bank Sync Log

Execute one review cycle at a time. Review gates precede tests for each slice.

## Foundation

- [x] T001 Inspect existing bank persistence, permissions and public history APIs;
      create the implementation plan and dependency-ordered task list.
- [x] T002 Add attempt/account-result schemas, canonical validation and exported
      row types; implement scoped read/insert/settlement policies with immutable
      identities and default-denied retention deletion.
- [x] T003 Present T002 for implementation review before tests (user approved commit and continuation).
- [x] T004 After approval, add full-app permission/validation coverage, verify
      schema publication and generate the reviewed additive migration.

T004 progress: eight focused validation/full-policy tests pass, and SDK validation
accepts all 22 tables. The full-policy harness publishes the schema and policy to
its disposable test authority. Tests exposed optional-count decoding receiving
null; fixed by making the underlying column optional before its transform and
validating nullable numbers in both directions. The user approved and committed
the fix as d9dbb48. Generated the additive c9feba2ff2a5 -> e5a4d82f6013 migration:
only the two log tables are added; all 20 existing table definitions are unchanged.
The migration awaits focused review. No deployed environment was changed.

## Recording

- [x] T005 Define attempt and result contracts and the logging-owner statechart;
      compose the existing bank operation without duplicating credential/lock
      ownership. Model start failure, cancellation and result-write failure.

T005 progress: standalone logging actor/protocol reviewed and committed as
be8e18d. Eight lifecycle tests and six canonical validation tests pass. Covers
readiness, invalid start, start-write failure, cancellation while start/result
writes drain, awaiting the operation's actual cancelled result, ignoring late
replacement results, terminal-write failure and invalid completion timestamps.
Type checking passes. Parent integration/per-account recording remain T006;
these tests do not establish that live sync is logged yet.

- [x] T006 Extend import result ownership with per-account results and stable
      attempt/account identities; wire local start and terminal persistence.

T006 progress: account-result projection reviewed and committed as 5f1e287.
All 52 focused operation, import-settlement and logging lifecycle tests pass.
Assertions cover first/repeated multi-account sync counts and account names,
and cancellation with settled versus unresolved account writes. Exact operation
failure outputs explicitly include empty account reports. No production changes
were needed in this verification cycle. Start/terminal/account-result persistence
is not wired into live sync yet; that remains the next focused slice.

- [x] T007 Present recording changes and recursively audit actor helpers.
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

- [x] T012 Add bounded log queries in BankSyncIntegration, a pure BankSyncLog,
      Bank Sync settings composition and localized labels/feedback.
- [x] T013 Present mobile/desktop presentation and query ownership before tests.
- [ ] T014 After approval, run focused unit/E2E coverage for outcomes, account
      expansion, paging, reload/offline reads, isolation and logging failures.
- [ ] T015 Reconcile spec acceptance, plan and actual verification results; prepare
      the final review without declaring deferred or blocked checks passed.

Account-persistence review: implementation committed as 3af1ffd. Nineteen
logging-lifecycle/validation cases pass, including ordered multi-account writes,
ID stability/separation by attempt, duplicate/invalid input rejection, failed
account writes and cancellation while a row settles. Three full-policy cases
also pass, including the real logging actor saving account results before its
parent attempt becomes terminal. These checks do not constitute live bank sync
integration; the existing operation still needs to invoke and drain the actor.

Live-wiring progress: persistence coverage committed as 66115cf. The composed
logged-operation actor and captured raw-operation identity input are implemented
and type-check cleanly; awaiting review before lifecycle tests and supervisor
registration. The existing live supervisor still invokes the raw operation.

Composed actor verification: implementation committed as 22f8857. Six focused
composed-operation tests pass with the real import/operation chain and controlled
log writes. Covers start-before-fetch ordering, failed start preventing lock/
credential/provider work, cancellation draining start persistence, cancellation
waiting for an issued import and retaining its final count, cleanup before final
logging, final-log failure preserving successful imports, and discovery bypassing
logging. Supervisor registration and logging-failure presentation remain pending.

Supervisor registration progress: composed tests committed as f7c3953. Production
supervisor now selects the logged actor and renders safe logging-failure feedback;
connection-scoped late-result handling and nested operation metadata are wired.
This slice awaits implementation review and integration verification. History UI,
retention and deployment remain outstanding.

Live integration verification: registration committed as c4e772a. All 93 focused
unit/full-policy cases pass across seven suites. Two strengthened bank-sync
browser scenarios pass against the disposable agent server (48 seconds): no
attempts after setup/discovery, partial attempt plus two account-result rows,
second attempt on explicit repeat sync, and persisted cancellation without late
response imports. Expected provider-error console messages belong to the tested
failure scenario. No production changes were needed in this verification cycle.
History presentation and retention remain outstanding; no schema deployment ran.

Settings presentation review: bounded connection/workspace-scoped queries now live
in BankSyncIntegration and subscribe only on the Bank Sync settings route. A pure
BankSyncLog renders expandable attempts and account results, localized outcomes,
initiator names, nullable counts, safe failure reasons and distinct local/remote
settlement labels. Starts with 20 attempts and offers earlier entries; paging
resets when the user/workspace/connection scope changes. Implementation awaits
review before focused presentation/E2E tests. Retention and deployment remain
outstanding.

Settings viewer verification: implementation committed as fe4b89f. Both focused
bank-sync browser scenarios pass (34.5 seconds), covering empty history,
partial/success account expansion and counts, initiator display, failure with
unknown counts, persisted cancellation, reload reads, warm offline reads,
20-to-24-entry paging, pagination reset on reload, unfinished-attempt wording,
other-connection exclusion and containment at a 390px viewport. No provider
requests occur while reading/paging/reloading history. Test TypeScript,
formatting and diff checks pass. Cross-workspace switching, cold offline startup
and injected logging failures are not established by these two browser cases;
T014 remains partially verified. Retention and schema deployment remain pending.
