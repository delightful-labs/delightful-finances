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
user-visible merge workflow. No journal or import effects exist yet.

Versioned snapshot: source identity/organization IDs, complete supported finance graph, source row IDs, validated values, referenced batch data and record counts. Exclude credentials and profiles/memberships. Store no separate createdOn/updatedOn timestamps; preserve user dates and original audit metadata only as provenance where needed.

Journal: operation ID, source and destination IDs when known, snapshot version, stable row mappings, per-record committed receipt references and typed failure details. Store facts needed to reconstruct progress; the machine owns live lifecycle states. Never resume into a different identity/organization implicitly. Retain payload after partial/failure; explicit discard explains that previously committed additions remain.

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

## Invariants

All references stay within the destination organization. Currency and transaction kind match referenced account/category. No implicit authorization transfer, no unrelated destination overwrites. A committed target row and its origin receipt must be consistent atomically. A retry skips already imported origin even after the user edits the target. A canonical provider collision without matching provenance is existing/conflict, never replacement. Import conflicts result in partial completion until explicitly resolved; unsupported graph errors block before any writes.
