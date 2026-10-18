# Account connection with optional local-data merge

Status: proposed for review, 2026-10-16.

## User outcome

Before connecting another login identity by recovery phrase, a user with local finance data chooses Merge local data, Use connected account only, or Cancel. Merge adds the current personal workspace's finance records to the destination identity's personal workspace without replacing destination records. These scope and conflict defaults are proposed for review.

## Requirements

- Develop all merge presentation on the standalone `/account-merge` URL, including choices, summaries, previews, results and recovery. Keep the existing `/login` flow and navigation unchanged during development. The route must not switch identities or change finance data just by being opened.

- Show a source summary and explain duplicate handling and bank reconnection before switching identities. Empty seeded workspaces may use the existing connection flow. Same-identity connection is a no-op.
- Scope the first version to the source identity's owned personal workspace, never shared/business workspaces or other members' records. Do not silently select among multiple eligible personal workspaces: require source/destination selection if ambiguous.
- Copy records currently available on this device using normal local-first reads; show the captured counts and explain that unsynchronized remote records and later edits are outside this copy. A globally synchronized or atomic cross-tab snapshot is not required. Validate and durably save the source copy before switching. Do not delete or modify source finance records. Retain recovery information across navigation/reload; never persist recovery phrases or bank credentials in the merge journal.
- Import accounts, categories, tags, transactions, check details, transaction-tag links, and referenced batches/templates. Preserve money, currency, booked dates, notes, archives, relationships and bank transaction provenance. Keep the destination profile and memberships unchanged. Original Jazz audit fields cannot be copied; identify imported origin separately.
- Reuse destination system categories by kind. Preserve distinct user categories, tags, accounts and manual transactions even if labels, dates or amounts match. Recognize the same source records on retries and repeated merges.
- Deduplicate bank transactions using existing canonical provider external identity and destination organization. Never overwrite an existing transaction; report conflicting account mappings or values for review instead of silently discarding source differences.
- Do not migrate provider credentials or automatically connect, discover accounts, or fetch transactions. Report excluded connections and explain reconnection. Preserve provider provenance needed for later deduplication.
- Detect unsupported/unreadable related records, including attachments: block the affected import before writes and explain the issue; never claim a complete merge while omitting finance data.
- Show completed, partial, failed and cancelled results with counts and recovery actions. Local persistence and confirmed remote synchronization are distinct outcomes.
- After partial writes, cancellation preserves committed additions. Retry targets the same destination and snapshot and never overwrites later edits. Returning to the source requires an explicit action, not an unexpected session change.
- Use connected account only changes identity without importing; explain that local data will not appear in that account. Cancel before switching leaves the current session unchanged.

## Acceptance examples

1. Two identities with different ledgers become one destination personal workspace containing both sets after Merge; destination records and the source remain intact.
2. Repeating the same import after interruption creates no duplicate records or broken references.
3. Same-looking manual transactions remain separate; identical provider identities are skipped or reported as conflicts.
4. Invalid phrase, offline target, permission denial, concurrent tab operation, reload and cancellation expose recoverable outcomes without false success.
5. Archived records and check/tag relations survive; unsupported attachments block rather than disappear.
6. Choosing remote-only or Cancel performs no import. Bank reconnection remains an explicit separate operation.
