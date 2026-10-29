# Draft backlog: Local-first usability and startup

**Status**: Implementation and consolidated investigation in progress; plan.md is present.
The user's latest direction authorizes completing open investigations/tests without further review
pauses. See [investigation-results.md](investigation-results.md) for the current evidence and decisions.
The spec remains incomplete where required behavior is unbuilt or unsupported; investigations and
rejected optimizations are not equivalent to delivery. Commit/deployment authorization is unchanged.

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
- [x] T004 Produce a reviewed technical plan for the first implementation slice. Read XState memory;
      model local session/data availability separately from provenance/repair/seeding/recovery, with
      cancellation, failure, identity replacement, and cleanup. Limit each implementation review batch.

## First delivery: ordinary local usability

These are lower-risk directions, not permission to remove safeguards or blindly replace every remote
read. T005–T008 depend on the reviewed plan and applicable guidance reconciliation. A statechart must
precede workflow code. Coverage changes follow review of the exact implementation they exercise.

- [x] T005 Decouple available local shell/data access from initialization provenance in
      `src/lib/machines/workspace-initialization.ts`, `readiness.ts`, and
      `src/lib/components/WorkspaceBootstrap.svelte`. Use explicit local-first discovery on the
      usability path; keep empty results from authorizing bootstrap or repair. Preserve current
      identity/membership/scope guards. Show the statechart and file scope before editing code.
      Implementation reviewed; test follow-up authorized. Four focused unit suites passed (89 tests),
      then the updated readiness suite passed all 26 tests, including pending/failed provenance
      and empty first-workspace discovery.
      Selection uses observed session facts to avoid transient parallel-region ordering. Locked dependency installation resolved prior dependency errors. Type checking passes with zero
      errors/warnings; the existing offline owner Playwright workflow passes. Cold restart and a live
      unresponsive remote remain pending T009/T013/T014 coverage.
      No cold-start or performance guarantee validated yet.
- [x] T006 Remove opt-in seeding from the critical readiness path in `workspace-fake-data.ts`,
      `workspace-initialization.ts`, and its owner. Preserve authoritative emptiness/exclusive seed
      acceptance and cancellation/resource ownership; allow ordinary local use while seeding waits.
      Implementation approved and verified: six focused unit suites pass (117 tests), application
      and test type checks pass, and the seed-enabled Playwright reload/deduplication case passes.
      Startup coverage includes nonresponding seed reads, failure, replacement, and shutdown.
      After simplification: 37 affected readiness/startup unit tests pass. Latest application/test
      type checks and both seed reload/deduplication and visible-loading browser checks pass.
- [x] T007 Separate attribution-only repair progress from unrelated local capabilities in
      `workspace-integrity.ts`, `workspace-integrity-owner.ts`, and `readiness.ts`. Inspect the actual
      finance/bank consumers first; do not remove essential credential or operation-specific facts.
      Consumer audit and design approved. Readiness now accepts explicit Sync Now through current
      bank access instead of repair results; contract updated. Implementation approved and verified:
      85 unit tests, application/test type checks, and four focused bank/readiness browser cases pass.
- [x] T008 Audit ordinary writes in `src/lib/data.ts` and persistence machines for local completion
      and late rejection handling. Fix only verified remote gates in a focused slice; preserve existing
      local waits, immutable operation IDs, and state ownership. Do not refactor working paths wholesale.
      Static audit recorded in research.md: no ordinary remote completion gate found. Preserved
      local settlement, stable IDs, late-rejection observer, and narrow uncertain-write recovery.
      No production changes or new test execution in this audit; T009/T012 evidence remains pending.
- [x] T009 After each preceding implementation approval, update affected unit fixtures/assertions
      (initialization/readiness/integrity/seeding/save recovery as applicable) and Playwright coverage
      in `tests/offline-access.e2e.ts`/`tests/pwa.e2e.ts`; run only relevant checks in an isolated setup.
      Include a connection that opens but never returns data, not only browser offline mode.
      Progress: local startup, independent seeding and repair capability checks recorded above.
      Application observer callback delivery now covered for generic/tracked rejection notices,
      dismissal, retained workspace and unsubscribe; 48 application-readiness tests and type checks
      pass. A bounded production probe now passes cold browser/SharedWorker restart, saved-detail
      display, local edit/save and persisted reload with networking enabled and a proxy completing
      WebSocket upgrades but sending no Jazz replies. See research.md for evidence and limits.
      Automated follow-up: startup-stalled-remote.e2e.ts passes with an owned in-memory backend and
      silent transport, including HTTP-cache removal and browser/SharedWorker exit. Test types pass.
      Actual server rejection now covered too: an isolated authority changes a disconnected
      client's membership to viewer, the stale local client saves, and reconnect delivers the
      rejection notice. Accepted amount remains unchanged, read-only access takes effect and reload
      shows the accepted value. Both focused cases and test types pass. Post-negotiation stalls,
      broader partial/access scenarios and unknown-outcome durable recovery remain separate work.

