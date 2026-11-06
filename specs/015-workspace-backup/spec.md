# Finance workspace backup export (T008)

Implement owner-authorized current-data export through merged DLF `ad99117`, with password or
unencrypted download, independent reopening, and preserved source. Work is isolated on
`feat/workspace-backup-export`. Restore, production capture, identity/storage changes and
deployment remain separate actions. T007 inventory is complete; T004 platform qualification remains open.

## Profile and coverage

The profile is `delightful.finance.workspace` version 1, application `delightful-finances`.
`src/lib/backup/workspace.ts` defines the explicit field allowlist and pure profile validator.
Never spread SDK rows directly into an archive. Preserve exact amounts, currencies, dates, text,
optional variants, archived rows, cyclic transfer links, unassociated Checks and attachment bytes.
Preserve source audit timestamps, account attribution, and issuer/subject separately from domain fields.
Minimal membership-referenced profiles, memberships, account grants and sanitized bank history are
inert references; they never authorize a destination or reconnect a provider.

The declared graph contains 19 types: organizations, organizationMembers, profiles, accounts,
accountMemberships, categories, tags, transactions, transactionTags, checks, internalTransfers,
transactionBatches, batchTemplates, transactionAttachments, files, simplefinConnections,
simplefinAccountLinks, simplefinSyncAttempts and simplefinSyncAccountResults.

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

## State and resource ownership

The Finance reader is one finite machine invoked independently for hydration and capture:
authorize owner → scoped metadata → dependent relations/files/part metadata → validate closure and
bounds → allocate/read each bounded file part → hash → project/deposit capture → ready.
Denial, invalid data, cancellation and unexpected failure have explicit terminal results. An owner
must match both organization ownership and an owner membership; owner access does not depend on the
member/viewer account-selection field. No writable database/transaction is exposed to this reader.
File and part loops use guarded invocation completion rather than separate routing states. Continued
part reads explicitly reenter the reading state to start the next actor.

DLF hydrates the complete declared graph through ordinary remote reads before opening one native
exclusive transaction. It captures the complete scope, prepares/validates the payload, commits with
zero application mutations, and awaits the native verdict before protection or handoff. A conflict
discards the attempt; a new explicit attempt hydrates again with a fresh transaction. There are no
automatic retries, writer registration, maintenance confirmation or repeated graph comparisons.
Offline authority confirmation may remain pending.

The settings machine owns unavailable/editing/preparing states and a fixed invoked export whose
lifetime spans normal work, cancellation, invalidation and closing. It forwards controls and waits
for completion; a crashed child routes through retained-request release. Observations correlate
identity, workspace, membership, dependency attachment and generation, including A → B → A changes.
The integration component owns subscriptions, binding, browser dispatch and graceful root teardown.
The pure component holds editable form input and translates machine-selected feedback descriptors.
The preparing state's entry creates the request before its guards inspect that result.

Payloads, native handles and passwords stay outside actor snapshots. Native helpers contain one
query group, one digest, or a pure projection/validation; promise callbacks retain results and
protect private byte custody. DLF owns native receipt drain, rollback, encryption and handoff lifetime.
The browser dispatch clears its byte copy and URL in `finally`. Teardown requests shutdown and
observes completion before stopping the root; it never waits for a failed reader's acknowledgement.

## Scope and cleanup

Keep the complete diff to six added files: this document, the profile/native module, one machine
module containing reader and settings owners, one pure settings component, one unit/integration test,
and the replacement DLF archive. Browser coverage extends the existing workspace-settings tests.
Existing files may change for the complete DLF upgrade: public query factories and explicit
settlement, binding, attempt-identity and detached-receipt contracts. Use one complete package.

The old confirmation text, previous DLF archive and separate draft plan/checklist are removed.
No new schema, permissions, writer gate, cache, worker or restore workflow is added. The user approved
backup labels and shared general feedback on 2026-11-05; reuse other existing localized messages.

## Completion and verification

- [x] Explicit Finance fields/profile and exact graph validation.
- [x] Bounded native metadata and attachment reads.
- [x] Native hydration, exclusive capture and verdict integration.
- [x] Workspace settings interaction and approved localization.
- [x] Profile/actor qualification and real disposable Jazz/Chromium downloads.
- [x] Record measured Finance-path behavior and remaining platform limits.

Verification on 2026-11-05: application/test type checks, **1,879 unit/integration tests on Node 24.22.2 after rebasing onto Finance `fdf7d7a`**, browser
scope discovery, production build without a live Jazz service, formatting, and **six Chromium cases** pass.
Sixteen Finance integration cases use actual disposable Jazz with the full application policy.
Eight pure encoding cases cover empty input, padding, all byte values, chunk boundaries and the
8 MiB per-file limit. Attachment encoding uses bounded `btoa` conversion rather than the newer
`Uint8Array.toBase64` API, which is unavailable in the CI Node 24 runtime.
They cover all 19 archived types, protected/plain independent opening, audit/byte/source preservation,
secret exclusion, incomplete/unsupported source, budgets, ownership, native conflict/fresh attempt,
profile rejection, password validation, cancellation, scope replacement and shutdown.

The reader completion refactor passes application type checking, 26 focused Node 24 backup tests,
and both browser download cases. Coverage includes attachment-free exports and multiple multipart
files, with exact bytes checked after independent reopening.

Two real browser downloads each contain 536 Finance-profile records (521 transactions) and an
eight-byte original attachment. Files are 1,051,358 bytes protected and 1,051,267 bytes plain.
Two desktop runs measured the complete download, independent Node reopening and source-recheck
round trip at 3,601–5,824 ms protected and 4,131–7,082 ms plain. Longest observed main-thread tasks
were 102–113 ms protected and 107–108 ms plain. These samples use disposable Finance records;
they do not qualify deployed data, phones, large attachments or other browser engines.
T004 remains open; T009 restore and T010 actual deployed backup/recovery remain separate.

No production reads/writes, deployment, production schema publication, storage reset or identity
changes were performed. The protected development checkout and ports 5173/5174 were not modified.
