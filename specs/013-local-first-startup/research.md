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

| Finding                                                                                                                | Evidence                                                                                             | Consequence                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Browser query defaults are local; propagation defaults to full                                                         | `dist/runtime/client.js`, `resolveDefaultDurabilityTier` and `resolveEffectiveQueryExecutionOptions` | Ordinary browser reads need no remote preflight and still sync            |
| `LocalFirst` includes cached/pending data; `Remote` uses authoritative scope                                           | `dist/runtime/client.js`, `dist/runtime/db.js`; tier docs                                            | Choose local-first for ordinary use; remote waits offline                 |
| `LocalFirstUnlessEmpty` can wait when empty                                                                            | Tier docs and alpha.59 runtime/declarations                                                          | Its name does not guarantee immediate local delivery                      |
| Empty-unless-remote waits up to five seconds during connection setup; connected first-answer waits have no fixed limit | Current tier docs; package confirms read mode, not an independent timing experiment                  | A live but stalled server differs from a known disconnected client        |
| Local write waits confirm persistence; global waits require acceptance                                                 | Package write handles and transaction docs                                                           | Preserve local save completion plus later rejection reporting             |
| Mergeable transactions support offline local commits; exclusive acceptance requires authority                          | Transaction docs and package handle shape                                                            | Do not replace ordinary writes with exclusive confirmation                |
| Persistent browser runtime owns IndexedDB and sync in a SharedWorker                                                   | Internals docs; `dist/runtime/browser-worker-config.js`, worker assets                               | Much Jazz work is already off-thread; memory-driver behavior differs      |
| Query defaults can be global outside window/document environments when a server is configured                          | `dist/runtime/client.js` runtime detection                                                           | Worker migrations must explicitly verify local-first defaults             |
| `canInsert/canRead/canUpdate/canDelete` request authoritative advice                                                   | `dist/runtime/db.js` and `client.js`                                                                 | Do not introduce them as ordinary local action prerequisites              |
| Local-first account creation works offline after assets are available                                                  | Auth docs; `dist/session/create-jazz-session.js`                                                     | App bootstrap can introduce a network dependency beyond identity creation |

Local-first is a writable replica, not merely stale-while-revalidate HTTP response caching. Only
requested/received records are available offline. Read coverage, relationship completeness, data
volume, pagination, account scope, storage eviction, and attachments need explicit investigation.
Server policy enforcement remains authoritative; locally known permission data can become stale.
Observed revocation invalidates current capabilities; disconnected devices cannot promise immediate
revocation awareness or erasure of downloaded data. Unknown writes require reconciliation, not replay.

## Application audit

| Area              | Observed code                                                                                                                                                  | Interpretation                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Session           | `src/routes/+layout.svelte`, `src/lib/jazz-session.ts`: `initial: 'local-first'`; start requested on mount                                                     | Correct identity mode; earlier page bootstrap remains an investigation                   |
| Initialization    | `src/lib/machines/workspace-initialization.ts`: profiles and organizations read together with `LocalFirstUnlessEmpty`; absent marker enters `Remote` discovery | Even an empty secondary query can hold startup; missing provenance blocks readiness      |
| Shell and queries | `src/lib/components/WorkspaceBootstrap.svelte`: shell and organization/account/balance queries depend on initialized workspace readiness                       | Local data is downstream of initialization; decouple use from provenance safely          |
| Readiness         | `src/lib/machines/readiness.ts`: current identity/selection/membership gates; separate integrity report for bank-sync eligibility                              | Preserve scope checks; integrity is not a universal finance-rendering gate               |
| Integrity         | `src/lib/machines/workspace-integrity.ts`: local assessment then remote suspected-repair confirmation                                                          | Do not replace missing attribution with unconditional repair; defer repair independently |
| Saves             | `src/lib/data.ts` and persistence machines generally wait at local tier                                                                                        | Existing ordinary persistence mostly matches desired behavior                            |
| Save recovery     | `src/lib/machines/transaction-save.ts`: remote reads for unknown ledger/Check outcomes                                                                         | Exceptional recovery may wait; keep it scoped and cancellable                            |
| Seeding           | `workspace-fake-data.ts`, `fake-data.ts`: opt-in; local empty result triggers remote reads and exclusive acceptance on initialization path                     | Preserve seed deduplication while removing seeding from critical readiness               |
| Rejections        | `application-readiness.ts`: `db.onMutationError` observation                                                                                                   | Existing late-rejection path must survive changes; completeness needs audit              |

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

| Option                        | Established fact                                                                                       | Remaining question / decision                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Complete runtime precache     | Cache API can retain executable assets for repeat/offline visits                                       | Inspect production manifest, worker imports, Wasm, MIME/URLs, cold restart, and update compatibility           |
| Existing cached shells        | Already cache-first; avoids navigation network dependency                                              | Measure shell lookup and service-worker cold start; direct detail routes need audit                            |
| Static routing                | `InstallEvent.addRoutes()` can serve cache/network rules before worker JS starts; limited availability | Feature detection, equivalent keys/fallback/update rules, actual benefit on supported browsers                 |
| Navigation preload            | Overlaps network HTML request with service-worker startup                                              | Usually wasted for our precached shell; evaluate only actual network navigation cases                          |
| Earlier page-owned Jazz start | Window can construct SharedWorker without full UI mounted                                              | Find earliest supported singleton initialization, assets, lifecycle ownership, and measurable overlap          |
| Wasm preparation              | `compileStreaming()` can compile separately; Jazz accepts `runtimeSources.wasmModule`                  | Verify broker path accepts/reuses module, realm/version identity, persistence/support, and end-to-end savings  |
| Jazz in service worker        | SharedWorker constructor is exposed only to Window; service workers terminate and lose globals         | Existing persistent runtime cannot simply be launched here; alternative runtime/handoff is unproven            |
| Background wakeup             | Service-worker events can run without an open page, browser-controlled                                 | No guaranteed always-warm app; no automatic bank-provider fetching; no supported Jazz sync handoff established |

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