## Investigations informing later delivery

Every investigation records exact versions, evidence, reproducible conditions, remaining uncertainty,
and a recommendation in `research.md`. Research does not automatically authorize implementation.

- [ ] T010 Investigate new versus restored identity bootstrap in `workspace-initialization.ts`,
      `workspace-creation-transaction.ts`, reconciliation/journal helpers, and Jazz account APIs.
      Implement the approved Q2 behavior only after establishing supported identity provenance and
      an offline-safe protocol retaining stable IDs, concurrent-device safety, and no membership
      resurrection. If provenance cannot be distinguished reliably, report the SDK limitation and
      present alternatives; never infer newness from an empty cache. Present the statechart before code.
      Investigation recorded in research.md: alpha.59 exposes no public durable automatic-identity
      provenance result. SDK-supported handoff versus app-owned explicit identity flow requires
      mechanism/design review; automatic offline bootstrap remains unimplemented.
- [ ] T011 Investigate all-accessible-finance-record coverage under FR-010: active query scopes,
      relationship and offset completeness, subscriptions across workspaces, history volume,
      attachment metadata, on-demand file download/retention, storage/quota,
      and observable preparation progress. Propose background preparation without a local readiness gate.
      Static scope audit recorded in research.md: selected-workspace warming is incomplete across
      workspaces/relationships; list pagination is in memory; detail queries include attachment parts.
      Metadata-only preparation design, coverage/transfer experiments, memory/quota and retention
      evidence remain pending. No preparation or completeness guarantee implemented.
      Runtime probe: a never-opened shared workspace had no local finance records after discovery;
      metadata acquisition made link/file/transaction queryable without parts, then explicit parts
      acquisition exposed bytes. Reproduction and limits recorded; cold persistence/transport/quota
      and large-history evidence remain open.
      Next reviewed candidate: fixed permission-filtered whole-table queries rather than one actor
      per workspace. Plan records dataset coverage, session-bound ownership and the bounded
      coverage/durability/large-result experiment required before choosing the acquisition policy.
      Experiment found an existing attachment authorization gap: two users could not read an
      ungranted transaction but could read its linked metadata and explicitly requested file bytes.
      Pause preparation adoption for T027. Large-history comparison and cold persistence remain open.
- [ ] T012 Investigate unknown-outcome recovery in `transaction-save.ts` and staged Check/ledger
      persistence. Establish how pending recovery survives navigation/reload without replay or blocking
      unrelated work; determine which remote checks remain necessary and propose scoped states.
      Audit recorded: checkpoints are form-local, cleared on scope/reset, and contain a live binding
      object; direct serialization is unsafe. Data-only journal/application ownership and write-ahead
      review slices proposed. No durable recovery implemented; narrow remote reconciliation retained.
- [x] T013 Inspect a production build's manifest, cached shell paths, Jazz worker script/imports,
      and Wasm URLs. Trace worker-originated fetches and query-version identity. Determine whether
      pathname normalization can serve incompatible bytes. Record specific missing assets/routing bugs.
      Build only in an isolated checkout if the user's development server is active.
      Isolated build/runtime audit recorded: worker-local Wasm is emitted and requested but omitted
      from precache; supported dynamic detail documents fail offline while static shells work.
      Fixes and full cold-runtime validation remain pending review/T014. Default query identity
      audited; no incompatible-byte response observed without overrides.
- [ ] T014 After review of any T013 fixes, extend `tests/pwa.e2e.ts` to establish a genuine cold offline
      restart: all app clients closed, no surviving runtime, HTTP-cache masking eliminated while
      retaining application Cache Storage/IndexedDB, supported direct links, and update version cases.
      Progress: pwa-cold-start.e2e.ts verifies emitted Wasm cache coverage and saved-account restart
      after browser/SharedWorker exit, preserving profile data with HTTP cache cleared. Dynamic
      detail links now verified for both expense/income records through T025. Real transitions
      between distinct production asset graphs reproduced an old hashed-module availability gap;
      see research.md and T026. Full update workflow and broader browser coverage remain pending.
- [ ] T015 Measure startup and interaction baselines: first visit, warm return, cold offline restart,
      and update; representative small/large datasets and supported devices. Attribute shell, worker,
      Wasm, local query, readiness, result transformation, balance calculation, and render costs. Set
      performance budgets from evidence without delaying the first local-usability correction.
      Capture comparable pre-change evidence before modifying a measured path; the broader device
      matrix is not a prerequisite for correcting verified remote dependencies (approved Q3).
      Initial production baseline recorded in research.md/startup-baseline.json: three profiles,
      first visit plus warm and cold-offline saved-detail usability. Next: session/query/readiness
      attribution; large datasets/devices/update scenarios and budgets remain open.
      Follow-up traces in startup-profile.json place returning session-open medians at 111/167 ms
      (warm/cold), before later membership/form observation updates. CDP collection overhead checked.
      Query delivery and browser CPU/render attribution remain unresolved; no optimization selected.
      Page CPU follow-up captured roughly 0.94 s sampled Wasm work on returning detail startup;
      direct enabled-form observations were approximately 2.16/2.19 s warm/cold in one profile.
      See startup-cpu-profile.json. Query/runtime cost is the next target; duplicate work, worker
      CPU, large histories and optimization benefit are not established by these samples.
