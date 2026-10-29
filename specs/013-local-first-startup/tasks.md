# Draft backlog: Local-first usability and startup

**Status**: Provisional specification backlog. Not generated implementation tasks; no `plan.md` yet.
Resolve product questions and review statecharts/file scope before implementation. Work on one task
at a time; show each change and wait for review. No tests added or run before implementation approval.
Items below intentionally mix implementation candidates and bounded investigations as requested.

## Specification and guidance

- [x] T001 Resolve initial product clarification one question at a time. Q1: all accessible finance
      records across all accessible workspaces, attachment files on demand (`spec.md` FR-010).
      Q2: new identities can create their first workspace offline; recovered identities never
      automatically create replacements from incomplete local data. Q3: measure representative
      devices/datasets before choosing numerical budgets, without delaying local-first corrections.
      New consequential product questions discovered during research must still be asked individually.
- [x] T002 Reconcile constitution I and XState/testing memory with FR-001–007/016. Clarify locally
      known authorization, partial replicas, cold restarts, and remote nonresponse; retain online-only
      access administration and provider-operation boundaries. Present this focused docs change first.
- [x] T003 Reconcile `specs/006-multiple-workspaces/spec.md` and `plan.md`,
      `specs/008-actor-orchestration/contracts/workspace-integrity-report.md` and `fake-data.md`,
      and `specs/009-independent-checks/spec.md` using the research conflict inventory. Mark historical
      descriptions clearly; add cross-references rather than claiming pending changes already work.
- [ ] T004 Produce a reviewed technical plan for the first implementation slice. Read XState memory;
      model local session/data availability separately from provenance/repair/seeding/recovery, with
      cancellation, failure, identity replacement, and cleanup. Limit each implementation review batch.

## First delivery: ordinary local usability

These are lower-risk directions, not permission to remove safeguards or blindly replace every remote
read. T005–T008 depend on the reviewed plan and applicable guidance reconciliation. A statechart must
precede workflow code. Coverage changes follow review of the exact implementation they exercise.

- [ ] T005 Decouple available local shell/data access from initialization provenance in
      `src/lib/machines/workspace-initialization.ts`, `readiness.ts`, and
      `src/lib/components/WorkspaceBootstrap.svelte`. Use explicit local-first discovery on the
      usability path; keep empty results from authorizing bootstrap or repair. Preserve current
      identity/membership/scope guards. Show the statechart and file scope before editing code.
- [ ] T006 Remove opt-in seeding from the critical readiness path in `workspace-fake-data.ts`,
      `workspace-initialization.ts`, and its owner. Preserve authoritative emptiness/exclusive seed
      acceptance and cancellation/resource ownership; allow ordinary local use while seeding waits.
- [ ] T007 Separate attribution-only repair progress from unrelated local capabilities in
      `workspace-integrity.ts`, `workspace-integrity-owner.ts`, and `readiness.ts`. Inspect the actual
      finance/bank consumers first; do not remove essential credential or operation-specific facts.
- [ ] T008 Audit ordinary writes in `src/lib/data.ts` and persistence machines for local completion
      and late rejection handling. Fix only verified remote gates in a focused slice; preserve existing
      local waits, immutable operation IDs, and state ownership. Do not refactor working paths wholesale.
- [ ] T009 After each preceding implementation approval, update affected unit fixtures/assertions
      (initialization/readiness/integrity/seeding/save recovery as applicable) and Playwright coverage
      in `tests/offline-access.e2e.ts`/`tests/pwa.e2e.ts`; run only relevant checks in an isolated setup.
      Include a connection that opens but never returns data, not only browser offline mode.

## Investigations informing later delivery

Every investigation records exact versions, evidence, reproducible conditions, remaining uncertainty,
and a recommendation in `research.md`. Research does not automatically authorize implementation.