| File / topic                                  | Disposition                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Constitution I                                | Already agrees; clarify no remote first-answer/timeout requirement for ordinary available local work   |
| Jazz memory                                   | Add verified tiers, defaults, workers, and absence-versus-availability distinction now                 |
| XState memory: readiness                      | Clarify local usable states versus remote reconciliation, retaining ownership/correlation              |
| Testing memory                                | Add full cold offline restart and live-unresponsive-remote verification guidance                       |
| `006/plan.md`, Initialization                 | Supersede remote provenance as a universal usability prerequisite; retain duplicate prevention         |
| `006/spec.md`, Story 1 scenario 4             | Clarify “stale access” means superseded observed facts, not a mandatory fresh remote check             |
| `008/contracts/workspace-integrity-report.md` | Reconcile finance ineligibility table with attribution-only nonblocking intent; trace actual consumers |
| `008/fake-data.md`                            | Preserve authoritative seed safety while making seeding independent of local readiness                 |
| `009/spec.md`, staged-save recovery           | Preserve narrow remote reconciliation; document deferred recovery without unrelated UI blocking        |
| `007/spec.md` and PWA review                  | Preserve update consent and local data; extend asset/cold-start evidence, do not rewrite prior results |

Approved online-only access administration, passkey/secret protections, and explicit provider fetching
are deliberate boundaries, not contradictions to remove silently. Reconciliation tasks must distinguish
historical implementation descriptions, actual conflicts, clarifications, and retained exceptions.

## T008 ordinary-write audit after local-readiness delivery

Scope: static inspection of the current checkout with installed `jazz-tools@2.0.0-alpha.59`.
No new runtime experiment or tests were run for this audit. Earlier T005–T007 validation results
remain separately recorded in `plan.md`; they do not prove every write path works offline.

| Path                                                                              | Evidence                                                                                                                                                                                                                  | Disposition                                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Profile name/avatar, workspace rename, account/category/tag creation and archival | Every returned write in `src/lib/data.ts` waits with `{ tier: 'local' }`; helpers validate before one write                                                                                                               | No remote completion gate to remove                                                                                              |
| Ledger and Check persistence                                                      | `independent-transaction-persistence.ts` and `check-create-persistence.ts` commit mergeable transactions and explicitly settle at local tier                                                                              | Preserve existing local completion, scope rechecks, rollback, and rejection/unknown classifications                              |
| Staged transaction save                                                           | `transaction-save.ts` allocates checkpoint transaction/Check IDs before writing; normal Check lookup is LocalFirst                                                                                                        | Preserve IDs and local child settlements; no ordinary remote preflight found                                                     |
| Unknown ledger outcome                                                            | `reconcilingLedger` is selected only for `transactionSettlement === 'unknown'`; `makeReadLedger` uses Remote and compares submitted values/tags                                                                           | Retain narrow remote reconciliation; do not treat an absent row as permission to replay. Navigation/reload recovery remains T012 |
| Unknown Check outcome                                                             | `readCheck` selects Remote only for `checkSettlement === 'unknown'`; normal lookup uses LocalFirst                                                                                                                        | Retain uncertainty check and compatibility decisions; no blanket tier replacement                                                |
| Workspace creation                                                                | `workspace-creation-transaction.ts` stages stable IDs and waits for local settlement                                                                                                                                      | Preserve creation protocol. Automatic bootstrap eligibility/provenance remains T010                                              |
| Transfer creation/link/unlink/deletion                                            | `internal-transfer-create.ts` and `internal-transfer.ts` use local settlement adapters and transaction/transfer IDs for mutation tracking                                                                                 | No authoritative completion wait found; preserve original operation scope and tracked IDs                                        |
| Attachment writes                                                                 | Upload, replacement, and removal actors wait for local writes; relationship/part reads explicitly use local tiers                                                                                                         | No remote save gate found. On-demand download/retention coverage remains T011                                                    |
| Late mutation rejection                                                           | Application `running` state invokes `observeMutationRejections`; `db.onMutationError` forwards transaction ID. `MUTATION_REJECTED` records generic or tracked-transfer notice, rendered by root `MutationRejectionNotice` | Preserve observer and notice independently of workspace initialization/seeding/integrity. No changes made                        |

A repository search for explicit Remote/LocalFirstUnlessEmpty reads, global/edge waits, no-argument
waits, and authoritative permission preflights found remaining remote boundaries in uncertain-save
recovery, bootstrap, attribution repair, and exclusive fake-data seeding. These have separate owner
tasks and safety requirements; they are not ordinary save gates. No speculative persistence refactor
is warranted by this audit.

Installed SDK inspection confirms `createJazzSession` awaits `createJazzSessionOwner`; that owner
awaits account selection and `openClient` before returning an initially ready local-first session
(`dist/session/create-jazz-session.js`, `dist/session/state.js`). This supports the current initial
mutation-observer attachment but does not prove every identity-replacement/reload scenario.

