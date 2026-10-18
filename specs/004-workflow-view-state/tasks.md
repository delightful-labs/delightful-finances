# Tasks: workflow and view state

Focused cycles only. Later slices remain tracked in delivery.md and receive
their detailed tasks after the preceding cycle is reviewed. No parallel tasks.

- [x] T001 Inspect account archiving, permissions, and persistence semantics; document first-slice model in account-archive.md and planning boundaries in plan.md.
- [x] T002 Obtain review of account-archive.md model and file scope; record review reference here. This gates effects.
- [x] T003 Implement the reviewed owner/operation machines and typed view contracts in src/lib/machines/account-archive.ts and account-archive-operation.ts.
- [x] T004 Integrate observations/lifecycle in src/routes/accounts/+page.svelte and typed presentation in AccountList.svelte; add required localized messages only. T003/T004 form one implementation review batch.
- [x] T005 Format changed files and present the exact implementation for review; record approval before adding/running tests.
- [x] T006 After T005 approval, add relevant machine and account-page Playwright coverage, then run only relevant checks and record results/limitations.
- [x] T007 Record slice status in delivery.md and show the verified cycle before starting general forms work.

## Evidence

T001: static inspection found archiveAccount uses db.update(...).wait({ tier:
local }) with no abort parameter; no tests added or run. Model review pending.

T002: user approved continuation after the model was presented. T003/T004:
implemented in the proposed five-file batch; implementation review pending.
Validation: `pnpm check` passed, including message generation, Svelte checking
(zero errors/warnings), and service-worker TypeScript checking. `git diff --check`
passed. Tests were neither added nor run; runtime verification remains gated on
implementation approval at T005.

## Approved verification

T005: user accepted the implementation after reviewing the flat terminal-state
choice ("ok. keep as is and continue"). Test additions/runs were authorized then.

T006/T007:

- `pnpm test:unit --run src/lib/machines/account-archive.test.ts`: 13 passed.
- `pnpm check`: passed; zero Svelte errors/warnings.
- `pnpm check:tests`: passed.
- Focused Playwright account-archive scenario: 1 passed (offline archive,
  unaffected second account, and local persistence after reload).
- Browser invocation: `pnpm exec playwright test --config .svelte-kit/account-archive.playwright.ts`.
  This ignored temporary config extends the committed account-archive config,
  allows this worktree's externally linked node_modules path, and uses port 5181.
  The standard committed config is `playwright.account-archive.config.ts` and uses
  the existing isolated in-memory Jazz setup. Normal local dependency installation
  does not require this worktree-specific Vite path workaround.
- Initial browser attempts encountered sandbox listener restrictions, linked-WASM
  serving restrictions, and an outdated test button label; the successful run
  followed resolution of those environment/fixture issues. No production changes
  were needed during verification.

Coverage limits: browser permission-change and teardown races are covered by
machine tests rather than a multi-user browser scenario. These checks do not
establish remote acceptance or cross-device synchronization; archive success is
local persistence. General forms work has not started; this cycle is ready for
review of its verification evidence.

## Shared forms model: slice 2a

- [x] T008 Inspect shared form machine/controller/components, representative consumers, and persistence/resource semantics; propose the model in forms.md. Maps FR-010–012.
- [x] T009 Review forms.md: approve ownership, close/reset/reopen policy, additive migration strategy, first adoption, and proposed slice 2b file scope. This gates shared-form effects.

T008 evidence: static inventory of account/category/tag forms, workspace/profile
editing, transaction entry, and avatar transformation; no application changes,
test additions/runs, or server startup. Model was subsequently approved by the user's continuation instruction.

T009: user approved continuation after the shared model was presented.

## Shared form ownership: slice 2b

- [x] T010 Add props-only contracts in src/lib/form-contract.ts and the submission child in src/lib/machines/scoped-form-submission.ts, composing supplied domain operation logic with validation and explicit settlement.
- [x] T011 Add the owner and supervised availability integration in src/lib/machines/scoped-form.ts, plus additive createScopedFormController in src/lib/forms.svelte.ts. Keep legacy exports/consumers unchanged.
- [x] T012 Format the four-file implementation and run static checking; present for implementation review.
- [x] T013 Obtain approval of the exact slice 2b implementation before adding/running its tests.
- [x] T014 After T013, add focused machine/controller coverage for revisions, direct-event submission guards, reset/reopen, validation/operation cancellation, scope changes, child failures, and teardown. Record actual results and remaining browser integration limits.
- [x] T015 Show verified 2b evidence before beginning shared presentation slice 2c.

T010–T012: implemented the reviewed four-file batch. `pnpm check` passed with
zero Svelte errors/warnings, including generated messages and service-worker
TypeScript checking. No tests added/run, no server started, and no consumers
migrated in this cycle. Static checking does not establish runtime correctness
or successful domain composition; the first production adoption remains slice 2d.

