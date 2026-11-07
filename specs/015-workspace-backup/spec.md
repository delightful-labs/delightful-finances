# Finance workspace backup and restore (T008/T009)

Finance uses merged DLF `ad99117` and Jazz `2.0.0-alpha.59` for owner-authorized
workspace downloads and explicit restoration into a new workspace. The implementation lives on
`feat/workspace-restore-experiment`, based on Finance `f65badc`. T007 inventory is complete.
T004 platform qualification and T010 deployed recovery verification remain separate work.

## User workflow

Workspace settings exposes both Download Backup and Restore Workspace. Downloads can use a
password or no password. Restore accepts either protection mode and existing v1/v2 Finance files.
The file is opened and validated before showing its workspace name for review. Create Workspace
confirms a new operation; Try again confirms an incomplete operation. No destination is written
before confirmation. Invalid files, wrong passwords and unsupported capacity fail without creating
an operation. Feedback uses existing approved localization; no catalog edits are needed.

The restore continues across ordinary route/workspace navigation. Its root-owned feedback remains
available outside settings, including Cancel and release retry where applicable. Open Workspace
navigates to the restored workspace after confirmed completion using normal route authorization.
Restore never overwrites the original workspace or reactivates archived collaborators or providers.

Reselecting the same checked payload with the same account/app/environment derives the same operation
and target IDs. An incomplete journal resumes using its original intent and exact saved mappings;
a completed journal reports Done without acquiring a destination client. Cancellation before an
intent exists leaves a new operation to confirm. A reload requires reselecting the original file and
entering its password again; neither the file nor its password is saved in the journal. There is no
automatic restore or replay of uncertain writes and no second destination on retry.

## Profile and coverage

New exports use `delightful.finance.workspace` version 2, application `delightful-finances`.
Existing version 1 files remain readable by the restore planner.
`src/lib/backup/workspace.ts` defines the explicit field allowlist and pure profile validator.
Never spread SDK rows directly into an archive. Preserve exact amounts, currencies, dates, text,
optional variants, archived rows, cyclic transfer links, unassociated Checks and attachment bytes.
Preserve source audit timestamps, account attribution, and issuer/subject separately from domain fields.
Minimal membership-referenced profiles, memberships, account grants and sanitized bank history are
inert references; they never authorize a destination or reconnect a provider.

The declared graph contains 19 types: organizations, organizationMembers, profiles, accounts,
accountMemberships, categories, tags, transactions, transactionTags, checks, internalTransfers,
transactionBatches, batchTemplates, transactionAttachments, files, simplefinConnections,
simplefinAccountLinks, simplefinSyncAttempts and simplefinSyncAccountResults. V2 adds the inert
`sourceDocuments` reference type for a retained checked payload; ordinary workspaces have no such row.

Exclude credentials and their encryption/unlock metadata, profile avatars, arbitrary provider error
text, operational upload jobs, deleted rows and full engine history. A visible legacy `checkDetailsId`,
missing edge, unsupported value, unsafe integer, incomplete file or inconsistent transfer fails capture.
Denied legacy rows and hidden orphan files cannot be declared absent from policy-filtered reads.

Follow attachment links from every scoped transaction; the normal uploader does not populate file
workspace columns. Validate file ownership, contiguous unique part indices, declared and actual
lengths, and complete original bytes. Physical part IDs are not application graph identities.
Use metadata-only part queries before bounded body reads. Never omit, resize or downsample bytes to fit.
Keep DLF's existing limits: 8 MiB per attachment, 16 MiB aggregate attachments, 32 MiB payload,
64 MiB outer file, 50,000 logical records and 5,000 attachments. Sentinel queries reject truncation.

## Ownership and statecharts

The application root invokes a fixed restore controller for its lifetime. The controller owns:

`bounded read -> checked opening -> validation -> stable scope/IDs -> journal initialization/discovery
-> planning -> review -> native session -> cleanup`.

The native session owns a separate persistent SDK client using the existing account handle and
`restore-<operationId>` namespace. Its sequence is:

`load journal -> acquire client -> selected write/comparison -> drain retained receipts ->
shutdown({waitForSync:true}) -> release artifacts`.

