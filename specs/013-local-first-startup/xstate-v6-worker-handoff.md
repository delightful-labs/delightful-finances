# Finance application worker handoff

Active execution checklist: [production-worker-cutover.md](production-worker-cutover.md).
Production Jazz startup is the next milestone; the chronology below is supporting evidence.

Status: production worker bootstrap implemented; shell/route migration awaiting user review.

The actual layout now starts the existing application worker and no longer mounts
its Window SDK/application actor or `JazzSessionProvider`. Legacy shell/route
snippets are intentionally gated until point 2; the production UI is transitional,
not a completed finance application. The normal-root bootstrap test proves Worker
SDK ownership, shutdown and persisted identity. It does not prove production
financial flows. See the active checklist for current evidence and remaining gates.

The implementation checkpoints below predate this production-entry change and
retain their historical verification scope. They are not current production-status
claims. PR #67 and its full release qualification remain unfinished.

## Active migration work

The worker runtime is now implemented and exercised independently of the live
layout. Production activation remains pending the connected UI integrations;
there must never be a second application SDK session alongside the current one.

- `finance-worker-runtime.ts` owns the account-store and session-acquisition
  children and the existing application/domain root. Shutdown closes command
  admission, drains the application, retains a late SDK acquisition, closes that
  session, drains account storage and awaits native host closure before disposal.
  A failed release retains its owners in `releaseBlocked`.
- `window-runtime.ts` separately owns Window's transport lifetime. Neither a
  worker error nor a timeout authorizes termination. It fences data admission,
  retains the worker, and can consume a late genuine `CLOSED` receipt. Native
  lock settlement precedes termination.
- `application.worker.ts` starts the sole SDK inside the application worker,
  using the original account namespace and Window lock/storage/broker adapters.
  Explicit public startup/recovery projections have an acknowledgement bound of
  one outstanding projection; decoded UI intents have scoped sequences and
  delivery receipts. A delivery receipt is not a financial save result.
- Native navigation has a separate private capability port, bounded requests,
  scoped receipts and obsolete-route rejection. Public UI intents cannot select
  native capabilities or supply SDK/actor handles.
- The private SDK capability admits SDK-selected account-root names with a fixed
  same-origin broker script and a bounded name inventory. Account switching may
  select different physical roots. Finance does not duplicate the SDK's private
  physical-name formula. Public UI commands cannot select those names or keys.
- Domain flag imports use the same explicitly public Vite flags in both realms;
  SvelteKit's page-initialized `$app/env/public` module cannot run in a worker.
  The provider request worker also resolves its endpoint without `window`.

Additional implemented integration:

- `WorkerWorkspaceObservation` binds native query leases, copies SDK rows before
  actor observations and feeds the existing workspace and bank charts. Account
  balances run in the worker and public catalogs have bounded pages. Observed
  scope/lease generations fence commands, including route and identity changes
  that precede the next observation microtask.
- WebAuthn creation/assertion are private Window leaves. PRF output transfers to
  the worker; derivation, validation and bank credential encryption/decryption
  remain there. Window does not retain an encryption key or credential sealer.
- Selected resources now own and join a form owner during drain. Its eight
  children (the transaction route owner plus account/category/tag creation, archive and delete-access actors) use the
  existing scoped form/policy/persistence charts and join actual completion. Private checkpoints,
  SDK resources, callbacks and raw errors are explicitly excluded from views.
- `WorkerAccounts.svelte` renders worker-owned archive and delete-access views,
  integer balances and precomputed, paged permission controls. Bindings are omitted
  from receipts; message descriptors come from owning selectors. Permission data
  is loaded only for an open authorized account dialog, and mismatched dialog data
  stays hidden while its replacement is loading.
- `WorkerClassification.svelte` moves category/tag management queries, history
  counts, archive eligibility, filtering and option preparation into the worker.
  Catalogs and form options have bounded pages with reachable pagination controls.
  Existing presentation components receive computed cells and scalar intents.
- `WorkerAccountCreation.svelte` is an actual UI adapter using the existing form
  presentation, a bounded public view and scalar draft intents. The browser
  harness mounts it through `window-runtime-facade.ts`; production routing will
  switch to this adapter together with the remaining connected integrations.

- The application worker now owns ledger subscriptions, full-history search (including
  category/tag labels and memo), account selection, date filtering, exact bigint
  day totals, grouping and 25-row paging. The versioned ledger view contains only
  bounded presentation fields, generated links, option pages and tag-label pages;
  raw rows and private memo/check/provider fields stay in the worker. The existing
  transaction list renderer accepts this projection, and `WorkerLedger.svelte`
  mounts it in the real browser harness. Production transaction routing and its
  filter/header controls still await the coordinated UI cutover.