Coverage boundaries: `data.test.ts` checks local wait options and local failures; persistence tests
cover local outcomes and interrupted/uncertain writes. `transaction-save.test.ts` covers Remote only
for uncertain reconciliation and stable-ID retries. The application readiness tests verify rejection
correlation and unsubscribe, but several inject `MUTATION_REJECTED` directly; those assertions alone
do not establish SDK callback delivery or actual server rejection across restart. Full rejection,
partial-replica, unresponsive-remote and cold-start guarantees remain T009/T012–T014 work.

Decision: T008 audit complete with no verified ordinary remote gate requiring an application change.
Preserve existing persistence and rejection behavior; investigate deferred recovery and replica
coverage through their scoped tasks rather than broadening this audit into a rewrite.

T009 callback follow-up: application-readiness tests now invoke the callback registered through
`db.onMutationError` using complete synthetic rejection payloads. Both untracked and tracked-transfer
cases verify the app notice, omission of server error details from that notice, retained workspace,
dismissal and unsubscribe after graceful shutdown. The targeted suite passes all 48 tests;
application and test type checks pass. These are callback-adapter tests, not a real server-rejection
or cold-restart experiment. Existing direct-event tests remain useful for broader correlation cases.

## T010 identity provenance and offline-bootstrap investigation

Evidence: installed `jazz-tools@2.0.0-alpha.59` declarations and implementation, inspected statically.
No SDK upgrade, network experiment, schema/persistence change, or tests were performed in this
investigation. This section records supported surface versus internal behavior; it does not claim
an offline-safe bootstrap protocol has been implemented.

| Surface                      | Evidence                                                                                | Finding                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public account handle        | `dist/accounts/state.d.ts`, `AccountHandle`                                             | Exposes branded handle, ID and identity issuer/subject; no creation/restoration provenance                                                                                                                         |
| Public session snapshot      | `dist/session/state.d.ts`, `JazzSessionSnapshot`                                        | Exposes status, account/client, pending operation, error and recovery scope; pending is transient, not durable provenance                                                                                          |
| Session configuration        | `dist/session/create-jazz-session.d.ts`                                                 | `initial` accepts local-first/backend configuration; no public bootstrap-result/provenance hook                                                                                                                    |
| Automatic first identity     | `dist/session/state.js`, `dist/accounts/persistence.js`                                 | `ensureAutomaticLocalFirst` atomically selects/adopts a retained root under AccountStore update. Internal code knows whether it chose an existing root; the session returns only the resulting account             |
| Browser selection storage    | `dist/accounts/create-account-manager.js`                                               | Default AccountStore uses Web Locks and durable localStorage writes. A separate app read of empty storage can race another tab or precede restore/adoption; it cannot establish final newness                      |
| Explicit identity operations | `AccountManager.createLocalFirst`, `JazzSession.createLocalFirst` / `restoreLocalFirst` | An app initiating an explicit operation knows its intent while running. That does not provide crash-safe bootstrap provenance after restart, or preserve the automatic cross-tab root-selection protocol by itself |
| Custom AccountStore          | `dist/accounts/persistence.d.ts`                                                        | Supports durable atomic transform, but its payload is opaque SDK selection data, not a documented new-identity event. Do not parse credential serialization to infer product policy                                |

Current app bootstrap uses stable user-derived profile/workspace/membership IDs in
`workspace-initialization.ts`, then the mergeable `workspace-creation-transaction.ts`. Its transaction
checks profile/organization/membership/category facts and owns local settlement/rollback. The initial
remote discovery is currently what prevents recovered empty replicas from authorizing creation.
Removing that discovery without replacing its eligibility evidence is unsafe.

The separate explicit workspace-creation path journals its prepared attempt through
`workspace-creation-operation.ts` / `workspace-creation-journal.ts`, then reconciles and rechecks
before writing. Initial automatic bootstrap currently bypasses that journal. Stable IDs can bound
duplicates but do not establish newness, protect against restoring a previously deleted membership,
or resolve an uncertain commit after local eviction. The existing journal is a useful resource-owner
pattern, not a ready-made authorization to recreate absent rows.

### Options and recommendation

1. Prefer a supported SDK provenance/creation hook tied to atomic root selection. The contract must
   distinguish a newly generated winning identity from adopted/restored/unknown identities and allow
   an application bootstrap intent to survive the handoff or fail conservatively. A transient boolean
   alone leaves a crash gap. This requires SDK work or a version with a verified supported contract;
   no such public contract was found in alpha.59.
2. Design an application-owned explicit identity-creation flow using supported session methods and
   durable bootstrap ownership. This is a larger reviewed session/persistence change: it must retain
   cross-tab root selection, account-selection durability, interrupted creation recovery and SDK
   identity-change drain. Do not assume a separate marker and SDK storage update form one atomic
   operation. The design must state which crash windows conservatively become unknown.

Retain existing discovery for unknown/recovered identities while this mechanism is unresolved.
Available local finance data remains independently usable under T005. This is an implementation
limitation, not a change to the approved product requirement that a genuinely new identity can create
its first workspace offline. Do not implement a local-empty shortcut or import internal SDK helpers.

Any approved protocol must model provenance assessment → acquire/journal bootstrap ownership →
prepare stable IDs → reconcile known attempt → stage mergeable bootstrap → local settlement → retire
intent, with explicit unknown outcome, cancellation, replacement, failure and cleanup paths. The
protocol must prevent retries from resurrecting membership and must not couple recovered-identity
remote discovery to unrelated local capabilities. Show its statechart and file scope before coding.

