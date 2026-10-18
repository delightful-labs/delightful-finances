# Tasks: workflow and view state

First slice only. Later slices remain tracked in delivery.md and receive their
own detailed tasks after the current slice is reviewed. No parallel tasks.

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