- The overview now uses the same worker-owned full transaction history plus
  a worker-owned transfer-link subscription. Transfer resolution runs before
  account/kind selection. Search, date presets/ranges, currency fallback,
  category selection, exact bigint totals, stable palette preparation, pie
  boundaries and ledger paging execute in the worker. Category pages are bounded
  at 500; at most two continuation arcs represent all off-page amounts and lead
  to their pages, preserving the complete total without dropping categories.
  `WorkerOverview.svelte` mounts the existing overview presentation through public
  views and scalar intents. Window handles only bounded rendering, interaction,
  animation, localization and optional sessionStorage reads/writes. The worker
  validates restored preferences and ignores a late restore after a newer edit.
  Production overview routing still switches with the coordinated application
  cutover; temporary legacy presentation fallbacks must be removed then.

Current focused evidence on Node 24.22.2:

- Five worker owner and four Window owner lifecycle cases pass, including late
  acquisition, failed release, closed command admission and late native receipts.
- The SDK starts and gracefully closes inside the application worker in Chromium,
  Firefox and WebKit, restoring its durable identity after all app clients close.
- Real ledger data is seeded through a disposable backend. All three engines
  project the calculated integer balance, create an account through the actual
  migrated dialog, close every app client, restore identity/data while the remote
  never answers, and create another account locally through that dialog. That local save survives
  another complete shutdown/restart. A→B→A workspace switches reject stale
  account drafts and preserve the correct workspace for each admitted save.
  Category/tag creation, linked counts, kind-filtered options, cold local archive
  saves and archive recovery through the migrated UI also pass in all three engines.
  The account dialog also inserts a delete grant online, revokes it with the remote
  silent after a cold restart, archives an account locally and verifies both results
  after another complete restart. The ledger renderer also shows 25 of 31 expense
  rows on page one and the remaining six on page two, preserves the full-day
  bigint total on both pages, filters by category-name search and account
  selection, and restores this behavior cold with the remote silent. All six
  SDK/finance browser cases pass. The overview's actual search and category
  controls also pass online and cold/offline. Closing and replacing its worker
  in the same document restores its date preferences from native sessionStorage,
  while search remains transient. A late preference restore cannot overwrite
  a newer range edit.
- One hundred and eight focused workflow/presentation/resource-owner/read cases pass, including pending
  save settlement, form cleanup joining, failed cleanup retention, authorization,
  validation, duplicate names and omission of private recovery data.
- Thirty-three focused overview/ledger public-read and presentation cases pass,
  including transfer suppression, thousand-category bounded chart coverage,
  legacy presentation compatibility and native filter controls.
- Twenty-five focused ledger/filter/grouping/public-protocol cases pass, including
  aggregate precision beyond the safe-integer range, bounded row/tag pages,
  malformed cursors, private-field omission and cross-group message bounds.
- Sixty-seven native host/capability cases pass, including ten WebAuthn transport
  cases for cancellation, actual settlement, byte transfer/wiping, stale scopes,
  admission, exact buffer ownership and sanitized failures. Existing passkey/setup cases also pass.
- The application graph passes its dedicated ES2024 + WebWorker type check with
  no DOM library, and the full application and browser-test types pass.

Next connected work is the remaining form/operation and finance read surfaces,
followed by complete production layout/UI activation. Browser/file/image
capabilities, provider consent, backup/restore and resource custody remain part
of the migration, not deferred acceptance exceptions. Production cutover must
remove the old Window SDK and domain integrations together, with no second session.

The approved ownership and behavior requirements remain in
[xstate-v6-migration.md](./xstate-v6-migration.md). The conversion and existing
worker foundations are recorded in
[xstate-v6-finance-implementation.md](./xstate-v6-finance-implementation.md).

## Implementation sequence

- [ ] Qualify native worker termination against queued Window storage writes and
      Web Lock release. Prevent an old host write from running after replacement
      acquires the same account-selection lock. Preserve the installed Jazz
      account namespace, earlier-selection fallback and credential scrubbing.
- [ ] Define the runtime owner chart before activation: starting, running,
      draining, release-blocked and closed, with explicit failure and replacement
      paths. Startup acquires host capabilities, account storage and the SDK in
      order; shutdown closes admission and drains their actual owners before
      disposing ports or terminating the worker. Unknown financial writes remain
      retained until their existing settlement/recovery contracts permit release.
- [ ] Define versioned, bounded schemas for UI intent, projected views, native
      capability requests and receipts. Correlate runtime/account/workspace
      generations and request identities; reject stale A -> B -> A messages.
      SDK objects, live actor references and transaction handles stay with their
      owner. Raw credentials never enter public views or diagnostics.
- [ ] Start the sole Jazz session and application/domain tree in the worker.
      Move workspace authorization, query ownership, validation, operation
      preparation, persistence and settlement behind that owner. Preserve local
      readiness and explicit provider consent.