Disposition: SDK/public-API limitation identified; T010 implementation remains pending a provenance
mechanism decision and concurrent-bootstrap design review. No product clarification has been assumed.

## T011 offline-preparation scope audit (partial investigation)

Evidence: current application queries/schema/permissions and installed Jazz alpha.59 `Db` declarations.
Static audit only: no quota, eviction, history-volume, multi-workspace completeness or attachment
network-transfer experiment was run. T011 remains open until those evidence gaps are resolved.

### Current coverage

- `WorkspaceBootstrap.svelte` subscribes to accessible organizations, the selected workspace's active
  accounts, selected-workspace transactions for balances, current selected membership, and selected
  integration records. This warms transactions for the selected workspace but does not prepare every
  accessible workspace or all relationships needed by detail/edit pages.
- `TransactionView.svelte` subscribes to all matching transactions of the selected workspace/kind,
  plus accounts, categories, tags and transaction-tag links. `TransactionList.svelte` paginates the
  already received groups in memory (25 items per page). The current list does not use database
  offset pagination; earlier offset concerns are a future-preparation risk, not a finding that this
  implementation skips records through database offsets.
- `TransactionEditEntry.svelte` uses `transactionDetailQuery` for the opened record. That query includes
  account/category/tag/Check relationships and `attachments.file.parts`. It must not be reused as the
  background preparation query: part rows contain file bytes, while `files` holds file name, MIME,
  size and scope metadata. Viewing detail currently requests these attachment relationships; no
  claim is made that merely opening a list downloads every attachment.
- `checks`, `internalTransfers`, transaction batches/templates, grants, archived accounts/categories/
  tags, and attachment/file metadata need explicit coverage. Warming only active account selectors
  or visible list rows omits facts needed for existing history and later detail navigation.
- No app-level `navigator.storage.persist/estimate/persisted` usage or complete-replica preparation
  workflow was found. IndexedDB persistence alone does not establish all-workspace availability,
  quota guarantees or retention after the browser evicts storage.

### Scope for a preparation design

| Records                                                      | Preparation boundary                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Organizations and current-user membership/grant facts        | All accessible workspace discovery; retain current authorization checks, not creator/owner shortcuts                           |
| Accounts, transactions, categories, tags and transactionTags | All accessible rows across discovered workspaces, including archived references and all history; retain account grant policies |
| Checks, internalTransfers, batches/templates                 | Explicit relationships and policy-permitted rows; do not assume transactions alone populate related tables                     |
| transactionAttachments and files                             | Attachment links and file metadata for readable transactions, preserving file-reference permissions                            |
| fileParts/content                                            | On demand; do not include parts in preparation queries or claim content is available from metadata alone                       |
| Integration metadata                                         | Only policy-permitted connection/link/history data; ciphertext stays encrypted, no passkey unlock or provider request          |
| uploads and legacy denied rows                               | Do not override deny policies or assume every schema table belongs in the preparation set                                      |

Read policies remain authoritative. `files` read access follows readable attachment references and
`fileParts` follows file access (`permissions.ts`); organization ID on a file is not a substitute for
those relationships. Preparation must not broaden permissions, restore missing rows or treat
absence as authority to repair. Provider credentials/transactions are never fetched automatically.

### Recommended architecture, pending review and experiments

Use an application-tree-owned preparation actor bound to the session/database, independent of
selected workspace and initialization provenance. Its integration owns SDK subscriptions; the
statechart owns workspace discovery, bounded work scheduling, retry, interruption and cleanup.
Use explicit LocalFirst subscription options so available records remain usable and upstream
propagation can continue without a remote first-answer gate. Track dynamic per-workspace children
and stop obsolete scopes on observed access loss/identity replacement. Keep provider and UI owners
in the page; this does not require an application worker.

Installed `Db.subscribe` supports typed object callbacks including terminal errors and returns an
unsubscribe function. It delivers complete current result arrays on updates; the SDK documents
fresh allocations. Unbounded subscriptions across every table/workspace can therefore add memory,
copying and transform costs even though Jazz already has a SharedWorker. Compare a small bounded
subscription set with staged background snapshot acquisition before choosing a workload policy.
Do not select arbitrary concurrency or retention budgets without representative measurements.

Local subscription delivery does not prove remote completeness. Report observed workspace/table
counts and local availability without presenting them as a percentage of all remote data. If an
explicit background remote snapshot is used to establish a checkpoint, keep its wait scoped to
preparation and define what a multi-query checkpoint actually guarantees. A later remote change,
partial relation or interrupted read must invalidate that completeness claim. Do not scan offset
pages over a changing/incomplete replica and infer completion from a short local page.

Before implementation: verify scoped subscription/relationship coverage and metadata-versus-byte
transfer with never-opened records; measure large-history memory and update costs; exercise quota
failure and browser eviction; determine whether attachment retention can use supported SDK APIs
without deleting shared domain rows. Current attachment removal deletes application rows and is
not a cache-eviction operation. Requesting browser persistence can reduce eviction risk on supporting
browsers but cannot be represented as an unconditional guarantee.

Disposition: query/schema coverage audit and architecture recommendation recorded. No background
preparation, progress UI, data-retention policy or offline-completeness guarantee implemented.

### T011 runtime probe: unopened shared workspace and attachment metadata

