# Tasks: Bank Sync Log

The user requested the remaining implementation and verification together in one
final slice. Earlier foundation/logging/viewer cycles were separately reviewed
and committed. Final-slice changes remain available for review before commit.

## Foundation

- [x] T001 Inspect persistence, permissions and history APIs; write spec and plan.
- [x] T002 Add attempt/account schemas, canonical validation and scoped policies.
- [x] T003 Present foundation for review.
- [x] T004 Verify validation and full-application permissions.
- [x] T005 Generate the additive migration and snapshot; preserve existing tables.

## Recording

- [x] T006 Implement stable attempt/account identities, per-account import reports,
      start persistence before provider work and completion after actual cleanup.
- [x] T007 Present recording changes and recursively audit actor helpers.
- [x] T008 Verify financial result preservation, start/result failures, cancellation,
      issued writes, scope changes, unexpected logging crashes and no provider retry.

## Retention

- [x] T009 Implement authority knowledge acquisition, exclusive local rechecks,
      atomic child/parent deletion, cap/tie rules, cancellation and deferred outcomes.
- [x] T010 Present the statechart and resource/knowledge boundaries in the combined
      final slice; document the browser transaction-tier finding.
- [x] T011 Verify 100/101, ties, unfinished/other-connection preservation, concurrency,
      partial knowledge, authority timeout, transaction drain and browser wiring.

## Settings and completion

- [x] T012 Add settings-only scoped queries, bounded pagination, connection selection,
      pure history presentation and localized availability/outcome labels.
- [x] T013 Present mobile/desktop presentation and query ownership.
- [x] T014 Verify account expansion, paging/reset, reload, connection/workspace
      isolation, warm offline reads, cold unanswered-authority/full-offline reads,
      logging failures and integrated retention without provider requests.
- [x] T015 Reconcile final artifacts and record actual checks in verification.md.

Schema and permission publication to the release environment is a rollout step,
not a local test outcome. No production deployment ran. Transaction revision
history and system-account display naming remain separate features.