- [ ] Replace Window SDK/domain integrations with projected subscriptions and
      validated commands for startup/recovery, profiles, workspaces, accounts,
      categories, tags, transactions, transfers, bank sync, backup and restoration.
      Retain DUI interaction and browser-only capabilities in Window: navigation,
      history, WebAuthn, file picking, image/canvas surfaces and PWA UI.
- [ ] Activate the application handoff only after the connected runtime and UI
      boundaries are complete, with one SDK owner and graceful route/root teardown.

## Qualification before ready for review

- [ ] Use published `@xstate/test` campaigns with independent admission, scope,
      cancellation and custody oracles, alongside focused resource integration
      tests. Keep XState and its declarations unpatched.
- [ ] Verify real worker/broker persistence after closing every client and a cold
      restart, including offline writes and a connection that never answers.
- [ ] Verify identity recovery/replacement, workspace switching, multiple tabs,
      membership/grant changes and stale reports.
- [ ] Verify bank consent, idempotent imports, cancellation, financial settlement,
      backup/restoration, native capability failures, lost acknowledgements,
      worker crashes and failed shutdown without abandoning resource custody.
- [ ] Run application/worker/browser-test types, relevant unit/model tests, full
      affected browser flows, formatting and CI. Record exact commands, results
      and remaining qualification limits in this document and the PR.

## Implemented: native account-selection custody

The Window host now holds account-selection Web Locks on behalf of the worker.
Terminating a worker cannot release its lock while Window can still execute
queued storage messages. Host closure removes data admission before releasing
native leases, and native lock release is acknowledged only after the actual
Web Lock request settles. Lock-port disposal alone never releases Window custody.

The existing account-store chart retains its sequence:
lock → read → transform → write → earlier-store scrub → release.
It now accepts the private native-lock adapter, retaining the original storage
namespace, earlier-selection fallback and credential-scrubbing transformations.
There is no second SDK session and no application-worker activation in this batch.

Host storage protocol **v2** requires the exact Window lease UUID on primary and
earlier-store writes. A delayed write cannot use a later acquisition of the same
key. The independent lock protocol **v1** validates version, scope, request UUID,
lease UUID and monotonically increasing sequence. It bounds outstanding leases
at two (primary plus earlier store), rejects replay and restricts lock names to
the captured namespace. Abort cancels pending acquisition; a granted lease stays
held until its callback settles. Native transport failures stay sanitized.

Same-Window replacement also synchronously closes the previous host for the same
origin and account-storage key before admitting its replacement. Stale disposers
cannot unregister the current host. Bindings are copied before native admission.
These adapters perform native operations and resource cleanup; they contain no
financial or identity workflow. They do not acknowledge uncertain financial
writes, roll back completed storage writes, or authorize terminating an SDK owner.

## Focused verification

The user authorized continuing implementation including tests. Verified locally
with Node **24.22.2**, pnpm **10.22.0** and the lockfile-pinned dependencies:

- `pnpm exec tsc --project tsconfig.worker-host.json` — passed, including native
  host/client and browser harness types.
- `pnpm --filter @delightful-finances/worker-state-tests check` — passed.
- `pnpm test:worker-host` — **51 passed**. Coverage includes storage admission,
  stale/replayed writes and leases, cancellation, native callback failure,
  legacy-key scrubbing, immutable bindings, lost ports and host replacement.
- `pnpm test:worker-state` — **20 passed**, including the existing generated
  campaigns and three account-store/Window-host integration regressions.
- `pnpm test:worker-browser` — **3 passed**: Chromium, Firefox and WebKit. Each
  uses real dedicated workers, native Web Locks, isolated browser storage and
  two competing tabs. A worker-issued write is held at Window, the worker is
  terminated, and the replacement remains blocked until Window closes the old
  host. Replaying the old write cannot overwrite the replacement's value.
- `pnpm check` — passed, zero errors/warnings, including service-worker types.
- `pnpm check:tests` and `pnpm check:e2e` — passed.
- `FINANCE_PREVIEW=true pnpm exec vitest run` — **1,955 passed** across 143 files.
- `FINANCE_PREVIEW=true pnpm build` — passed; no deployment performed.
- Focused Prettier and `git diff --check` — passed.

The browser harness starts a disposable Vite server on an available network port,
prints its local/LAN URLs and closes it after the suite. It does not start the
Finance app or touch the user's Jazz replica. CI now runs native host types and
tests plus this three-engine browser regression in a dedicated job.

The first implementation checklist item remains unchecked at application scope:
this qualifies the native account-selection boundary, not a live worker-owned
Jazz session, broker-generation recovery, cold/offline Finance persistence,
financial custody or UI migration. The affected application browser suites have
not been rerun for an activated handoff. The
remaining implementation and acceptance gates above are still required before
this PR can leave draft. No localization or deployment changes are included.

### WebAuthn native leaf boundary