- [ ] T010 Investigate new versus restored identity bootstrap in `workspace-initialization.ts`,
      `workspace-creation-transaction.ts`, reconciliation/journal helpers, and Jazz account APIs.
      Implement the approved Q2 behavior only after establishing supported identity provenance and
      an offline-safe protocol retaining stable IDs, concurrent-device safety, and no membership
      resurrection. If provenance cannot be distinguished reliably, report the SDK limitation and
      present alternatives; never infer newness from an empty cache. Present the statechart before code.
- [ ] T011 Investigate all-accessible-finance-record coverage under FR-010: active query scopes,
      relationship and offset completeness, subscriptions across workspaces, history volume,
      attachment metadata, on-demand file download/retention, storage/quota,
      and observable preparation progress. Propose background preparation without a local readiness gate.
- [ ] T012 Investigate unknown-outcome recovery in `transaction-save.ts` and staged Check/ledger
      persistence. Establish how pending recovery survives navigation/reload without replay or blocking
      unrelated work; determine which remote checks remain necessary and propose scoped states.
- [ ] T013 Inspect a production build's manifest, cached shell paths, Jazz worker script/imports,
      and Wasm URLs. Trace worker-originated fetches and query-version identity. Determine whether
      pathname normalization can serve incompatible bytes. Record specific missing assets/routing bugs.
      Build only in an isolated checkout if the user's development server is active.
- [ ] T014 After review of any T013 fixes, extend `tests/pwa.e2e.ts` to establish a genuine cold offline
      restart: all app clients closed, no surviving runtime, HTTP-cache masking eliminated while
      retaining application Cache Storage/IndexedDB, supported direct links, and update version cases.
- [ ] T015 Measure startup and interaction baselines: first visit, warm return, cold offline restart,
      and update; representative small/large datasets and supported devices. Attribute shell, worker,
      Wasm, local query, readiness, result transformation, balance calculation, and render costs. Set
      performance budgets from evidence without delaying the first local-usability correction.
      Capture comparable pre-change evidence before modifying a measured path; the broader device
      matrix is not a prerequisite for correcting verified remote dependencies (approved Q3).
- [ ] T016 Evaluate earlier page-owned initialization using `src/app.html`, `src/routes/+layout.svelte`,
      `src/lib/jazz-session.ts`, and `application-readiness.ts`. Establish earliest supported start,
      singleton ownership, cancellation/auth transitions, dependency payload, and measured overlap.
- [ ] T017 Evaluate `InstallEvent.addRoutes()` for existing public precache paths: browser matrix,
      feature detection, cache key parity, cache misses, update lifecycle, and cold startup savings.
      Preserve fetch-handler fallback; adopt only with evidence of benefit and compatibility.
- [ ] T018 Assess navigation preload only for navigation paths that actually need network HTML;
      document why it is rejected for precached shell hits or identify a concrete beneficial case.
- [ ] T019 Evaluate Wasm download/compilation preparation and supported `runtimeSources.wasmModule`
      reuse across page/broker realms. Inspect actual default and override loaders, stable asset scope,
      module persistence/message support, contention, and fallback. Compare elapsed startup and memory;
      do not assume a compiled module equals a running database or supported service-worker handoff.
- [ ] T020 Profile application-worker candidates after accounting for Jazz's existing SharedWorker.
      Examine calculations/parsing/subscription transforms/rendering; define message payloads, explicit
      local-first defaults, supported database bridge, lifecycle and cancellation. Keep UI owners in the
      page. Do not migrate machines solely because they make asynchronous calls.
- [ ] T021 Evaluate service-worker install/update cost: total asset size, duplicate downloads,
      foreground contention, retention of old version assets, quota/eviction, and browsers. Preserve
      existing update consent and no mandatory remote-sync wait; recommend changes only from evidence.

## Follow-through

- [ ] T022 Turn accepted investigation outcomes into separately reviewed implementation slices and
      appropriate tests after approval. Keep rejected/unproven ideas documented, with no implied
      always-running service worker, unsupported Jazz handoff, or automatic provider fetching.
- [ ] T023 Reconcile research, legacy specs, memory, and completion status after each delivery. Record
      measured results and limitations; distinguish completed research, implemented behavior, and
      validated guarantees. Do not mark this feature complete while approved investigations remain.