Environment: the existing development agent at `http://127.0.0.1:5186`, disposable in-memory Jazz
server, seeding enabled, two fresh isolated Playwright Chromium contexts, installed Jazz alpha.59.
The probe was orchestrated through explicit XState steps with browser cleanup on success/failure.
It did not touch existing browser storage or identities. No cold restart or persisted-storage
inspection was performed. A first fixture attempt ran before optional seeds existed and stopped;
the completed run explicitly waited for the owner's three seeded accounts independently of page
readiness, consistent with T006.

Reproduction sequence:

1. Open `/accounts` in two independent fresh contexts and wait for initialized scoped pages. Wait
   separately for three seeded accounts in the owner workspace. Retain each current account ID and
   URL workspace ID; do not navigate the recipient to the owner's workspace.
2. In the owner workspace, insert one ordinary expense (123 USD minor units) referencing an existing
   active account/category. Create a file metadata row referencing that transaction, a fileParts row
   with four synthetic bytes `[1,2,3,4]`, and a transactionAttachments link. These writes each wait for
   global acceptance so a delayed fixture commit cannot be confused with missing preparation.
   Use new UUIDs for all rows. The bytes are opaque probe content, not a valid displayable image.
3. Grant the recipient viewer membership with `accountAccessMode: all` in the owner workspace. The
   recipient stays on its own Accounts page and requests `app.organizations.orderBy('id')` at Remote.
   It observes two accessible workspaces. No account/finance/detail query for the shared workspace
   has been requested by its UI.
4. Call recipient `db.disconnect()`. Query its shared-workspace accounts, synthetic transaction,
   attachment link, file metadata and fileParts using `tier: 'local'`; record counts. Disconnecting
   prevents those observations from warming the replica through an upstream response.
5. Reconnect and request only
   `app.transactionAttachments.where({ id: attachmentId }).include({ file: true })` at Remote. Do not
   include `parts`. Disconnect again and repeat local observations.
6. Reconnect, explicitly request `app.fileParts.where({ fileId })` at Remote, disconnect and repeat
   observations. Close both isolated contexts/browser. No app preparation code is installed.

Observed recipient-local query results:

| Stage                           | Shared accounts | Probe transaction | Attachment link | File metadata | Parts | Queryable content bytes |
| ------------------------------- | --------------: | ----------------: | --------------: | ------------: | ----: | ----------------------: |
| Workspace discovery only        |               0 |                 0 |               0 |             0 |     0 |                       0 |
| Attachment metadata requested   |               0 |                 1 |               1 |             1 |     0 |                       0 |
| File parts explicitly requested |               0 |                 1 |               1 |             1 |     1 |                       4 |

Interpretation: organization discovery is insufficient for Q1 preparation. A metadata query without
parts made the file/link and referenced transaction locally queryable in this scenario, while the
account remained unavailable. Preparation therefore needs explicit related-record coverage, rather
than assuming permission or relationship dependencies populate every detail requirement. File content
was not queryable locally until explicitly requested, supporting the proposed metadata/content split.

Limits: query visibility is not a byte-level inventory of IndexedDB or network traffic. This probe
does not prove that no content bytes crossed the transport, that all grants/relations behave alike,
or that queried data survives every client closing. It covers one viewer/all-access grant, two small
workspaces and one four-byte part; it establishes neither a large-history budget nor retention/quota
behavior. T011 remains open for those experiments and a reviewed preparation implementation plan.

## T012 staged-save recovery audit and proposed boundary

Evidence: current `transaction-save-contract.ts`, `transaction-save.ts`, `scoped-form.ts`,
`scoped-form-submission.ts`, `forms.svelte.ts`, and installed Jazz alpha.59 Db declarations. Static
investigation; no new production behavior, storage migration or runtime/test execution in this step.

### Observed behavior

- `transaction-save.ts` allocates transaction/Check IDs before writes and records check/ledger
  settlement separately. A Check can be locally saved while the ledger fails. In the same form scope,
  retry receives the checkpoint and reuses these IDs instead of creating another Check blindly.
- Before Check/ledger writes, the machine records intended values and marks the corresponding
  settlement unknown. It invokes resource-owning persistence children and updates that fact when
  their output arrives. Cancellation and scope replacement retain actual settlement in the result.
- An unknown ledger outcome selects `reconcilingLedger`, whose Remote query compares the prior
  submitted row, tags and Check relationship. It does not retry the write because a row is missing.
  Check lookup is Remote only for unknown Check settlement; normal lookup is LocalFirst. These waits
  belong to the particular save attempt and are cancellable, not global readiness requirements.
- `scoped-form.ts` retains unsuccessful checkpoints only for the matching scope revision. Success
  clears them. `clearDraft`/reset and scope replacement clear checkpoint and feedback; outputs from
  an older scope revision cannot attach recovery state to the new form. `forms.svelte.ts` shuts down
  its form actor on unmount. This protects current UI scope but is not durable recovery ownership.
- The checkpoint schema contains `scope.binding`, a live object validated with `z.custom<object>`.
  `sameSaveScope` compares bindings with `===`. Persisting the existing checkpoint JSON cannot restore
  this identity after a database/session restart. Serializing an actor snapshot is likewise not a
  supported recovery solution.

The same-form guarantee therefore ends at reset/scope replacement/unmount/reload. There is no
app-owned durable pending-save journal in the audited path. A later new submission can allocate new
IDs; the app must not describe that as resuming an old unknown attempt. An uncertain old write may
still settle, which is why operation identity must survive outside the route owner before offering
cross-navigation retry guarantees.

### Proposed design, not yet approved for implementation