Keep credential creation and PRF assertions in Window, but move key derivation,
sample encryption/verification, credential validation and encryption/decryption
into the application worker. A separate scoped protocol on the private native
port carries only a creation descriptor or a single transferable 32-byte PRF
result; no WebAuthn object, bank URL, credential sealer or encryption key crosses
the public UI channel. Window copies and wipes extension-owned PRF bytes before
transferring ownership. The worker wipes the received bytes after deriving its
nonextractable key. Existing bank setup/operation statecharts continue to own
consent, authorization, sample verification, provider claim and persistence.

These native calls are individual leaves, not replacement workflows. Each has a
correlated request ID, bounded admission, sequence and scope checks. Abort sends
a cancellation to the same native request and waits for the actual browser
operation to settle; it does not acknowledge completion merely on receipt. Host
shutdown aborts all outstanding credential requests. No Window sealer lease is
introduced, so existing worker setup cleanup remains the sole owner of key
lifetime. Until production layout activation, the existing Window application
binds the same browser leaf adapter explicitly.

### Workspace form ownership during UI cutover

Workspace form actors belong to the selected-resource owner, alongside bank and
integrity actors. The form owner chart retains its invoked form across active →
draining, sends SHUTDOWN, and waits for actual form completion. The selected
resource drain joins all three outcomes before releasing the workspace lease;
crashed forms produce unresolved cleanup, never permission to close the SDK.
Account creation reuses the existing scoped form, authorization and persistence
machines. Integration supplies copied observations and sends bounded draft
intents; projection selects only serializable presentation facts and safe account
results. No DB binding, assessment token, error, actor reference, checkpoint or
feedback callback leaves the worker. Scope generation rejects stale commands.

### Management form and read migration

Category/tag creation and archive keep their existing management availability and
scoped form charts. The form owner expands into a parallel join: a control region
closes admission and requests shutdown, and one region per form retains its actor
until actual completion. A failed child records unresolved release and drains its
peers; an unexpected clean closure records failure without abandoning peers.
Archive leaves issue one authorized update and then select its display name from
the already-assessed immutable observation;
there is no new procedural read/check/write workflow. Worker query observations
supply categories/tags and complete readable transaction history, so counts and
archive eligibility are computed before bounded catalog projection. UI adapters
receive generation-scoped form commands and serializable views only.

Next cutover integrations: transaction/transfer forms and read projections; bank UI/history projections;
profile/recovery/backup/restore and native file/image capabilities; then production
layout activation/removal of the old Window SDK/domain integrations. The temporary
classification/permission presentation fallbacks remain only for old production routes
and must be removed when those routes switch to the worker adapters. Window
transport-failure rendering/admission and SDK generation-write fencing still need
the final connected custody audit. No production handoff or PR completion is claimed.

### Account actions migration

Account archive and delete-grant actors join the same selected UI-resource owner
as the forms. Their existing validation/authorization/write/drain charts remain
unchanged in ownership: each native writer issues one previously-decided update
or insert and awaits local persistence. The owner requests all eight actors to
shut down and joins actual completion before the workspace or SDK can release.
Worker integration supplies own grants for archive authorization, and loads
organization members/selected-account grants only while an authorized account
actions dialog is open. The worker projects bounded, paged permission controls
and strips native bindings from every receipt. Status-to-message decisions live
with the owning selectors; Window renders supplied message descriptors. Stale
workspace generations and closed dialog scopes cannot admit grant commands.

### Transaction creation route ownership and native images

The form owner now joins an eighth child, `transaction-route-owner.ts`. Its idle
state admits an expense/income creation route. Selecting assigns a fresh
controller generation before invocation; holding keeps independent control and
work regions alive. Control closes admission on route replacement or shutdown,
sends SHUTDOWN to the scoped form, and waits for its real completion. Replacing
retains only the latest desired route; A→B→A cannot reuse the old controller or
open a new one while the prior save/attachment/completion children still run.
Unexpected form failure produces finite failed/unresolved cleanup evidence and
drains peers through the existing workspace owner. No force-stop or timer is a
release receipt.

Creation reuses the existing entry availability, scoped form, transaction
submission and staged persistence charts in the application worker. Public
commands require both workspace and form generations; copied membership, own
grants, accounts, categories and tags supply its existing authorization. Catalog
and defaults preparation, amount patterns and default dates run in the worker.
Public form results strip checkpoints/callbacks, and generation/path masking
prevents an obsolete controller from staying actionable. The creation UI adapter is mounted in the native worker harness; production
routing and editing/transfer UI migration remain unfinished.

Validated files now belong to the admitted submission request. A mutable
`getAttachments` callback can no longer substitute files after validation. The
submission separates those native files before passing the canonical finance
values to the save actor, then retains the files through its existing attachment
chart. Image processing uses a public Pica subclass to allocate OffscreenCanvas
scratch surfaces in the worker, JS/Wasm processing without nested workers, and
direct standard convertToBlob encoding. Native tests caught Pica's omitted
Offscreen preference on scratch allocation and its stalled Firefox encoding
adapter; both paths are now qualified in Chromium, Firefox and WebKit.