DLF supplies checked-file opening, durable journal/intent format, native operation lock, selected-write
transaction custody, uncertain outcomes and reconciliation. Finance supplies typed graph planning,
scoped native queries/staging, comparison, resource ownership and UI integration. Native session actors
are spawned for each checked plan because each factory owns operation-specific resources. Their
completion/error/snapshot reports are correlated with their actor reference. The parent never starts
children manually through promise bridges.

Root retry, identity recovery, startup/readiness/observer failure and shutdown drain restoration before
allowing account/session replacement. Early startup retirement is deferred until cleanup finishes.
Ordinary workspace replacement retains its independent release gate, allowing unrelated local work.
Observed session/client replacement invalidates the restore. Confirm/Open additionally require the
current ready identity. A stale request cannot replace or release the active request.

Cancellation latches while an acquisition or leaf is pending. Every acquisition completion path retains
its resource before cleanup; late results cannot start another write. The native owner drains transaction
acquisition, pending staging, commit and settlement, or confirms rollback before closing its client.
A commit receipt forbids rollback. Unknown rollback, commit or close outcomes retain resources in a
blocked state with explicit release retry. A crash never reports false cleanup. Owners must receive
SHUTDOWN and finish drain before they are stopped or their account manager is released.

Raw File/password/bytes, checked archives, typed graphs and native handles stay outside actor snapshots.
Public reports contain view metadata and opaque correlation tokens. Cleanup releases those private
artifacts only after SDK custody ends. Promise actors perform a single query group, ID/digest group,
pure validation/projection, staging, commit, settlement, rollback or close. Business branches use
statechart guards and invoke completion; file/part loops reenter their invoked state without route-only
intermediate states. The pure presentation component translates machine-selected messages.

## Export

The finite Finance reader authorizes the owner, reads metadata and dependent relations/file metadata,
validates closure/bounds, then allocates/reads/hashes each bounded file before projecting capture.
Ownership requires both organization ownership and owner membership, independent of account-selection
mode. The reader has no writable database/transaction interface.

DLF hydrates the declared graph through ordinary remote reads before opening one native exclusive
transaction. Capture rechecks the complete scope and validates the payload, commits with zero application
mutations, and awaits the native verdict before encryption/download handoff. A conflict discards the
attempt; explicit retry hydrates again with a fresh transaction. No maintenance mode, writer registry or
repeated graph-comparison protocol is used. Authority confirmation can remain pending offline.

The settings export machine owns unavailable/editing/preparing states and one fixed invoked export
across work, cancellation and drain. Scope includes identity, workspace, membership, attachment and
generation, including A -> B -> A changes. Browser download clears its byte copy and URL in finally.
Completion means Download started, since the browser does not confirm the user's retained file.

## Typed plan and destination

The planner uses the released Finance field schemas: decode -> derive IDs -> project -> fingerprint
graph/writes/plan -> validate full intent. IDs use deterministic `(kind,type,sourceId)` keys, independent
of locale and source storage layout. Physical attachment/source-part IDs and fresh owner membership
use the immutable operation ID. Resume rejects altered archive, scope, mapping or fingerprint data.

Twelve live types become typed Finance rows: organizations, accounts, categories, tags, Checks,
transaction batches, batch templates, transactions, transaction tags, transfers, files and attachment
links. Seven historical types remain inert in the retained source. Restored membership is exactly the
new owner, with no imported grants, profiles or bank connections. Newly inserted rows receive real
restore-time SDK audit; original audit stays in the checked source document.

The native destination validates graph/plan fingerprints and scope, reads one related snapshot,
checks source layout and hashes exact source bytes before classifying presence/authority. It stages
only the already-selected write group. The comparison actor requires a fresh exact match before
advancing to activation. Unknown or hidden results cannot authorize replay, overwrite or recreation.
An unresolved issued attempt stays bound to its original destination and transaction facts.

The pinned SDK requires omitting nullable transformed insertion fields to retain null defaults.
Provider IDs, archived accounts, legacy transfer representations and nullable associations remain exact.
The qualified adapter uses one financial batch; no unsupported partial-batch algorithm is introduced.

## Isolation schema and permissions

