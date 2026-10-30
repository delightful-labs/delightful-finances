# Source and E2E organization

The user authorized a larger batch of file organization and browser-test maintenance,
including working across the normal focused-review limits in this thread.

## Requirements and implementation

- Keep SvelteKit route files in their framework-defined locations; move the finance smoke
  scenario from `src/routes` to `tests`.
- Group shared workflow contracts under `src/lib/contracts` and shell/navigation components
  under `src/lib/components/navigation`, with import-only changes to their callers.
- Split the old workspace suite into nine domain-focused files under `tests/features`.
  Preserve the automatic ownership-warning fixture and shared workspace setup under
  `tests/helpers/workspace.ts`. Await the initial workspace selection, then use sidebar navigation to settings,
  avoiding a second full document load and the custom selection polling loop. Direct
  unscoped settings navigation intentionally opens the chooser and is unsuitable as setup.
- Separate attachment and transfer scenarios from transaction editing. Share existing
  transaction setup and persistence inspection under `tests/helpers/transactions.ts`.
- Keep the existing scenario declarations and parameterization. Do not remove authorization,
  offline, or recovery scenarios merely because another scenario covers a happy path.
- Centralize development-runtime configuration in `tests/config/base.ts`. Reuse a known
  agent server only through explicit environment configuration. Use one local worker and up to two CI workers for isolated
  development scenarios. Keep authentication’s existing serial 60-second budget; keep
  production, HMR, feature-flag and stalled-remote suites serial.
- Select cross-cutting features with scenario tags, including authorization, identity,
  workspaces, attachments, descriptions, account archiving, categories and tags. A feature
  selection must include relevant cases from the old broad suites.
- Make default development discovery complete and disjoint. CI selects the same projects
  and shards application coverage. Keep production PWA cold-start tests out of development
  discovery. Add CI ownership for stalled-remote startup and all fake-data/debug flag pairs.
- Retain CI failure traces, failure screenshots and JSON durations. Keep local tracing opt-in
  with `--trace retain-on-failure`. Do not inflate timeouts or add retries.

## Architecture and review

Source moves preserve existing subscriptions, lifecycle ownership, persistence, schemas,
permissions, statecharts, component markup and styling. No async workflow, actor logic,
translation, or production behavior is introduced or changed. Imported machine dependencies
retain their original owners; changes in machine files are import references only.

Static inspection found that the mobile navigation test asserted inertness and geometry on
an outer `main`, while AppShell applies them to its `.content` wrapper. Scope those assertions
to the actual content wrapper, preserving the resize, overflow and focus-restoration contract.

## Validation

- [x] Preserve all 194 scenario declarations, including parameterized templates.
- [x] Confirm default discovery expands to 249 development scenarios without duplicate projects.
- [x] Source checks pass with zero Svelte errors/warnings.
- [x] Recursive test TypeScript checks pass, including configs and shared helpers.
- [x] Eleven relevant unit tests pass across the moved save contract, account actions and loading content.
- [x] Verify 105 distinct affected browser scenarios across focused runs. The final 57 feature
      and shell scenarios passed in 14.4 minutes with two workers; all seven navigation scenarios
      also passed. Two local workers roughly doubled individual case durations, so local runs
      retain one worker. A full-suite speedup has not been established.
- [x] Compare 100 production files, including 48 machines: code and markup remain identical
      after normalizing moved import paths and formatting.
- [x] Final test TypeScript checks and the scope/runtime-ownership guard pass: 249 unique
      development scenarios, 41 files assigned to runtimes, and 15 focused selections match
      their canonical tagged coverage.
- [x] Final touched-file formatting and whitespace checks pass.

Historical verification notes elsewhere in this feature retain the paths used at the time.
Current commands and directory conventions are documented in the root README.

Production PWA, stalled-remote startup and flag-matrix suites were wired into CI but were
not executed locally in this batch. Existing recovery, offline, authorization and smoke
scenarios were retained; duplicate runtime ownership was removed rather than deleting
scenarios with different behavioral intent.