`WorkerTransactionEntry.svelte` renders the existing transaction form from a
bounded projection. Worker-provided dates, currency patterns, selected default
account/category pins and catalog pages supply its presentation. Native form
fields retain draft values across worker feedback; reset revisions deliberately
reset them. Submission transfers at most five native File handles and the full
selection count, allowing canonical worker validation to report excess files
without an oversized message. Empty native file placeholders are ignored only
by canonical attachment validation. The existing Window image-selection/editor
adapter is temporary and still requires migration; this does not establish the
complete UI handoff.

Current focused evidence includes pending commit/settlement retention, stale
controller rejection, A→B→A replacement, suppressed late completion navigation,
and the workspace owner's join of a pending transaction. The real SDK browser
campaign drives the actual form, validates excess files, replaces attachments
through native preview dialogs, saves a transaction/tag/image locally with a
silent remote, completes native navigation, closes every client and restores the
transaction/tag cold. Nine browser cases pass, including three standalone native
image-worker cases. Image preview/download/removal and cold attachment-graph
verification remain part of the pending native file/UI qualification.

Private navigation now carries the sequence of the most recent admitted ROUTE
command as well as expectedHref. Window records that sequence before posting the
route, and rejects an earlier visit's queued native request even after A→B→A.
The worker captures the route sequence when issuing its private native leaf.
A focused native-channel test verifies obsolete and current visits separately.

The Window facade now removes actionable views and rejects UI intents once its
native lifecycle leaves running, including failure, drain and closure. Late
worker views do not reopen admission. A lifecycle test verifies that masking
and command rejection do not dispose the worker before its real CLOSED receipt
and native lock drain. Rendering explicit native failure/recovery status remains
part of the production layout integration.

Current creation/UI-admission verification: eight focused unit files / 36 cases,
nine native browser cases, application-worker no-DOM types, native-host types,
browser-test types and Svelte diagnostics pass. This evidence qualifies the
implemented slice; full migration/model/build qualification remains unchecked.
Next implementation work is the worker-owned edit/transfer/delete controller and
its selected transaction/attachment query leases, followed by its bounded views
and native file capabilities. Production Window SDK removal remains mandatory.

### Edit data ownership in progress

The worker workspace scope now owns the selected transaction-detail query,
including its check, tag and attachment graph. Canonical UUID expense/income
entity routes bind it by workspace, kind and transaction ID. Route replacement,
readiness loss and scope closure release the old subscription; WorkerQuery's
existing lease fence rejects late callbacks. Copied rows remain private and are
matched again against workspace/kind/ID before entering an observation.
Creation observations omit transactionId entirely: explicit null would select
the existing edit availability policy. Native regression testing exposed this
mistake, and a focused observation test now locks down that distinction.

The edit workflow accepts its existing persistence capabilities as a narrow
structural TransactionEditDb contract instead of depending on the Svelte getDb
return type. Its transfer/delete workflows are preserved. The selected edit
controller is now invoked by the worker route owner. Transfer observations,
commands and bounded candidate projections are connected. The basic edit-data form adapter now renders in the native worker harness; the
complete edit UI and production handoff remain unfinished.

Edit-data preparation evidence: five focused files / 19 cases pass, including
canonical route parsing, creation/edit observation distinction, query lease
behavior, route ownership and the existing edit workflow. The nine native
browser regression cases pass after the scope correction; worker no-DOM types
and Svelte diagnostics pass. Edit operations themselves are not yet exercised
through a worker UI controller.

### Edit controller invocation

The transaction route owner now admits canonical edit routes alongside creation.
Its work region statically registers expense/income creation and expense/income
edit logic with separate typed child IDs. Both kinds use the same control
region: replacement and shutdown close command admission, send SHUTDOWN, and
retain the child until actual completion. Form commands require the controller
generation; late commands cannot reach its replacement. Unconfigured legacy
owners cannot admit edit routes.

The worker passes its existing application transfer-mutation gateway, scope
capture and write tracking into the edit workflow. Selected-detail completion
now participates in the workspace form observation cache, so a loaded query
actually updates the edit controller's availability. Existing edit dirty checks
remain authoritative: ready/unchanged forms cannot submit, while CHANGE admits
an altered draft before SUBMIT.

The native SDK campaign now creates a transaction with an attachment, enters its
edit route, changes amount/description through the worker controller, waits for
local success, closes every client and verifies the edited row and retained tag
on cold restoration. The basic edit form is connected; full-text editing,
attachment rendering/removal and complete full-text controls remain unfinished.

