# Merge data model

## Local-only snapshot and journal

The first implementation slice defines the device-local version-1 wire format in
`src/lib/validation/account-merge.ts`, with its derived type in matching
`src/lib/schema/account-merge.ts`. These are not new Jazz tables or a capture API.
All collections and nullable fields are required explicitly; archive timestamps
are ISO date-time strings and booked/check dates remain calendar-date strings.
Validation does not trim, default, deduplicate or otherwise rewrite finance data.
Unknown fields (including connection credentials) are rejected.

Account, category and tag shapes derive from their canonical Zod schemas.
Transaction money, dates, source variants, payment methods, memo and check fields
also reuse existing validation. Snapshot adapters remove defaults, serialize
archives, and validate transformed text without replacing its original value.
Graph relationships and snapshot-only metadata remain merge-specific.

Initial limits are 10,000 total collection records and 8 MiB of UTF-8 JSON for the
validated wire payload. Exceeding either limit rejects the snapshot without
truncation. The limit excludes the organization descriptor and connection count
from the record total. It is a persistence payload limit, not an input-stream or
capture memory guarantee; capture must enforce its own bounded resource use.

The validator checks personal ownership/scope, unique IDs within each table,
account currency/category kind, batch and tag references, reciprocal check
references, transaction source identity, and duplicate transaction-tag pairs.
Archive references are accepted to preserve history. Any attachment blocks the
snapshot. Bank account links contain only source IDs and non-secret provider IDs;
connections are represented only by an excluded count. All workspace templates
are represented because the current schema has no batch-to-template reference.

Successful parsing proves structural and reference validity only. The future
capture adapter must establish authorization and complete scope separately; an
explicit empty attachment collection is not evidence that it was fully read.
After implementation review and explicit authorization to add tests, the validator
passed 53 focused unit cases covering preservation, required values, graph scope
and relationships, unsupported payloads, canonical field validation and record/UTF-8
size boundaries. The existing 50 transaction-validation tests also passed, as did
TypeScript checking. These results do not establish capture completeness or a
user-visible merge workflow. No capture or import effects exist yet.

Versioned snapshot: source identity/organization IDs, complete supported finance graph, source row IDs, validated values, referenced batch data and record counts. Exclude credentials and profiles/memberships. Store no separate createdOn/updatedOn timestamps; preserve user dates and original audit metadata only as provenance where needed.

Journal: operation ID, source and destination IDs when known, snapshot version, stable row mappings, per-record committed receipt references and typed failure details. Store facts needed to reconstruct progress; the machine owns live lifecycle states. Never resume into a different identity/organization implicitly. Retain payload after partial/failure; explicit discard explains that previously committed additions remain.

### Initial journal storage slice (awaiting implementation review)

`validation/account-merge-journal.ts` composes the existing snapshot validator into
a strict version-1 envelope: operation ID, immutable snapshot and nullable exact
destination identity/organization IDs. Its matching schema file exports derived
types. No phrases, credentials, lifecycle flags or raw failure messages are stored.
Import mappings, receipts and typed failure details will extend this envelope in a
later reviewed cycle before an importer uses it.

`machines/account-merge/journal.ts` handles one validated `LOAD`, `CREATE`, `BIND`
or `DISCARD` command per invocation. Guarded transitions reject an existing journal
on creation, stale operation IDs and destination retargeting. The parent merge
coordinator will invoke this child for each explicit storage operation.

```mermaid
stateDiagram-v2
    [*] --> validating
    validating --> reading: valid command
    validating --> failed: invalid command
    reading --> deciding: storage settled
    deciding --> completed: load or already absent discard
    deciding --> conflicted: incompatible operation or destination
    deciding --> writing: valid mutation
    writing --> completed: commit settled
    writing --> conflicted: atomic comparison failed
    reading --> cancelling: cancel
    writing --> cancelling: cancel
    reading --> closing: shutdown
    writing --> closing: shutdown
    cancelling --> cancelled: read settled or transaction aborted
    cancelling --> partial: write committed
    cancelling --> closing: shutdown
    closing --> closed: read settled or transaction aborted
    closing --> partialShutdown: write committed
```

