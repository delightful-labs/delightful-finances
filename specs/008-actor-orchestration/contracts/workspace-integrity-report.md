# Workspace integrity reporting contract

Status: implemented and verified. Source contracts are in `src/lib/workspace-integrity-contract.ts`;
the resource owner is `src/lib/machines/workspace-integrity-owner.ts`.

## Local-first revision pending

The table below records the historical contract, not the target finance eligibility policy. [013](../../013-local-first-startup/spec.md), FR-004/006, supersedes its blanket ineligibility descriptions for attribution-only checking, repair, or failure: those outcomes must not block unrelated locally permitted finance work. Required domain records and current locally known membership/grants still constrain each action. T007 must trace actual finance and bank consumers before changing this contract or operation-specific requirements. The revised behavior has not yet been implemented or verified; generation correlation and cleanup obligations below remain required.

## Requests and reports

Readiness sends `OBSERVED` with a request containing a monotonically increasing generation and an
optional binding: user, profile, organization, membership ID, role and account-access mode. A missing
binding means no eligible selected workspace. Database/environment is fixed for the actor attachment.
Reports target the typed recipient passed through input and contain the original request plus status.
Generation is a correlation token, not a persisted workspace ID.

| Status             | Payload                                           | Finance eligibility / presentation                            |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------- |
| waiting / checking | No extra payload                                  | Ineligible; waiting / working                                 |
| complete           | Actual settlement                                 | Eligible under current access rules; no retry                 |
| partial            | Profile-link issues, settlement, `access: usable` | Eligible under current access rules; partial notice and retry |
| unavailable        | Actual settlement                                 | Ineligible; failure notice and retry                          |
| conflict           | Actual settlement                                 | Ineligible; conflict notice and retry                         |
| failed             | Actual settlement                                 | Ineligible; failure notice and retry                          |
| unresolved         | Unresolved settlement                             | Ineligible; failure notice and retry                          |
| closed             | Actual terminal settlement                        | Ineligible; waiting presentation                              |

The sole integrity issue is profile attribution. No blocked-partial variation or category repair
remains. The owner classifies policy; consumers do not reconstruct eligibility from issue arrays.
Reports carry no raw errors, transaction resources or private child snapshots.

## Currency and invalidation

- Identity, profile, selection, authority-relevant binding changes or lost eligibility invalidate the
  accepted report and advance the request generation before new actions can use stale capabilities.
- Equivalent integrity observations do not restart repairs. Explicit accepted retry advances the
  generation. Unrelated bank/account observations do not restart integrity.
- Loading/error recovery creates a fresh eligible request even if the IDs match an earlier visit.
  A → B → A cannot reuse the earlier A result.
- A draining operation retains its original request. It must never relabel completion with a newer
  generation. During replacement the owner retains only the latest pending request.
- Readiness accepts only a current matching request and combines its status with current membership
  access. `selectWorkspaceIntegrityView` projects the public status for pure presentation.

## Lifecycle

The same repair child stays invoked across active/replacing/closing states. Old work drains before
replacement; cancellation/shutdown retain their priority over retries and late results. A failed
child cannot acknowledge another shutdown request. Its owner/supervisor handles unexpected crashes
separately from ordinary finite failure output.

Profile/membership assessment may confirm and repair an authorized profile link through a transaction.
Its read/reassessment/staging/commit/settlement and rollback paths retain resource ownership. Category
checking and automatic repair are excluded; missing attribution alone does not block finance.
