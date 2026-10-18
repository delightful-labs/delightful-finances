# Implementation Plan: Explicit workflow and view state

Status: account archiving verified; shared forms model approved; slice 2b ownership/controller implementation approved and focused verification passed. Shared presentation (2c) is implemented for review; tests await approval.

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

## Shared forms design (slice 2a)

See [forms.md](forms.md) for the consumer inventory, proposed actor composition,
event/view contracts, lifecycle policy, and additive migration path.
FR-010 maps to guarded submission/reset/lifecycle, FR-011 to supplied domain
availability/operation machines, and FR-012 to props-only typed views.

Slice 2b proposes four implementation files: new scoped owner/submission machine
modules, a props-only form contract module, and additive integration in
forms.svelte.ts. The four concrete paths are recorded in forms.md and tasks.md; implementation is approved and focused verification passed (see tasks.md for coverage limits). Slice 2c handles shared
presentation compatibility; slice 2d adopts workspace rename as the first domain
consumer and satisfies that portion of slice 5. Account creation is the first
modal adoption in its own later cycle. Existing exports remain until their
consumers migrate; no broad replacement of legacy callbacks is planned.

## Shared presentation implementation (slice 2c)

The five-file scope and compatibility limits are recorded in forms.md and tasks.md.
Both shared components consume props-only presentation choices; the legacy adapter
projects its old actor without changing its transitions or persistence guarantees.
Native fields are disabled by the view and keyed by accepted scoped draft revision.
Modal close preserves active work and uses the existing Close label while busy.
Review the exact implementation before adding/running tests; no production domain
consumer is migrated until 2d or its later dedicated slice.