Use a versioned data-only recovery record containing stable app/environment namespace, identity,
workspace, direction, original edited-record ID if any, operation UUID, allocated transaction/Check
IDs, immutable submitted ledger/Check values and tag assignments, and independently observed
settlements. Do not persist database handles, actor references, credentials or a copied lifecycle
state. Preserve current in-memory binding checks during active operations; resume by validating the
durable record and reauthorizing its stable scope against a newly attached current binding.

A session/application-owned recovery owner must exist before route forms. It owns durable pending
records and their recovery children, independent of the selected workspace/form lifetime. A route
may discard its draft while the owner retains the issued operation's identity. Identity replacement
must detach old UI reports and drain active resource work without relabeling it for the new identity;
records remain scoped to their original identity/environment. No unknown attempt may automatically
replay on startup, reconnect or a missing local row.

Write-ahead persistence must finish before issuing each independently meaningful Check/ledger write.
A durable intent is not evidence that the database write happened. A crash after intent persistence
but before write issuance must remain distinguishable as uncertain unless supported observations
establish otherwise. Persist the resulting settlement before retiring recovery state. A journal
failure before issuing a write must fail that attempt; it must not silently downgrade durability.
Jazz and an IndexedDB journal are separate commit domains, so do not claim atomicity between them.
The installed public Db declarations do not expose a general transaction-fate query that would by
itself settle every post-crash ambiguity; verify any proposed additional SDK API before relying on it.

Retain the existing narrow remote comparison for unknown writes. Scope remote waits to the pending
operation; allow unrelated finance work and other independent operations to proceed. Matching prior
values may establish the existing attempt's effect; conflicting or absent results must preserve
explicit conflict/unknown outcomes rather than restoring rows or authorizing blind replay. Ordinary
successful saves still finish after local persistence, and late rejection reporting stays separate.

A future statechart must expose: read/validate journal → attach current authorized scope → inspect
known settlement → scoped reconciliation or explicit action → persist updated outcome → retain or
retire record. Active save integration must expose journal intent → one child write → journal result,
with cancellation, partial Check-only success, rejection, unknown outcome, identity replacement and
shutdown cleanup. Do not hide these steps inside a promise actor or transaction callback.

### Suggested review slices

1. Define the durable recovery DTO and validation/adapters alongside the transaction domain contract;
   demonstrate binding-independent round trip and unchanged stable IDs after reattachment.
2. Implement a resource-owning journal machine with version/scope validation, atomic compare/write,
   quota/error outcomes and cleanup, using the workspace journal as a pattern rather than blindly
   sharing domain-specific state. Review before tests.
3. Integrate write-ahead intent/result states into the staged save machine while preserving its
   existing child transactions, local settlement and interruption priority.
4. Attach application-tree recovery ownership and route handoff, then review any user-facing pending
   recovery actions/localized messages separately. Define conflict and multiple-pending-operation
   behavior before implementing those actions. This is a larger change and must be discussed before
   expanding across form, application and integration files.

Coverage required after implementation review: Check-only partial success, uncertain ledger/Check
outcomes, journal write failure before an effect, crash windows on both sides of each write,
navigation/reload, A → B → A, stale reports, late rejection, mismatched identity/environment, and
unrelated local work while reconciliation never responds. Current same-form unit coverage and the
T009 callback checks do not establish these future guarantees.

Disposition: concrete current boundary and staged design recorded. Durable recovery remains
unimplemented; T012 remains open for design review, SDK ambiguity experiments and accepted delivery.

## T013 production runtime assets and offline routing — completed audit

Build source: committed application code at `423c6f4`, isolated feature worktree
`/private/tmp/delightful-finances-startup-assets` on `audit/local-first-startup-assets`, with its own
locked dependency installation. Uncommitted callback tests/research do not change its app code.
Versions: Jazz 2.0.0-alpha.59, SvelteKit 3.0.1, Vite 8.3.4, Svelte 5.57.2, Playwright 1.64.0.
The development checkout/server at port 5186 was left untouched.

Reproduction: `pnpm install --frozen-lockfile`, then build with `FINANCE_PREVIEW=true`,
`PUBLIC_FAKE_DATA=false`, `PUBLIC_DEBUG=false`, an isolated UUID app ID, and
`PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:49999` (verified unused loopback port, no remote backend).
Serve with `FINANCE_PREVIEW=true pnpm preview --host 127.0.0.1 --port 4183 --strictPort`.
The valid unreachable URL permits local-first runtime startup without contacting the configured
cloud backend. An earlier empty-URL build installed its worker but did not initialize the app; its
startup result was not used as offline evidence. Production builds succeeded.

### Finding 1: worker-local Wasm is emitted but not precached

| Output path                                                |      Bytes | In generated precache paths? |
| ---------------------------------------------------------- | ---------: | ---------------------------- |
| `_app/immutable/workers/jazz-broker-worker-Di-oGEU0.js`    |    396,529 | Yes                          |
| `_app/immutable/workers/assets/jazz_wasm_bg-ayzBUhbu.wasm` | 19,342,148 | **No**                       |
| `_app/immutable/assets/jazz_wasm_bg.ayzBUhbu.wasm`         | 19,342,148 | Yes                          |
| `_app/immutable/assets/jazz-broker-worker.D5msRnvZ.js`     |    827,415 | Yes                          |

