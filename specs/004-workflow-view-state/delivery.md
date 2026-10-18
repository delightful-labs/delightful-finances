# Incremental delivery: workflow and view state

Status: account-archiving implementation approved and focused verification passed. General forms model (2a) is approved; ownership/controller implementation (2b) is approved, with focused verification passed. The user accepted 2b verification; shared presentation (2c) is now implemented for review.

## Architectural direction

Follow `.specify/memory/constitution.md` and `.specify/memory/xstate.md`.
Reference: `feature/account-data-merge` at `7ab1a88`, especially
`account-merge/destination.ts`, `presentation.ts`, `preview.ts`, and its lifecycle document.
These illustrate explicit eligibility, typed views, child composition, and issued-effect settlement.

- Model states, observed facts, events, actor ownership, typed outcomes, and cleanup before effects. Sequential business decisions belong in guarded transitions or focused children; wrapping branching functions in `fromPromise` is insufficient.
- Keep machines in `src/lib/machines/`. Page/integration components bind Jazz subscriptions, dependencies, and actor lifecycle and compose pure presentation.
- Guards may use pure policy predicates. Keep transformations, validation, defensive invariants, platform disposal, and atomic transaction checks as functions. Do not make an actor for every predicate.
- Context holds facts, payloads, counters, actor references, and results, not duplicate lifecycle flags.
- Selectors project model choices into discriminated view variants; tags express shared capabilities and metadata may provide message descriptors. Selectors must not reclassify business outcomes. Presentation localizes and formats.
- Displayed capability and guarded event acceptance share a policy and receive current observations. A disabled callback outside the machine is insufficient.
- Keep generic form mechanics reusable; compose focused domain children instead of teaching one form machine every entity's rules.
- Keep simple disclosure/input local. Recovery phrases require identity-bound cleanup. Review dialog close-during-save semantics when touching form integration; dialog visibility alone does not require a machine.
- Supervise child errors and verify nested transitions reach view subscribers. Await asynchronous cleanup before stopping owners; do not infer cancelled writes from actor disposal.

## Proposed slices and progress

Slice 1 model and implementation reviews are approved; focused verification passed. Later slices
remain pending and their order may change through review. Split rows into focused
cycles, normally 4–6 implementation files. Discuss larger batches before editing.

| Slice | Scope                                                                                                                                                                                                  | Requirements           | Model reviewed | Implementation reviewed | Verified |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------- | ----------------------- | -------- |
| 1     | Account archiving: readiness/access, per-account capability, scoped request, persistence result, teardown.                                                                                             | FR-001–007, FR-009     | Approved       | Approved                | Passed   |
| 2     | General forms refactor: shared machine/controller/view contract, domain-child composition, submission guards, typed feedback, reset/reopen/close and teardown semantics. See detailed subcycles below. | FR-002–006, FR-009–012 | Approved       | Pending                 | Pending  |
| 3     | Account creation: audit existing account-creation-access ownership and close demonstrated gaps.                                                                                                        | FR-001–007, FR-009     | Pending        | Pending                 | Pending  |
| 4     | Category management, then tag management as separate cycles: permission, protected entities, create/archive outcomes.                                                                                  | FR-001–007, FR-009     | Pending        | Pending                 | Pending  |
| 5     | Workspace rename (first adoption in 2d), then profile editing as separate cycles: ownership, record binding, scope changes.                                                                            | FR-001–007, FR-009     | Pending        | Pending                 | Pending  |
| 6     | Transaction entry: explicit prerequisites/access, ready/blocked views, scoped submission, changing references.                                                                                         | FR-001–007, FR-009     | Pending        | Pending                 | Pending  |
| 7     | Bank presentation: typed mutually exclusive modes, independent history, unchanged provider policy. Split setup and operation views if needed.                                                          | FR-001–007, FR-009     | Pending        | Pending                 | Pending  |
| 8     | Recovery phrase lifecycle: reveal/confirmation/failure and clearing on identity changes and teardown.                                                                                                  | FR-003–009             | Pending        | Pending                 | Pending  |

## General forms work: slice 2

This is implementation work on the shared forms layer, not just documentation of
an integration contract. Use evidence from account archiving to keep the design
concrete. Review and verify each subcycle before beginning the next.