The edit-owner focused campaign passes six files / 29 cases, including edit
shutdown before creation re-entry and stale-controller rejection. Application
worker no-DOM, host and browser-test types plus Svelte diagnostics pass. The
public route codec admits only bounded canonical edit paths; the creation
adapter does not accidentally render an edit route as a new-transaction form.
When adding the edit-data projection, preserve all existing tags across bounded
pages rather than truncating a full selection on resubmission.

### Worker transfer observation and command boundary

The selected worker scope owns private transfer-link and transaction query
leases for edit routes. Pure transfer observation selects workspace-local rows,
resolves effective/pending/conflicting relationships with the existing domain
rules, retains endpoint IDs and correlates the edit scope generation. The
current detail row participates in marker resolution even while another query
has not caught up. A pending unlink requires both cleared markers; a half-cleared
relationship remains conflicted. Orphan markers and foreign-workspace rows have
focused coverage.

The edit route owner feeds those observations into its existing invoked chart.
TRANSACTION_EDIT admits only finite scalar commands with workspace and form
generations. Search, selection, linking, unlinking and linked deletion use the
same application mutation owner, captured scope, financial authorization and
settlement charts. Controller replacement/shutdown masks and rejects old commands
while retaining pending financial work. Repeated identical copied observations
avoid unnecessary readiness round trips; transfer guards retain their existing
canonical behavior.

The public transfer view contains at most 500 candidate cells per reachable
page, worker-selected writable flags, a scoped counterpart link, pending flags
and finite outcome enums. It strips raw SDK rows, callbacks, errors and private
mutation inputs. It appears only for the matching active edit identity and is
cleared on replacement. Recovery-required outcomes remain distinct from success.

The native SDK campaign now creates a counterpart in another account, matches,
links, unlinks, relinks and deletes the selected linked endpoint through the
worker. It waits for the new relationship ID and destination transaction's
controller before proceeding, rather than accepting a previous view with the
same status. The retained expense restores cold with the exact amount/currency
and tag. These barriers exposed stale-controller test races; no authorization
rules were relaxed to pass them.

Current transfer evidence: fifteen focused files / 106 cases, nine native
browser cases across Chromium/Firefox/WebKit, worker no-DOM/host/browser-test
types and Svelte diagnostics pass. Complete full-text editing, attachment
capabilities and the coordinated production cutover remain pending. This does not qualify the full
application handoff or the still-unchecked completion gates above.

### Saved-tag edit patching

Edit drafts can now use tagMode=append and an optional stable-ID selection
change. The route owner retains removed tag IDs as private draft state, resets
that state with an admitted form reset or controller replacement, and merges
all remaining saved names plus new input names before canonical validation.
Existing complete replacement intents retain their original behavior. Malformed
patches do not mutate selection state. Busy edit/transfer controllers reject
selection changes and resets through their existing capabilities.

The public saved-tag projection contains at most 500 ID/label/selected cells and
a reachable page cursor. Labels may be bounded for display without being used
to reconstruct a write. Tests preserve 1,001 saved names, retain long legacy
names verbatim, remove/restore by ID and keep prior selection sets immutable.
Native commands remove and restore a saved tag, then edit amount/description
with an empty new-tag array. Cold restoration verifies that the saved tag was
not dropped. Thirty focused cases across seven files, nine native browser cases
and worker/host/browser-test types plus Svelte diagnostics pass.

The basic edit UI now renders the selection controls and initial field projections.
Canonical text schemas are unbounded: the new UI transport's bounded labels
must not silently become replacements for full names, descriptions, memos or
check values. Unchanged long values need patch retention, and editing full long
values needs an explicit native-text/field transport rather than truncation or
new canonical limits. This applies to the other migrated forms as well and must
be resolved before the production cutover. The current tag patch solves the
saved-selection case only; it does not claim full edit UI completion.

### Basic edit form adapter and retained text

WorkerTransactionEntry now renders creation and ordinary edit forms from explicit
worker-selected initial values. It waits for the selected edit entry before
mounting editable fields, preserves the original account/category defaults,
uses worker-formatted amount input, and sends native drafts through the scoped
worker controller. Saved tags render as paged ID-based checkboxes alongside the
new-tag input. Native text-change tracking is presentation state; canonical dirty
comparison, permissions, parsing and writes remain in the worker.

An edit draft may identify unchanged description, memo and check-number fields.
The worker replaces those bounded UI previews with the complete current private
values before validation. Changing another field cannot truncate an unseen
suffix. Explicitly changed short values remain explicit replacements. Long
fields are currently readonly previews: complete long-text reading/editing is
still required before production activation, including long values in the other
forms. This temporary display restriction does not satisfy final feature parity.

The adapter uses stable empty new-tag input state across projected updates,
avoiding synthetic input echoes that clear success feedback. Canonical edit
equality now ignores the browser's empty File placeholder and accepts omitted
or explicitly undefined optional fields consistently with validation. Native
checks verify that restoring the original tag selection returns the edit to a
clean state before changing another field.