Both emitted Wasm copies have SHA-256
`49d0af280091fa462720a5739431cb516ab4d7cc8ca943faa0279ebcd008f056`.
The hashed compiled worker resolves its default Wasm URL relative to its own worker location,
pointing at the nested `workers/assets/` copy. The compiled page also loads the root asset copy for
its own runtime/crypto work. Caching the root copy does not satisfy the worker's different URL.

Verified by Chromium tracing: start `browser.startTracing(page, { categories: ['devtools.timeline'] })`
before visiting `/accounts`, wait for the shell and `navigator.serviceWorker.ready`, stop tracing,
and inspect `ResourceSendRequest` URLs. The trace contained both root Wasm and nested worker Wasm
requests on different threads. The installed shell Cache Storage contained the two worker JS files
and root Wasm, but not the nested worker Wasm. No page errors occurred in this online-asset run.
The worker is bundled/self-contained JavaScript; its traced missing asset is the nested Wasm.

The generated service worker's `immutable/assets/prerendered` inputs list the worker JS but omit its
nested Wasm. Its fetch handler intercepts only those listed paths. A previous HTTP-cache hit or live
SharedWorker can therefore mask this gap. Full cold-runtime proof is still T014; this audit directly
establishes missing executable-asset coverage without claiming a completed cold offline scenario.

For scale, the first build's client output totaled 42,721,857 bytes; unique listed precache paths
whose files were present in the client directory totaled 23,308,110 bytes (excluding prerendered HTML
stored separately). These are emitted byte counts, not compressed transfer, installed quota usage,
or startup timing. Two identical 19.3 MB Wasm copies warrant later transfer/storage profiling; do
not silently double download/storage cost as an unmeasured optimization.

### Finding 2: dynamic detail documents have no offline shell route

Prerendered HTML covers `/`, `/accounts`, `/account`, `/expenses`, `/expenses/new`, `/income`,
`/income/new`, `/login`, settings pages, and `/transfers/new`. Dynamic `/expenses/[id]` and
`/income/[id]` documents are not in the precache set. The service worker returns immediately for
unlisted paths and has no navigation-shell mapping for those supported links.

Runtime reproduction in a fresh isolated Chromium context: visit `/accounts`, wait for service-worker
installation, reload so it controls the document, enable CDP `Network.setCacheDisabled`, then call
`context.setOffline(true)`. `/accounts` returned HTTP 200 from the service worker. A direct document
navigation to `/expenses/<valid UUID>?workspace=<valid UUID>` failed with
`net::ERR_INTERNET_DISCONNECTED`. No finance-record availability is needed to demonstrate the
missing document response; the UUIDs in this probe were synthetic. The result proves a shell-routing
gap, not access to any saved detail record. No complete cold-restart test was performed.

### Query identity and proposed fix boundaries

Current fetch matching and cache keys discard query strings. The traced shipped default runtime
uses hashed asset paths without a query-version override, so no incompatible-byte response was
observed in this configuration. The SDK requires `wasmVersion` for explicit asset overrides; retain
that URL/version identity in any future loader/cache design rather than assuming pathname-only
normalization is universally valid. Do not add runtime overrides as an incidental repair.

Recommended reviewed fixes: (1) include the emitted worker runtime chain using build-derived paths
and exact compatible bytes, checking duplicate download/storage behavior; (2) map only supported
same-origin GET document navigations for finance detail routes to their corresponding cached public
shell. Preserve workspace/query/hash processing in the client, public-only caching, current update
consent and no data/auth/sync caching. Do not use a generic shell fallback for APIs, worker scripts,
Wasm or arbitrary unknown paths. Then add T014 cold-runtime/direct-link coverage that closes every
client and defeats HTTP-cache masking while preserving app Cache Storage/IndexedDB.

Disposition: T013 audit complete with two reproduced gaps; fixes and T014 validation await a focused
statechart/build-integration/file-scope review. No production service-worker or loader changes made.

T013 fix A implementation evidence: a client-only post-order Vite manifest plugin now adds emitted
worker dependencies omitted by Vite. In the isolated production build, exactly the missing nested
19,342,148-byte Wasm gained a manifest entry, and SvelteKit included its URL in the generated precache.
Type checking and build passed; post-fix browser/cold-runtime evidence remains pending review. This
adds install coverage/cost rather than claiming a performance improvement. Detail routing is still
unfixed. See plan.md for the two-file implementation boundary and T024/T025 follow-through.

T024 post-fix runtime verification: four isolated production Playwright cases passed. New checks
confirmed every emitted Wasm URL exists in the installed shell cache and serves valid Wasm while
offline with HTTP cache disabled. A second case created a saved account, cleared HTTP cache, closed
its persistent browser context (exiting the browser/SharedWorker), relaunched the same profile with
network offline, and displayed the saved account. Existing public-cache-scope and update-consent
cases also passed. The build was configured for the known disposable local agent backend only, so
setup could create a new identity/workspace without cloud traffic. This establishes the tested cold
static-route/runtime path; dynamic detail-link offline routing still requires T025.

T025 post-fix evidence: the route-neutral shell passes cold offline saved-detail navigation for both
expense and income with HTTP cache removed and browser process restarted. URL/workspace/hash and
local field values are preserved; returned public HTML contains no finance payload. Non-navigation
fetches, POST documents, APIs and unsupported paths remain outside fallback. All 15 PWA cases were
verified (13 initially; two update cases after correcting fixture scope waits). This fixes the two
T013 gaps for the tested build/Chromium scenarios without claiming all-workspace preparation or
cross-build/browser compatibility. Implementation is committed as 5bb7225; test updates are separate.