- [x] **2a — Model the shared contract:** inventory `form.ts`, `forms.svelte.ts`, `FormContent.svelte`, `FormModal.svelte`, and representative consumers. Define shared events, observed capabilities, domain-child ownership, typed view/results, reset/reopen behavior, and error boundaries. Map FR-010–012 to the model. Approved model: [forms.md](forms.md).
- [x] **2b — Implement machine/controller ownership:** move submission policy out of controller-only `disabled || busy` checks and into guarded event acceptance. Forward current observations; define scope replacement, cancellation, and issued-effect settlement explicitly. Keep DOM/FormData adaptation in integration and pure input validation reusable. Four-file implementation approved; 27 new unit/adapter tests plus five legacy regressions and application type checks passed. Browser integration limits remain for 2c/2d.
- [ ] **2c — Implement shared presentation:** give form components typed feedback/capabilities instead of requiring repeated `matches('error') || matches('invalid')`, raw-error interpretation, or independent busy/disabled policy. Preserve field issues, localization, accessibility, and simple local dialog visibility; explicitly define close-during-save behavior. Five-file implementation prepared for review; tests await approval.
- [ ] **2d — Adopt in one representative form:** demonstrate composition with domain authorization/preparation/persistence children and accurate outcomes. Move business branches out of its save callback while retaining atomic write-time invariants. Verify child transitions reach the view.

Each checkbox represents a focused review cycle with model review, implementation
review, and approved unit/Playwright verification recorded separately. Split again
if a proposed file set grows beyond the repository's review limit. Later slices
adopt this shared contract incrementally; do not migrate all consumers at once.

## Coverage of the original review

| Suggestion                                                          | Tracked work                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| Form readiness and authorization in focused machines                | Slices 1, 3–6; shared composition in 2a/2d           |
| Typed views instead of unrelated booleans                           | 2c and slice 7; applied in subsequent consumers      |
| One policy for displayed actions and accepted events                | 2b and domain adoption in slices 1, 3–6              |
| Explicit transaction prerequisites and blocked reasons              | Slice 6                                              |
| Generic form mechanics composed with domain workflows               | 2a, 2b, 2d; FR-010–012                               |
| Scope changes, cancellation, and issued writes as explicit outcomes | 2b/2c and every affected domain slice                |
| Recovery phrase lifecycle and cleanup                               | Slice 8                                              |
| Selectors project decisions without making new ones                 | Architectural direction; model review for each slice |

## First cycle proposal: account archiving

Candidate files: `src/routes/accounts/+page.svelte`, `src/lib/components/AccountList.svelte`,
a focused account-archive machine, and a matching type module only if needed.
Inspect current query/access contracts and actual persistence cancellation guarantees before finalizing.
Do not broadly rewrite account creation, shared forms, or data adapters in this cycle.

Proposed outline, subject to model review:

```text
observing -> loading | unavailable | ready
ready -> authorizing request -> persisting -> succeeded | failed
authorization -> denied | scopeChanged
scope replacement / cancel / shutdown -> settle issued work -> terminal cleanup
```

The reviewed chart must define whether readiness and active work need separate
child ownership, how capabilities update, what issued writes can cancel, and how
old completions are isolated. This outline is not an approved statechart or proof
that persistence is abortable.

## Review protocol and evidence

1. Record exact file scope and map affected requirements/acceptance scenarios.
2. Show statechart, events, context facts, actor tree, results, and teardown for review before effects.
3. Implement only the focused cycle, format related files, and present implementation for review. Record approval with a conversation reference or user-provided identifier.
4. After implementation approval, add meaningful unit and Playwright coverage and run relevant checks. Cover view/action agreement, scope changes, late events, issued-write settlement, and cleanup where applicable.
5. Record actual commands/results and limitations. Mark verified only after relevant coverage passes, then begin the next approved cycle.

A detailed `tasks.md` follows reviewed design. This roadmap tracks pending work
without implying implementation approval. No application code, tests, branch,
commit, schema migration, server, or provider operation is part of this documentation cycle.

## Slice 1 verification

See [tasks.md](tasks.md#approved-verification) for commands, environment workarounds,
and coverage limits. Thirteen machine tests, one offline/reload browser scenario,
application/test type checks, and focused formatting checks passed. No application
changes were needed during the approved test cycle. Review this evidence before
starting slice 2a (general forms model).

## Slice 2a review

The shared contract is proposed in [forms.md](forms.md). It defines additive
migration, domain availability/operation composition, guarded events, typed
presentation, draft revisions, close-versus-cancel semantics, and settlement of
issued effects. Workspace rename is proposed for 2d and is not repeated in slice 5. Completing 2a means the model is written; the model-review column for slice 2
is approved by user continuation. Slice 2b adds a scoped API beside the legacy path; production consumers remain unchanged.

## Slice 2b verification

The user explicitly approved implementation with "I approve. continue". Focused
verification passed: 27 new tests cover owner/submission transitions, interruption
and issued-effect settlement, payload cleanup, and controller adapters; five legacy
form regressions also passed. Application checking passed with zero errors/warnings.
No production implementation changes were needed. An older installed UI package
was restored to the exact archive already selected by the committed lockfile;
no tracked dependency files changed.

See [tasks.md](tasks.md#approved-slice-2b-verification) for commands and limits.
Controller tests exercise the compiled server adapter with explicit mount hooks;
client reactive effects, DOM reset/rebuilds, and actual modal behavior still require
the scheduled browser adoption checks. No server or Playwright run was needed in
this additive cycle. Review this evidence before beginning slice 2c.