The additive migration adds nullable `organizations.restoreOperationId` and private `restoreOperations`.
Existing workspaces receive null bindings. The previous schema/normal policies remain a shared baseline
for compatibility tests; promoted policies compose qualified restore exceptions.

Preparation creates a destination header, immutable operation and retained source without owner
membership. Ordinary workspace discovery stays empty and normal edits/sharing remain denied.
The operation records owner, workspace/source-file references, payload/graph hashes and workspace header.
Its insertion policy checks those facts against the actual hidden workspace. It can transition only
from incomplete to active with unchanged bindings/header/hashes, and cannot be deleted or reopened.

While incomplete, only the operation owner receives scoped reconstruction inserts/recovery reads.
Publication atomically seals the operation and inserts the fresh owner membership. Owner membership
for a marked workspace requires its operation to be active. Publication closes reconstruction exceptions;
ordinary roles/grants govern live data afterward. Existing normal workspaces cannot gain restore access.

A fresh same-identity client can reconcile hidden rows using the private immutable header; it need not
read the hidden organization through ordinary discovery. Isolation does not prevent the authorized
recovering owner from explicitly querying those private rows. Server permissions enforce phase, owner,
scope, bindings and tested relationships. Full archive validation and exact graph comparison remain
trusted owner-client responsibilities, as in DLF's test app; the server does not independently prove
that an arbitrary owner client compared the entire graph.

Cached old-schema clients can edit published workspace settings even if they drop the unknown
reference to null. The immutable active operation keeps reconstruction closed. Old clients cannot
install a fresh non-null binding or reopen an incomplete workspace.

## Retained source and subsequent backups

The exact checked portable payload is retained as an immutable document in existing files/fileParts,
bound by immutable `restoreOperations.sourceFileId`. It includes original audit, collaborator and
sanitized bank metadata without making those records live. Parts are at most 256 KiB. The graph stores
source metadata; staging borrows bytes from the checked archive rather than expanding them for hashes.

Source access checks actual tenancy, null transaction/account associations, operation binding and phase;
a pointer alone grants nothing. Only the recovering owner reads it before publication; afterward only
current owners/admins can. Viewers retain normal attachment access but cannot read this source.
Mutation, deletion, rebinding and late part insertion are denied. Missing, malformed or hash-mismatched
source bytes block comparison/publication and subsequent export.

V2 exports include one inert sourceDocuments reference and its bounded attachment. Its checked payload
can contain a preceding generation, preserving provenance through another restore. The planner maps
only live financial attachments; preceding source documents stay inside the newly retained payload.
Embedded history uses the same strict field/relationship allowlist and a 32 MiB cumulative decoding
bound. Hash comparison rejects native corruption before download handoff.

The UI rejects a source payload over the existing 8 MiB per-file bound, a retained-source plus live-file
sum over 16 MiB, more than 5,000 combined files or more than 50,000 projected logical records. It never
silently drops history or raises DLF budgets. Repeated generations consume these bounds. Old cached
v1 writers collect transaction-linked files only and do not preserve restored provenance; use the
current v2 writer for that behavior.

## Qualification and limits

Tests use disposable schemas, ordinary real SDK accounts and persistent browser replicas. Backend
credentials only publish/inspect disposable data or inject explicit corruption. Every restore
experiment independently rereads its original source and requires it to remain unchanged. No production
reads/writes, schema publication, identity replacement, user-storage reset or deployment occurred.
The protected development checkout and ports 5173/5174 remain untouched.

The browser harness adds only test instrumentation around the production factories, including a finite
wire barrier and real transaction counters. A failed barrier cannot authorize writes. Lost-reply tests
forward actual writes, confirm server acceptance independently, terminate the entire browser, then
restart the retained profile. A page reload is not substituted for those restart tests.

Coverage includes:

- Original-policy rejection/acceptance baselines and private-lane relationship/header/owner denial.
- Cached-client additive migration, hidden catalogs and publication in Chromium, Firefox and WebKit.
- All live Finance types, archived/provider graphs, empty workspaces, original bytes and multipart UTF-8.
- Source-file role access, role downgrade, cross-workspace pointer substitution and immutable parts.
- V1 compatibility, strict v2 history, repeated backup/restore and deterministic budget refusal.
- Stable mappings, same UUID across types, substituted archive/identity/plan and interrupted crypto.
- Accepted preparation/financial/activation replies lost in all three engines; reconciliation issues
  zero new application commits. Missing local receipts do not fabricate evidence or strand accepted data.