Read/write errors also route to explicit failure states. Terminal results distinguish
completion, conflict, failure, cancellation, shutdown and committed partial progress.
Shutdown takes precedence over later cancellation. Invoked actors remain alive
while cancellation/shutdown waits for the active operation to settle; actor
stopping is not used as the domain cleanup handshake.

The coordinator invokes a focused `journal-write` child machine. Its guarded
states check creation constraints, unchanged operation/source snapshot, and
destination compatibility before choosing separate replacing/removing states.
Conflict, failure, cancellation and committed writes are explicit terminal states
with typed results. Cancellation keeps the child's I/O actor alive until the write
settles; the coordinator then reports cancelled versus partial progress and preserves
shutdown priority. Both machines invoke the shared `journal-storage` state machine.

That storage machine owns availability, opening, transaction selection, abort
settlement, connection closing and terminal classification. Reading, replacing and
removing each invoke a focused transaction actor; their nested aborting state keeps
that actor alive until commit/abort. A connection actor outlives the transaction
and acknowledges close before the storage machine returns its typed result.
Cancelled, conflicted, failed and completed are separate final states. No async
`transact` function or manually started actor/promise bridge remains.

`account-merge/journal.ts` contains the native IndexedDB callback actors and dependency
binding. Its connection actor owns the open request and database handle. Transaction
actors register browser handlers and synchronously validate/compare/mutate within
the active transaction. They report success only from `oncomplete`, or failure from
abort; these callbacks do not choose journal workflow policy.
The database is scoped by public app ID and has one pending slot across identity
replacement. The adapter retains one atomic comparison of the entire stored journal
with the actor's previously observed value. The actor's policy checks therefore
apply to the exact value being replaced; a concurrent change produces a conflict
instead of bypassing those checks. This comparison cannot be moved outside the
IndexedDB write transaction. Discard deletes only device-local recovery data, never
Jazz finance records.

Every read validates the envelope and full snapshot. Corrupt or unsupported data
fails explicitly and remains stored; it is never treated as an empty journal or
deleted automatically. A dedicated corrupt-journal recovery action is not part of
this slice. Writes request strict durability and resolve on transaction completion,
not individual request success. Local storage acceptance does not establish remote
sync or protection against browser storage eviction.

The actor tree owns database handles, cancellation messages and transaction cleanup.
Abort before commit cancels the transaction; a completed commit is not rolled back.
Blocked opens fail explicitly and close a connection if it arrives later. Errors
expose fixed codes rather than the rejected finance payload. These are resource
operations and atomic storage invariants. Journal workflow decisions belong to the
child machines above; the application-owned merge coordinator remains responsible
for session authorization, exact-target resume and operation-wide cross-tab locking.
Transaction serialization alone does not prevent a discard during an active import.

TypeScript checking passed. No tests have been added or run for this new slice;
after review, cover reload persistence, concurrent creation, immutable target
binding, stale operations, corruption, unavailable/blocked storage, abort races and
machine cancellation/shutdown settlement (including a commit racing cancellation).

## Additive Jazz provenance

Proposed dedicated `mergeOrigins` table, finalized in the schema review: destination organizationId, source organizationId, source entity type, source recordId, destination recordId. Deterministic receipt ID from the complete origin tuple. Enforce destination admin authority and valid referenced destination records. Do not store source secrets or grants. Receipts persist after local snapshot cleanup and distinguish a prior import from an unrelated row-ID collision. Include supported original attribution metadata only if required for the reviewed UI, never forge Jazz audit fields.

## Mapping rules

- Organization: chosen source owned personal workspace → chosen destination owned personal workspace.
- System categories: map by income/expense kind, independent of translated name.
- User categories/tags/accounts/batches/templates: stable imported IDs; no name-based unification. Restore archives after references.
- Transactions: preserve integer amount, kind, currency, bookedOn, memo, payment method, source/externalId and relationships. Manual IDs derive from full origin. SimpleFIN IDs use the existing provider formula. Existing records remain authoritative; differing source values or ledger mapping become visible conflicts.
- Check details: preallocate detail/transaction IDs and remap both directions; verify one-to-one relation.
- Transaction-tag links: remap both ends and use stable IDs.
- Attachments: detect and stop unsupported graphs before import; current file permissions cannot support lossless copying.
- Credentials/connections/memberships/profile: excluded with explicit connection reconnection notice. Preserve provider account identity as non-secret provenance for later reconnect decisions; do not create active links to absent connections.

