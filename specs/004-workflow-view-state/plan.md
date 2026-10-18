# Implementation Plan: Explicit workflow and view state

Status: first slice model and implementation approved; focused verification passed. See tasks.md for evidence and limits. Later slices remain pending.

## Scope and technical context

Implement [spec.md](spec.md) one focused review cycle at a time, in the order tracked
by [delivery.md](delivery.md). First delivery is account archiving only. Existing
TypeScript, Svelte 5, Jazz, XState 5, and Paraglide tooling applies. No schema or
permission-policy changes are proposed.

## Constitution check

Preserve local-first writes, organization permissions, localized accessible UI,
and unstyled presentation. No switch statements, casts, or any. Machines own
business decisions; integrations bind observations and dependencies and compose
pure components. Model review precedes effects; implementation review precedes
test additions/runs. Do not start another slice before current work is reviewed.
No commit or development server is needed for this design cycle.

## First slice design

See [account-archive.md](account-archive.md) for the proposed actor tree,
statechart, event/result contracts, write semantics, and focused file scope.

Keep shared forms unchanged until slice 2. Do not mechanically reuse the generic
form actor for an operation whose authorization and cancellation it cannot model.
Subsequent slice plans are added after this pattern is reviewed and verified.

## Verification strategy

After implementation review, add focused machine coverage for observation
readiness, scoped access, duplicate requests, stale events, cancellation/shutdown,
and settlement of issued writes. Add relevant account-page Playwright coverage
for visible actions and results. Run only relevant checks; type checks alone do
not prove lifecycle or persistence correctness. Record actual commands/results
in tasks.md and delivery.md rather than claiming validation from this plan.
