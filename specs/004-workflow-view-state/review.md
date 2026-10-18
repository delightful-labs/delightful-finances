# Combined review guide

The user authorized finishing implementation and tests while away, with a combined
review afterward. This is the 004 workflow/view-state feature, not a completion
claim for other specs. No schema, SDK permission, provider consent or dependency
changes; no commits.

## What to review

| Area                 | Implementation                                                                       | Behavior                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared forms         | `scoped-form.ts`, `scoped-form-write.ts`, `scoped-form-policy.ts`, `forms.svelte.ts` | One owner/submission/write lifecycle; request-specific policy assessment; controlled input adapter; file-draft success reset preserves feedback. Existing create/edit mode remains the startup property. |
| Observation delivery | `observations.ts`, integration readers                                               | Snapshot Jazz row fields/arrays before untracked sends. In-place inserts/role deltas update capability and cannot silently rewrite an older revision. Opaque binding identity is retained.               |
| Account creation     | `account-creation-access.ts`, `AccountCreation.svelte`, `AccountForm.svelte`         | Existing owner/admin policy child, shared create mode, inspectable blocked dialogs, local insert settlement through teardown.                                                                            |
| Categories and tags  | `management.ts`, settings routes, corresponding forms/lists                          | One shared editing policy; protected system categories; exact archive/category references; shared create/archive outcomes; history/counts unchanged.                                                     |
| Profile              | `profile.ts`, account route, profile forms                                           | Own-profile/database binding; unchanged name Save disabled; avatar upload/remove uses shared edit mode and success cleanup; native image resources still disposed.                                       |
| Transactions         | `transaction-entry.ts`, entry/form components                                        | Explicit prerequisites, writable-account/grant policy, exact reference/kind/currency assessment; defaults after readiness; validation/check/tag/atomic persistence preserved.                            |
| Bank views           | `bank-presentation-contract.ts`, bank selector/presentation                          | One setup/connected/restricted mode, activity and independent history; existing workflow/provider rules retained.                                                                                        |
| Recovery phrase      | `recovery-phrase.ts`, recovery integration/presentation                              | Explicit hidden/revealing/confirmed/failure states; hide, identity/binding replacement and shutdown clear transient data; late outputs ignored.                                                          |
| Common presentation  | `FormFeedback.svelte`, `form-messages.ts`                                            | Typed readiness, validation, denial, interruption and uncertain settlement feedback. Submit labels stay stable.                                                                                          |

## Manual review routes

- `/accounts`: create cash/bank/card accounts, validation/correction, Close/reopen,
  scope changes and archive.
- `/settings/categories`, `/settings/tags`: create, archive, switch workspace;
  system categories remain protected; blocked dialogs explain access.
- `/account`: pristine/changed/reverted name, avatar upload/replace/clear/remove,
  recovery reveal/confirmation and every dismissal.
- `/expenses/new`, `/incomes/new`: no-account recovery, default categories,
  overrides/reset, check fields, tags, read-only and missing prerequisites.
- `/settings/banks`: setup steps, connected controls, history, cancellation and
  restricted/offline views. Provider access still requires explicit user action.

`tasks.md` records exact verification commands, corrections and coverage limits.
Model and implementation review remain the user's pending combined review;
automated verification does not claim that review has already happened.

## Final verification

The requirements-quality checklist has 14 checked items and zero unchecked items
(PASS). Execution approval is the user's combined-review instruction, not a claim
of completed implementation review. Final unit suite: 389 tests in 28 files passed;
54 browser scenarios passed across workflow (37), bank/readiness (7), shared forms
(5), workspace access (4) and archive (1). Application, test and configuration types
pass. Commands and coverage limits are recorded in tasks.md.