The owner supervises snapshot projection in an availability wrapper, guards
reports by observation revision/scope, and explicitly models awaiting/current
readiness. Submission and owner both preserve interruption priority across queued
completions; the child retains validation and domain-operation invocations until
settlement. Context payload cleanup uses terminal entries rather than relying on
actor stopping or machine-root exit. Controller reset emits a draft revision;
actual field rebuilding belongs to presentation adoption in 2c.

## Approved slice 2b verification

T013: user explicitly approved the exact four-file implementation: "I approve. continue".

T014/T015: added `src/lib/machines/scoped-form.test.ts`,
`src/lib/machines/scoped-form-submission.test.ts`, shared typed test fixtures in
`src/lib/machines/scoped-form.fixture.ts`, and `src/lib/forms.test.ts`.
No production code changes were needed.

- `pnpm test:unit --run src/lib/forms.test.ts src/lib/machines/scoped-form.test.ts src/lib/machines/scoped-form-submission.test.ts src/lib/machines/form.test.ts`: 32 passed (27 new, five legacy regressions).
- `pnpm check`: passed; zero Svelte errors/warnings, including service-worker TypeScript checking.
- Focused Prettier checks and `git diff --check`: passed.

Coverage includes capability/direct-event agreement, stale observation revisions
and mismatched scopes, duplicate/reset/reopen guards, child-driven view updates,
void success, validation issues versus unexpected errors, validation settlement
before cancellation/shutdown, operation error supervision, committed/rejected
settlement after permission loss, scope replacement away and back, availability
projection failure/retry, interruption priority, and terminal payload cleanup.
Controller adapter coverage checks synchronous observation refresh, FormData
Files/repeated fields, native event prevention, and unmount shutdown without
prematurely aborting issued work.

Controller tests compile the server adapter and explicitly invoke mocked Svelte
mount hooks. They do not verify client reactive effects, actual DOM field rebuilds,
framework hook ordering, or dialog close/reopen rendering. No Playwright test or
server was started because this additive API has no production consumer yet.
Those browser integration limits remain assigned to presentation/adoption slices
2c/2d and the later modal adoption; 2b passing does not establish them.

The initial application check found ten missing-export errors from an installed
`delightful-ui` pointing to the older caret-position archive. The repository's
package.json/lockfile already select the typography-primitives archive. Offline
pnpm installation declined module-directory replacement without a TTY; restored
only that exact vendored archive and its local dependency links in ignored
node_modules, then reran successfully. No tracked dependency changes.

Slice 2b verification evidence is presented for review before starting 2c.

## Shared presentation: slice 2c

- [x] T016 Review the approved forms.md presentation model and concrete five-file scope; accept 2b verification via the user's "continue" instruction.
- [x] T017 Add a props-only shared rendering contract and a narrow legacy view projection in src/lib/form-contract.ts and src/lib/machines/form.ts; bind it in src/lib/forms.svelte.ts without changing legacy machine transitions.
- [x] T018 Update FormContent.svelte and FormModal.svelte to consume typed content/activity/capabilities, rebuild scoped fields by accepted draft revision, and distinguish busy Close from workflow cancellation. Keep legacy snippets and call sites compatible.
- [x] T019 Format and statically check the five-file implementation, then present it for review.
- [ ] T020 Obtain approval of the exact 2c implementation before adding/running tests.
- [ ] T021 After T020, verify legacy projection and shared presentation, including field disabling, accepted/rejected reset, void success, and modal close/reopen behavior. Record browser limits separately from later domain adoption.
- [ ] T022 Show verified 2c evidence before beginning workspace rename adoption (2d).

T016: user accepted the prior verification and authorized continuation: "continue".
The five implementation paths were shown before edits; the approved forms.md
model supplies the behavior policy. No new workflow machine or domain migration.

T017/T018: shared components now require only FormPresentation and preserve the
specific caller's view type in their snippets. ScopedFormView satisfies this
contract directly. Legacy FormView retains its snapshot/busy/disabled/issues
fields through selectLegacyFormView, and gains a rendering-only projection.
It deliberately reports no persistence settlement or new authorization guarantee.

FormContent keys only the fields subtree by draftRevision and uses an unstyled
native disabled fieldset to apply fieldsEditable consistently. Scoped accepted
reset/reopen/scope replacement can rebuild native controls; rejected reset does
not change the key. Legacy revision remains undefined so its native reset and
parent component state are not implicitly remounted. Parent-owned local state
such as avatar selection/payment disclosures still needs explicit adoption.

FormModal consumes the typed content choice (including void success), submit/open
capabilities, and activity. Closing uses existing localized Close while busy,
preserves mounted draft controls, and emits no cancellation/reset. Scope changes
still close and key-replace the modal's contents. Scoped callers omit the legacy
disabled prop and use canOpen, so busy reopening is supported by the owner. Existing
legacy callers retain their explicit disabled-trigger behavior until migration.

No tests added/run or development server started for this unapproved implementation.

T019: `pnpm check` passed with zero Svelte errors/warnings, including generated
messages and service-worker TypeScript checking. Focused Prettier checks and
`git diff --check` passed. These static checks do not establish runtime or browser
correctness. The exact five-file implementation is presented for review; T020
remains pending. No tests were added or run for slice 2c.