Current evidence is seven focused files / 31 cases, nine native browser cases,
worker no-DOM/host/browser-test types and Svelte diagnostics. The browser campaign
uses the actual amount/description/tag controls, then verifies cold restoration.
It also edits another description on an entry with a memo beyond the projection
limit and finds that entry cold by a marker in the unseen memo tail. Attachment
and complete full-text controls and the production cutover remain pending; the full completion gates above remain unchecked.

### Transfer and linked-deletion UI adapter

The worker-backed edit adapter now connects the existing search checkbox,
candidate radios, link/unlink controls, counterpart navigation and linked-delete
dialog. It forwards generation-scoped scalar requests and renders worker-selected
capabilities, pending states and feedback. Callback-bearing machine metadata is
resolved to bounded text in the worker; callbacks, raw errors and mutation inputs
never cross the UI channel. Successful endpoint deletion suppresses the obsolete
edit form and its missing-reference feedback.

Candidate cells include worker-formatted money/date labels and scoped account
names/descriptions. The existing renderer consumes those supplied cells on the
worker path. The private transfer observation owns the all-account query needed
for labels, including archived accounts, while canonical edit/transfer authority
continues to use its existing policies. Label lookups index copied query rows
once per changed source, and clear their caches on scope replacement/closure.
Modified-click navigation retains native anchor behavior; ordinary counterpart
navigation uses the adapter's native navigation callback when supplied.

The native campaign now drives income entry and the transfer controls through
the actual DOM: search, selection, link, unlink, relink, open counterpart, choose
the selected endpoint in the delete dialog, and verify cold data afterward.
Seventeen focused files / 112 cases, nine native browser cases and
worker/host/browser-test types plus Svelte diagnostics pass. Complete full-text
and attachment capabilities, other application UI integrations, production SDK
cutover and the full model/build/CI qualification remain unfinished.

The full-text path must preserve unbounded canonical values without unbounded
normal snapshots. A native text transport can exchange bounded chunks and opaque
field references scoped to the current controller; the native input may hold its
selected full string for rendering, while assembly, validation and financial
submission remain worker-owned. Uploads must stage atomically, discard obsolete
controller data, and respect native/worker shutdown before exposing a completed
field reference. Readonly previews are a temporary migration state, not final
feature parity. This work also applies to long names in the other migrated forms.

### Native full-text transport foundation (not integrated)

The private `nativeTextStoreMachine` captures immutable reads and receives ordered
4096-code-unit chunks. Only a successful transport COMMIT creates a versioned,
field-specific reference; it does not save a financial transaction. Cancellation,
revocation, reset, and shutdown discard staged data. Versions survive RESET so
reused request UUIDs cannot redirect an old reference to replacement text.
`resolveNativeTextDraft` rejects a draft atomically when any explicit reference is
malformed, stale, or belongs to another field, before canonical form validation.

These files are still isolated foundations: transaction route ownership, scoped
runtime messages, Window native text I/O, and editable long inputs are **not yet
connected**. The production layout still starts its SDK in Window. The migration
and PR remain incomplete. Qualification: 12 focused native text cases passed;
Svelte check passed with zero errors/warnings after the store was added (before
the subsequently added small draft resolution helper). Prior native browser
qualification does not cover this new unintegrated transport.

### Scoped native text transport connected to the worker owner

The transaction route owner now invokes the private text store, scopes its
references to the connection/workspace/controller lease, and resolves explicit
references before existing canonical form validation. RESET clears documents;
route replacement and shutdown close the memory-only store while the financial
controller retains ownership of actual SDK settlement. TEXT commands include the
workspace generation, form generation, and draft revision. Rejected/ignored
commands return an unavailable correlated reply instead of repeating an old
receipt. Full text is carried only by explicit bounded text frames, outside the
ordinary VIEW/ACK stream.

Window has a correlated `exchangeText` native transport, fenced by the runtime
facade. Its `nativeTextIoMachine` exposes read / start / chunk / commit / cancel
states, sequences one frame at a time, verifies offsets/lengths/field identity,
and aborts an outstanding frame on cancellation. A text transport commit still
has no meaning as a financial save. Native read authorization now uses a focused
`canReadAccount` policy matching the existing SDK read policy; write admission
continues to reuse the canonical transaction availability chart. Thus readonly
members can read an authorized full transaction field without receiving write
permission. Fresh membership/grant facts are checked before each frame.

Qualification: eight focused files / 46 tests pass, including full long-memo
persistence through a private reference, stale references after RESET and route
re-entry with reused UUIDs, fresh authorization revocation before OBSERVE,
immutable chunk reads, cancellation/late replies, and facade admission fencing.
The previous native browser campaign has not yet exercised this new text path.
**Remaining for this slice:** connect native inputs to the text I/O chart, prepare
long form fields before dispatch, preserve/coalesce native drafts correctly while
frames are pending, remove preview-only readonly/maxlength restrictions, and
qualify real UI read/edit/save/cold restore in all three engines. New tag names
and other unbounded form names still need compatible native transport. Production
layout cutover and the broader migration checklist remain unfinished.