- A genuinely unsent persistent outbox write synchronizes after restart without another application
  transaction. SDK retransmission is not counted as an application-issued replay.
- Corrupt destinations produce conflict without membership publication or replacement intent.
- Cancel/shutdown/invalidation retain native custody through held commits, rollback and close faults.
- Root shutdown/retry/recovery/startup-failure/observer-failure drain before releasing the old SDK session;
  unrelated workspace navigation remains usable.
- File-controller cancellation/reselection/reload, blocked close retry and completed history in all
  three engines; completed history never acquires a destination client.
- Actual settings downloads/restores, protected/plain files, wrong password, malformed input,
  no writes before review confirmation, navigation/cancellation, exact source preservation,
  one fresh owner membership, Open Workspace and duplicate-file completion lookup.

The persistent namespace is deliberately retained for uncertain-write recovery. Public
shutdown({waitForSync:true}) is qualified for its drain boundary, not namespace deletion, browser/OS
storage eviction or all-device quota behavior. An earlier memory-driver disconnect experiment exhausted
roughly 4 GiB and does not justify a private SDK workaround; the qualified design uses persistent storage.
T004 still needs representative maximum-size, phone and storage-pressure qualification. Prior desktop
536-record downloads measured roughly 3.6–7.1 seconds and 102–113 ms maximum observed main-thread tasks;
those samples are not platform-wide performance guarantees.

The change adds six files: planner, restore owner/controller module, frozen migration, migration
snapshot, browser test bridge and restore experiment suite. Earlier experimental schema adapters,
standalone test HTML/config, duplicate test-source projection and separate restore notes are removed.
The combined existing backup spec is the single implementation record. No DLF dependency change is
needed for this final application integration. Commit/push/PR and deployment remain separate actions.

### Final application verification

Node 24.22.2 verification on 2026-11-06:

- **1,895/1,895** unit/integration tests passed across 138 files, including 79 root lifecycle tests.
- **86/86** real restore experiments passed in 365.33 seconds. Chromium, Firefox and WebKit cover
  persistent replica isolation, migration, recovery, source preservation and controller lifecycle.
- **6/6** settings browser tests passed: protected/plain download-and-restore flows plus existing
  owner/admin/member/viewer settings access. The two complete restore flows took 40.0 and 46.3 seconds.
  They independently check all 521 transaction facts, exact attachment bytes and unchanged source audit.
- Application diagnostics: zero errors and warnings. Test/service-worker type checks, e2e scope
  validation, production build without a live Jazz service, changed-file formatting and diff checks passed.
- The existing CI workflow now runs the 86-case restore suite in a dedicated job with all three
  browser engines. The workspace browser job already includes both complete restore UI cases.

Commands use the repository's pinned dependencies:

```sh
pnpm exec vitest run
pnpm exec vitest run --mode restore-experiment --reporter=verbose
FINANCE_PREVIEW=true pnpm exec svelte-kit sync
FINANCE_PREVIEW=true pnpm exec svelte-check --tsconfig ./tsconfig.json
pnpm exec tsc --project src/service-worker/tsconfig.json --noEmit
pnpm check:tests
pnpm check:e2e
FINANCE_PREVIEW=true PUBLIC_JAZZ_APP_ID=ci-build PUBLIC_JAZZ_SERVER_URL=http://127.0.0.1:9 pnpm exec vite build
FINANCE_E2E_PORT=5192 FINANCE_E2E_REUSE_SERVER=true pnpm exec playwright test tests/features/workspace-settings.e2e.ts --project workspace
```

Run Node/framework checks and builds before starting the isolated preview. They regenerate SvelteKit
environment files; running them while testing the UI can replace that preview's Jazz URL. The final
UI runs used the restarted in-memory agent server on port 5192, with no further framework-generation
commands during those runs. Paraglide catalogs and message wording were unchanged.