- [x] T016 Evaluate earlier page-owned initialization using `src/app.html`, `src/routes/+layout.svelte`,
      `src/lib/jazz-session.ts`, and `application-readiness.ts`. Establish earliest supported start,
      singleton ownership, cancellation/auth transitions, dependency payload, and measured overlap.
- [x] T017 Evaluate `InstallEvent.addRoutes()` for existing public precache paths: browser matrix,
      feature detection, cache key parity, cache misses, update lifecycle, and cold startup savings.
      Preserve fetch-handler fallback; adopt only with evidence of benefit and compatibility.
- [x] T018 Assess navigation preload only for navigation paths that actually need network HTML;
      document why it is rejected for precached shell hits or identify a concrete beneficial case.
- [ ] T019 Evaluate Wasm download/compilation preparation and supported `runtimeSources.wasmModule`
      reuse across page/broker realms. Inspect actual default and override loaders, stable asset scope,
      module persistence/message support, contention, and fallback. Compare elapsed startup and memory;
      do not assume a compiled module equals a running database or supported service-worker handoff.
- [x] T020 Profile application-worker candidates after accounting for Jazz's existing SharedWorker.
      Examine calculations/parsing/subscription transforms/rendering; define message payloads, explicit
      local-first defaults, supported database bridge, lifecycle and cancellation. Keep UI owners in the
      page. Do not migrate machines solely because they make asynchronous calls.
- [ ] T021 Evaluate service-worker install/update cost: total asset size, duplicate downloads,
      foreground contention, retention of old version assets, quota/eviction, and browsers. Preserve
      existing update consent and no mandatory remote-sync wait; recommend changes only from evidence.

## Follow-through

- [x] T022 Turn accepted investigation outcomes into separately reviewed implementation slices and
      appropriate tests after approval. Keep rejected/unproven ideas documented, with no implied
      always-running service worker, unsupported Jazz handoff, or automatic provider fetching.
- [x] T023 Reconcile research, legacy specs, memory, and completion status after each delivery. Record
      measured results and limitations; distinguish completed research, implemented behavior, and
      validated guarantees. Do not mark this feature complete while approved investigations remain.

## Reviewed runtime findings: focused fixes

- [x] T024 Include emitted worker dependencies in the Vite client manifest used by SvelteKit precache.
      Implementation approved; isolated build/type checks and four production browser checks pass.
      Precache contains worker-local Wasm; a saved account survives browser-process exit and offline
      restart with HTTP cache cleared. Public-only caching and update consent remain covered.
      Additional 19.3 MB install asset documented. See plan.md, T013 fix A.
- [x] T025 Map supported dynamic finance-detail document navigations to the corresponding cached
      public shell without caching data/auth/API responses. Review route matching and file scope
      separately; then extend T014 cold restart/direct-link coverage.
      Implementation committed as 5bb7225. Saved expense/income details survive browser-process exit
      and offline restart with HTTP cache cleared; original workspace/hash and local values remain.
      All 15 PWA cases verified (13 initially, two after canonical-scope fixture correction);
      fallback-boundary, cache-scope and update-consent checks pass. Tests committed as 0e5e1d6.
- [ ] T026 **Deferred by user:** preserve older immutable assets across build activation. The probe
      reproduced an asset-level failure, not a failed user navigation. Keep existing update behavior
      for this slice; document the older-tab/reload limitation. Revisit with a concrete workflow and
      T021 storage/update measurements before designing cache retention or client reporting.
- [ ] T027 Fix attachment read authorization before broad background preparation. The minimal
      real-browser probe reproduced readable links/files/parts for an unreadable parent transaction.
      Proposed one-predicate fix: require allowedTo.read('transaction') in transactionAttachments
      allowRead instead of checking parent existence. Review implementation, then add focused
      permission regression coverage and rerun the browser reproduction. Preserve readable-parent,
      linked-file and account-grant semantics; no client-side filtering workaround.
      Proposed predicate rejected by Jazz alpha.59 during permission publication (invalid generated
      accountId reference on transactionAttachments). Implementation and its added tests reverted
      per user direction. No repair shipped; broad preparation remains paused pending a supported fix.

## Consolidated follow-through

The current decisions are in investigation-results.md. T009 covers the implemented startup slice;
T012 owns the remaining durable unknown-outcome work. T016/T017/T018/T020 are closed as evaluated
and not adopted. T022/T023 record this batch's test follow-through and reconciliation, not feature
completion. T010/T011/T012 remain unbuilt; T014/T015/T019/T021 retain the stated compatibility,
measurement and storage limits. T026 stays deferred and T027 unresolved.