## Identity allocation slice (reviewed and unit-verified)

`validation/account-merge-mapping.ts` reuses the complete snapshot and destination
validators and canonical category fields. Destination category observations require
explicit system/archive values; form defaults are removed with `unwrap()`. These
transient observations do not prove complete hydration or destination authority.
The matching schema module defines typed allocation results and fixed error codes.

`machines/account-merge/mapping.ts` owns input/scope checks, record routing,
system-category selection, ID allocation and terminal cleanup. Shared state
configuration handles ordinary/provider allocation without duplicating their
invocation/error transitions. `account-merge/mapping.ts` contains pure projections
and identity-name formatting; it makes no database queries or writes.

```mermaid
stateDiagram-v2
    [*] --> validating
    validating --> checkingIdentity
    checkingIdentity --> checkingWorkspace
    checkingWorkspace --> checkingCategories
    checkingCategories --> nextRecord
    nextRecord --> routingRecord: remaining record
    routingRecord --> matchingSystemCategory: system category
    matchingSystemCategory --> allocatingSystemOrigin: one active match by kind
    routingRecord --> allocatingProviderIdentity: SimpleFIN transaction
    routingRecord --> allocatingOriginIdentity: other supported record
    allocatingSystemOrigin --> advance
    allocatingProviderIdentity --> advance
    allocatingOriginIdentity --> advance
    advance --> nextRecord
    nextRecord --> mapped: all identities allocated
```

Invalid input, same identity/workspace, cross-scope/duplicate destination category
IDs, missing/ambiguous active system categories, and rejected UUID allocation have
explicit failure transitions. Cancel and shutdown terminate allocation, clear source
payloads and discard late digest results. UUID calculation has no persisted effect
requiring a commit/abort handshake. No partial import is reported for allocation.

All hashes use the destination organization as namespace. Ordinary destination IDs
use `account-merge:` followed by the JSON tuple `[sourceOrganizationId, entity,
sourceRecordId]`; origin receipt IDs use the same tuple with `account-merge-origin:`.
SimpleFIN transaction IDs retain the bank importer's exact
`simplefin-transaction:${externalId}` name. System categories reuse exactly one
active destination system category of the same income/expense kind. Ordinary
records are never combined by label, date or amount.

The result contains source/destination IDs and origin receipt IDs for accounts,
categories, tags, transactions, check details, transaction-tag links, batches and
templates. It does not create origin receipts, rewrite references or decide target
row collisions. Multiple source provider transactions can resolve to one canonical
ID; preview/import must still compare their values and account mappings rather than
silently skip differences. Source bank-account links remain snapshot provenance;
this allocator does not plan active links to absent connections.

The proposed `mergeOrigins` table, transactional receipt writes, archive/check
sequencing and preview/import effects remain separate work. Source capture remains
gated by [capture-contract.md](capture-contract.md). After implementation review,
25 focused unit tests pass for supported-graph allocation, source preservation,
manual-record separation, stable retry/order/scope identities, canonical provider
IDs with distinct origin receipts, active system-category selection, empty graphs,
strict required input fields, invalid scope/graphs, missing/ambiguous categories,
allocation rejection and cancellation/shutdown racing late resolution/rejection.
Assertions also verify terminal payload cleanup. TypeScript and focused formatting
checks pass. This verifies allocation independently of capture, authorization,
preview conflict decisions or finance writes.

## Invariants

All references stay within the destination organization. Currency and transaction kind match referenced account/category. No implicit authorization transfer, no unrelated destination overwrites. A committed target row and its origin receipt must be consistent atomically. A retry skips already imported origin even after the user edits the target. A canonical provider collision without matching provenance is existing/conflict, never replacement. Import conflicts result in partial completion until explicitly resolved; unsupported graph errors block before any writes.