### T014 distinct-build asset availability probe

An isolated Chromium context kept a controlled page open across two actual production builds at
the same preview origin. The second build changed only a hidden marker in the isolated checkout's
offline route, producing a different emitted module hash. No marker or probe code was added to the
application checkout. The old tab stayed open; the new worker installed, then received the existing
ACTIVATE_UPDATE message. HTTP cache was cleared through CDP and the context went offline before
requesting the first build's emitted node modules with cache: no-store.

Build versions were 1793298592153 and 1793298638128. The older node
`/_app/immutable/nodes/13.QgGuLqE3.js` failed to fetch; all 18 unchanged node URLs returned HTTP 200.
The new output instead contained `13.JXSaAu0R.js`. This establishes an old hashed-asset availability
gap across real builds, not a completed user-level transaction navigation or draft-loss test.
Cache names were sampled immediately after activation was requested, so the sample containing both
names does not establish completed retention: activation deletes older caches asynchronously.

Static implementation explains the gap: activation deletes every older shell cache and fetch
handling accepts only the current build's public paths. Keeping an old cache without extending
exact immutable-asset lookup would therefore be insufficient. A focused follow-up should preserve
assets needed by live older clients, serve only exact same-origin hashed immutable requests from
retained public caches, and reclaim obsolete generations when those clients no longer need them.
Preserve explicit update consent and drafts; never broaden this to data/auth/API caching or a generic
asset fallback. A fixed one-generation retention limit alone cannot cover a tab spanning multiple
deployments. Review version ownership and cleanup before implementing the follow-up.

Probe setup correction: Playwright waitForFunction with an async predicate was unsuitable for
observing the waiting worker here. The completed run used expect.poll around page.evaluate, matching
the existing PWA tests. Earlier attempts failed before activation and are not verification evidence.

T026 disposition: deferred by user after scope review. No cache-retention, client-version protocol
or new lookup machine will be implemented in this startup slice. The observed asset gap remains a
known limitation; no failed user-navigation or draft-loss claim was established by this probe.

### T009 cold restart with an open, unanswered remote transport

A bounded production-browser probe passed against Jazz 2.0.0-alpha.59 in isolated Chromium.
The production build used a disposable HTTP/WebSocket proxy at 127.0.0.1:6191 forwarding to the
known in-memory agent backend at 127.0.0.1:61119. Both warm and cold runs used this same configured
Jazz origin, preserving identity/registry scope. No cloud endpoint or user browser profile was used.

Reproduction sequence:

1. Build in the isolated checkout with PUBLIC_FAKE_DATA=false, PUBLIC_DEBUG=false,
   PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:6191 and the existing disposable agent app ID. Serve
   production output at 127.0.0.1:4183. Initially forward proxy HTTP and WebSocket traffic normally.
2. In a newly created persistent Chromium profile, install/control the public shell, create a cash
   account and an expense with amount 12.34, date 2026-03-10 and a recognizable description. Open
   the saved detail to prepare its local data; retain its exact workspace-scoped URL.
3. Clear only HTTP cache through CDP Network.clearBrowserCache, then close the persistent browser
   context, exiting its browser and SharedWorker. Preserve Cache Storage, localStorage and IndexedDB.
4. Change the proxy to accept incoming WebSocket upgrades with a valid HTTP 101 response and
   Sec-WebSocket-Accept header, then consume incoming bytes without sending application frames.
   Hold ordinary HTTP requests unanswered as well. The proxy does not contact the backend in this
   mode. This external fixture covers the SDK's SharedWorker transport without relying on page routes.
5. Relaunch the same profile with networking enabled, navigate to the original detail URL and
   assert its document is served by the service worker, amount is 12.34 and navigator.onLine is true.
   Change the amount to 42.13, explicitly save, assert Transaction saved, then reload and assert 42.13
   remains. Assert no pageerror events. Close the browser and delete only the probe's temporary profile.

All assertions passed. The silent proxy recorded two successful WebSocket upgrades and 2,314 bytes
received from the client across cold startup/reload; it sent no Jazz application frames. No ordinary
HTTP request reached its holding branch in this run. This establishes that available local detail
data and a locally persisted edit remain usable during an open but unanswered WebSocket connection,
including a fresh database runtime and reload, without relying on HTTP cache or browser offline mode.

Limits: the fixture withholds the Jazz server hello, so this is stalled protocol negotiation rather
than a fully negotiated Jazz session whose later query response stalls. The edit's remote acceptance
was not checked. This is a bounded diagnostic probe, not yet a checked-in automated regression test;
partial replicas, observed access changes, actual server rejection/recovery and a broader browser
matrix remain separate T009 work. No production code change was needed for this scenario.

Automated follow-up: `tests/startup-stalled-remote.e2e.ts` now reproduces this scenario without the
diagnostic's pre-existing backend or manual mode change. Playwright fixtures own a fresh in-memory
Jazz server initialized with the real schema and permissions, a silent proxy and a temporary profile.
The cold phase asserts successful upgrades and client bytes, navigator online, saved detail values,
local save confirmation and amount 42.13 after reload. Service-worker responses and no page errors
are also asserted. The dedicated production suite passed (one test); test TypeScript and formatting
checks passed. Its initial collection failure was a Node/Playwright #lib import-resolution issue,
corrected by an explicit test-only paths mapping before the successful run. No production workaround
or dependency change was introduced. This closes the diagnostic-only automation gap for this scenario;
the other limits above remain.