### Native transaction inputs connected and qualified

`WorkerTransactionEntry` now owns a native text form I/O chart, bound to its
workspace generation, controller generation, and draft revision. It loads full
long descriptions/memos/check numbers into native inputs, passes only bounded
frames or private references across the boundary, and prepares every long field
before forwarding a captured form intent. Canonical validation and persistence
remain in the transaction worker owner. The reusable form no longer imposes the
transport's 4096-character limit on native description/memo inputs. Loading one
field does not overwrite edits to another field on ordinary projection updates.
Unchanged edit fields use the existing retained-field intent, preserving their
full worker-owned values without retransmitting previews.

The native I/O chart preserves ordered edits, coalesces replaceable pending draft
captures, fences further captures behind a queued immutable submit, and exposes
bounded queue backpressure. Route/reset cleanup requests SHUTDOWN and joins the
active text child's cancellation instead of stopping it. Transfer failure fences
submission and supports explicit retry. It owns only native input/wire handling;
it has no SDK, query, money parsing, financial authorization, or save actor.

Qualification: eight focused files / 41 tests pass; the native form chart's four
cases cover multi-field preparation, ordered/coalesced queues and immutable
submit, joined cancellation, and failure/retry admission. All nine native browser
cases pass in Chromium, Firefox, and WebKit (51.31s). The actual UI campaign creates
a long memo with attachments/tags, preserves it through an edit, loads a legacy
long memo in full, saves it untouched, reopens and edits its tail, closes every
client, and searches the two distinct tail markers after cold restore. Svelte
check reports zero errors/warnings. Search fixtures use distinct single-token
markers because canonical search matches words across description/memo/tags.

This supersedes the preceding checkpoint's pending transaction-input wiring.
Name fields remain pending: accounts, categories, tags, and check numbers have
unbounded canonical trimmed strings; `validation/accounts.ts`, `categories.ts`,
`tags.ts`, and `checks.ts` impose no maximum. In particular, the bounded account
and management command schemas still need native name references before cutover.
New transaction-tag drafts also need worker-owned bounded paging/intents rather
than a capped complete Window array. Remaining bank, identity/settings, file and
backup, sample/delete, lifecycle cleanup, and production-layout migration work
is not qualified by this transaction-input campaign. The production layout still
starts its SDK in Window; PR #67 is not complete or ready for final publication.

### Native account/category/tag creation names connected

Account, category, and tag creation now use isolated private name owners in the
worker. Their text references are scoped to the connection/workspace/form slot,
versioned across resets, and resolved before the canonical form's validation.
The workspace form owner now joins eleven children: the existing eight financial
owners plus three memory-only name owners. Name completion never acknowledges a
financial save; the financial children still retain SDK operations until actual
settlement. Admitted OPEN/RESET/CANCEL clears staged names, and revision changes
invalidate references even before another text frame arrives.

The native name controls capture raw input, prepare bounded frames, and forward
an immutable form intent only after text commit. They contain no name
normalization, duplicate-name decisions, permission checks, or persistence.
Account name transport reuses the pure `accountCreationAccessMachine` authorizer;
its outer availability chart invokes a child and cannot be assessed to completion
by `initialTransition` alone. Category/tag transport reuses their pure canonical
availability charts. Scope matching and fresh authorization are checked for every
frame. Sibling revision access is deferred until an event; sibling actor
snapshots are not available while the parent is constructing its initial graph.

ACCOUNT_FORM and MANAGEMENT_FORM commands now require draftRevision in addition
to workspace generation. The worker rejects a queued command from an obsolete
reset/open cycle. NAME_TEXT frames have their own bounded, correlated receipts,
using the existing native exchange transport; callbacks, SDK handles and complete
long names never enter financial view projections.

Qualification: three focused files / 21 tests pass, including full private names
through canonical validation, isolation across slots, reset invalidation,
revocation, native cancellation, malformed references, and joined financial
settlement. All twelve native browser cases pass across Chromium, Firefox and
WebKit (64.33s). The new UI cases verify exact full backend names and canonical
trimming for all three forms, then close every client, silence the remote, and
verify duplicate-name decisions against cold local data. Existing transaction,
attachment, transfer, deletion, overview, ledger, identity-custody and native image
cases remain green. Worker/host type checks and Svelte check pass (zero diagnostics).

Remaining text work includes worker-owned new transaction-tag drafts and bounded
suggestion identities, plus the workspace/profile/settings/recovery interfaces
still awaiting migration. Existing selected saved transaction tags remain private
and paged. Production layout still starts its SDK in Window. Broader migration,
full model/build/CI verification, and final PR publication remain unfinished.
