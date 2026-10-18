# Source copy contract

## User-directed simplification

Merge is an explicit copy of finance data available in the current personal
workspace into another identity's personal workspace. It uses existing Jazz reads
and normal authorized inserts, like creating records through the application.
No Jazz changes, global sync barrier, or coordination of every finance editor is
required. This replaces the earlier SDK capability request.

## Capture behavior

1. Read the selected owned personal workspace using explicit local-first queries,
   including archived records and the related collections required by the snapshot.
   Capture the records available on this device; do not claim that every remote
   device has synchronized. Do not union remote and local arrays.
2. Project records into the existing versioned snapshot format and validate it with
   the existing canonical snapshot validator. Missing required relationships,
   unsupported attachments, permission/query failures and size limits are explicit
   failures before identity replacement. Never silently drop invalid records.
3. Show counts and explain that this is a copy of data currently available on this
   device. Changes made after capture are excluded. Concurrent edits can require a
   fresh capture if validation fails; no cross-table point-in-time guarantee is made.
4. Save the validated copy in the existing IndexedDB journal before switching
   identity. Leave source records unchanged. Retry uses that saved copy.
5. Bound reads using subscription ownership, cancellation and timeout. Identity or
   workspace changes invalidate an in-progress capture. Release subscriptions on
   every terminal path; a failed capture leaves the current session usable.

## Destination behavior

Reuse the existing mapping and preview. Create dependencies, then transactions
and their relations with ordinary authorized Jazz inserts/transactions. Stable
IDs and origin receipts recognize retries. Existing destination data is never
blindly overwritten. Copy no recovery phrase or bank credentials.

Report local persistence separately from server acceptance, just as the rest of
the local-first application does. A copied source record that later changes or
is rejected does not retroactively update the destination copy.

## Focused capture statechart

`idle -> reading -> validating -> captured`

Reading invokes scoped query adapters; validating invokes the existing snapshot
validator. Read failures/timeouts enter `failed`; invalid graphs enter `invalid`.
Cancel enters `cancelled`; shutdown and scope changes release readers before
completion. Context holds captured records and typed results, not lifecycle flags.
Saving, identity replacement and destination writes belong to subsequent children.

## Verification after implementation review

Cover local pending inserts/edits/deletions as returned by local-first reads,
archive inclusion, exact value preservation, invalid references, unsupported
attachments, query failure, timeout, scope changes and cancellation. Verify no
source writes and no identity replacement during capture. Do not assert a global
snapshot guarantee that this workflow does not provide.
