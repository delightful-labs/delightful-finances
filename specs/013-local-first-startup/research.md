# Research: Local-first usability and startup

Researched 2026-10-29. App declares Jazz `2.0.0-alpha.59`, SvelteKit `^3.0.1`,
XState `^5.33.2`. Jazz evidence includes the published alpha.59 npm archive read in memory,
not an installed dependency tree. No production build, runtime measurements, or tests were run.

## Evidence and boundaries

Primary references (current documentation can change independently of the pinned SDK):

- [Jazz sync](https://jazz.tools/docs/concepts/how-sync-works)
- [Read/write tiers](https://jazz.tools/docs/reference/durability-tiers)
- [Permissions](https://jazz.tools/docs/auth/permissions)
- [Mutation errors](https://jazz.tools/docs/writing/writing-data)
- [Transactions](https://jazz.tools/docs/writing/transactions)
- [Local-first identity](https://jazz.tools/docs/auth/local-first-auth)
- [Client/runtime configuration](https://jazz.tools/docs/getting-started/client-setup)
- [Jazz internals](https://jazz.tools/docs/reference/internals)
- [SvelteKit manifest](https://svelte.dev/docs/kit/$app-manifest)
- [Service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope)
- [SharedWorker exposure](https://html.spec.whatwg.org/multipage/workers.html#shared-workers-and-the-sharedworker-interface)
- [Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Worker)
- [Structured cloning](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [Static routing](https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes)
- [Navigation preload](https://developer.chrome.com/docs/workbox/navigation-preload)
- [Wasm compilation](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/compileStreaming_static)

## Jazz reads, writes, authorization, and storage

Verified alpha.59 package paths are relative to `jazz-tools/`:

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Browser query defaults are local; propagation defaults to full | `dist/runtime/client.js`, `resolveDefaultDurabilityTier` and `resolveEffectiveQueryExecutionOptions` | Ordinary browser reads need no remote preflight and still sync |
| `LocalFirst` includes cached/pending data; `Remote` uses authoritative scope | `dist/runtime/client.js`, `dist/runtime/db.js`; tier docs | Choose local-first for ordinary use; remote waits offline |
| `LocalFirstUnlessEmpty` can wait when empty | Tier docs and alpha.59 runtime/declarations | Its name does not guarantee immediate local delivery |
| Empty-unless-remote waits up to five seconds during connection setup; connected first-answer waits have no fixed limit | Current tier docs; package confirms read mode, not an independent timing experiment | A live but stalled server differs from a known disconnected client |
| Local write waits confirm persistence; global waits require acceptance | Package write handles and transaction docs | Preserve local save completion plus later rejection reporting |
| Mergeable transactions support offline local commits; exclusive acceptance requires authority | Transaction docs and package handle shape | Do not replace ordinary writes with exclusive confirmation |
| Persistent browser runtime owns IndexedDB and sync in a SharedWorker | Internals docs; `dist/runtime/browser-worker-config.js`, worker assets | Much Jazz work is already off-thread; memory-driver behavior differs |
| Query defaults can be global outside window/document environments when a server is configured | `dist/runtime/client.js` runtime detection | Worker migrations must explicitly verify local-first defaults |
| `canInsert/canRead/canUpdate/canDelete` request authoritative advice | `dist/runtime/db.js` and `client.js` | Do not introduce them as ordinary local action prerequisites |
| Local-first account creation works offline after assets are available | Auth docs; `dist/session/create-jazz-session.js` | App bootstrap can introduce a network dependency beyond identity creation |

Local-first is a writable replica, not merely stale-while-revalidate HTTP response caching. Only
requested/received records are available offline. Read coverage, relationship completeness, data
volume, pagination, account scope, storage eviction, and attachments need explicit investigation.
Server policy enforcement remains authoritative; locally known permission data can become stale.
Observed revocation invalidates current capabilities; disconnected devices cannot promise immediate
revocation awareness or erasure of downloaded data. Unknown writes require reconciliation, not replay.

## Application audit

| Area | Observed code | Interpretation |
| --- | --- | --- |
| Session | `src/routes/+layout.svelte`, `src/lib/jazz-session.ts`: `initial: 'local-first'`; start requested on mount | Correct identity mode; earlier page bootstrap remains an investigation |
| Initialization | `src/lib/machines/workspace-initialization.ts`: profiles and organizations read together with `LocalFirstUnlessEmpty`; absent marker enters `Remote` discovery | Even an empty secondary query can hold startup; missing provenance blocks readiness |
| Shell and queries | `src/lib/components/WorkspaceBootstrap.svelte`: shell and organization/account/balance queries depend on initialized workspace readiness | Local data is downstream of initialization; decouple use from provenance safely |
| Readiness | `src/lib/machines/readiness.ts`: current identity/selection/membership gates; separate integrity report for bank-sync eligibility | Preserve scope checks; integrity is not a universal finance-rendering gate |
| Integrity | `src/lib/machines/workspace-integrity.ts`: local assessment then remote suspected-repair confirmation | Do not replace missing attribution with unconditional repair; defer repair independently |
| Saves | `src/lib/data.ts` and persistence machines generally wait at local tier | Existing ordinary persistence mostly matches desired behavior |
| Save recovery | `src/lib/machines/transaction-save.ts`: remote reads for unknown ledger/Check outcomes | Exceptional recovery may wait; keep it scoped and cancellable |
| Seeding | `workspace-fake-data.ts`, `fake-data.ts`: opt-in; local empty result triggers remote reads and exclusive acceptance on initialization path | Preserve seed deduplication while removing seeding from critical readiness |
| Rejections | `application-readiness.ts`: `db.onMutationError` observation | Existing late-rejection path must survive changes; completeness needs audit |

These are static findings, not proof that they dominate current measured startup time. A partial
replica cannot be made complete by changing a tier; missing required local facts still limit actions.
Stable bootstrap IDs already exist but do not prove safe cross-device creation or blind retry.

## Service workers and earlier startup

`src/service-worker/index.ts` precaches `immutable`, `assets`, and `prerendered`, serves matching
same-origin GET paths cache-first, and activates updates only on explicit message. The app
prerenders public shells via `src/routes/+layout.ts`. No explicit early Jazz preload appears in
`src/app.html`; SvelteKit-generated preload output was not inspected.

SvelteKit lists Vite-generated files in `immutable`. Jazz uses a statically analyzable worker URL
in `dist/runtime/browser-worker-assets.js`. This suggests emitted runtime assets may be precached;
it does NOT establish that the full worker import/Wasm chain or worker-originated requests work
offline. There is no generated production output in this checkout to verify that chain.

Alpha.59's `dist/runtime/wasm-loader.js` explicitly configured URL path fetches bytes, validates the
Wasm header, and initializes from bytes. It reuses initialization for the same URL within one realm.
Do not generalize that path to every default browser load or assume cross-realm compilation reuse.

| Option | Established fact | Remaining question / decision |
| --- | --- | --- |
| Complete runtime precache | Cache API can retain executable assets for repeat/offline visits | Inspect production manifest, worker imports, Wasm, MIME/URLs, cold restart, and update compatibility |
| Existing cached shells | Already cache-first; avoids navigation network dependency | Measure shell lookup and service-worker cold start; direct detail routes need audit |
| Static routing | `InstallEvent.addRoutes()` can serve cache/network rules before worker JS starts; limited availability | Feature detection, equivalent keys/fallback/update rules, actual benefit on supported browsers |
| Navigation preload | Overlaps network HTML request with service-worker startup | Usually wasted for our precached shell; evaluate only actual network navigation cases |
| Earlier page-owned Jazz start | Window can construct SharedWorker without full UI mounted | Find earliest supported singleton initialization, assets, lifecycle ownership, and measurable overlap |
| Wasm preparation | `compileStreaming()` can compile separately; Jazz accepts `runtimeSources.wasmModule` | Verify broker path accepts/reuses module, realm/version identity, persistence/support, and end-to-end savings |
| Jazz in service worker | SharedWorker constructor is exposed only to Window; service workers terminate and lose globals | Existing persistent runtime cannot simply be launched here; alternative runtime/handoff is unproven |
| Background wakeup | Service-worker events can run without an open page, browser-controlled | No guaranteed always-warm app; no automatic bank-provider fetching; no supported Jazz sync handoff established |

Current handler uses pathname-only matching and cache keys. Jazz override URLs require immutable
`wasmVersion` when explicitly configured, so query-bearing asset identity must be audited before
adding overrides. Do not assume stripping query strings is safe for all resources. Cache Storage
is separate from HTTP caching; warm HTTP cache or a surviving worker must not conceal precache gaps.
All-assets installation can also compete with current work; sizes, duplicate downloads, update
cost, and storage budget require measurement before changing the installation policy.

## Application workers

XState actors are logical execution units, not automatic threads. A selected machine can be
instantiated in a worker with command/result messages; function callbacks, live actor references,
and database handles cannot simply be cloned. Keep UI/focus/navigation owners in the page. CPU-heavy
parsing/calculation or independent domain work may be candidates; a machine mostly awaiting Jazz
may gain little. Main-thread transformations, subscription delivery, repeated copying, balance
calculation, and rendering should be profiled before moving owners. Dedicated workers also cannot
construct SharedWorker directly: establish a supported database/message bridge before proposing one.

## Existing coverage and missing evidence

- `tests/pwa.e2e.ts` covers prepared shell navigation/reload and update behavior, but warms the app
  online first. Establish a fresh runtime and eliminate HTTP-cache masking for full cold-start proof.
- `tests/offline-access.e2e.ts` covers warmed cached scope/roles and local edits/reconnection.
- `tests/bank-sync-offline.e2e.ts` covers unavailable explicit provider actions, not general data sync.
- Unit coverage exists for initialization, integrity, save recovery, seeding, and application readiness.
  Inspect fixtures/assertions before changing behavior; do not run to discover statically visible drift.
- No numerical baseline, supported-device matrix, complete offline coverage policy, module-preparation
  benchmark, static-routing experiment, or safe recovered-identity bootstrap protocol was established.

## Guidance reconciliation inventory

| File / topic | Disposition |
| --- | --- |
| Constitution I | Already agrees; clarify no remote first-answer/timeout requirement for ordinary available local work |
| Jazz memory | Add verified tiers, defaults, workers, and absence-versus-availability distinction now |
| XState memory: readiness | Clarify local usable states versus remote reconciliation, retaining ownership/correlation |
| Testing memory | Add full cold offline restart and live-unresponsive-remote verification guidance |
| `006/plan.md`, Initialization | Supersede remote provenance as a universal usability prerequisite; retain duplicate prevention |
| `006/spec.md`, Story 1 scenario 4 | Clarify “stale access” means superseded observed facts, not a mandatory fresh remote check |
| `008/contracts/workspace-integrity-report.md` | Reconcile finance ineligibility table with attribution-only nonblocking intent; trace actual consumers |
| `008/fake-data.md` | Preserve authoritative seed safety while making seeding independent of local readiness |
| `009/spec.md`, staged-save recovery | Preserve narrow remote reconciliation; document deferred recovery without unrelated UI blocking |
| `007/spec.md` and PWA review | Preserve update consent and local data; extend asset/cold-start evidence, do not rewrite prior results |

Approved online-only access administration, passkey/secret protections, and explicit provider fetching
are deliberate boundaries, not contradictions to remove silently. Reconciliation tasks must distinguish
historical implementation descriptions, actual conflicts, clarifications, and retained exceptions.
