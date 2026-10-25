# Research: Link Internal Transfers

## Decisions

### Represent the pair as a separate internal-transfer record

- **Decision**: Add one workspace-scoped record that references exactly one expense and one income transaction with the same currency and amount. The rows may already exist (for synced matching) or may be created with the relationship in one paired-entry action.
- **Rationale**: Existing transactions, provider IDs, IDs, dates, categories, tags, checks, and attachments remain untouched when linked. Paired manual creation still creates two ordinary rows rather than a third transfer transaction. The relationship can be removed without rewriting either movement. It is also a direct source for reporting exclusions and suggestions can reject already-linked endpoints.
- **Alternatives considered**: Use a third transaction kind (rejected by the approved model); use a shared transfer ID copied onto both transaction rows (makes partial pair state easier to create and complicates hiding a counterpart); infer links from payment method or equal amounts (ambiguous and unsafe).

### Enforce two-sided access at the relationship boundary

- **Decision**: A user can create, change, or remove a pair only with write access to both endpoint accounts. A transfer relationship is readable only when both endpoint transactions are readable.
- **Rationale**: This follows the approved authorization/privacy rules. A linked transaction remains available under ordinary account permissions; the relationship cannot reveal the hidden counterpart.
- **Alternatives considered**: Expose the counterpart ID or label while hiding its fields (still leaks relationship details); rely only on editor visibility (does not protect direct Jazz reads/writes).

### Store policy-checkable pair facts

- **Decision**: Store the two endpoint account IDs, shared minor-unit amount, and currency on each relationship as immutable policy facts. Populate them from the current endpoint rows in the same exclusive transaction. Keep the new columns nullable only for migration compatibility; relationship policies reject rows missing them.
- **Rationale**: Jazz alpha.59 permission expressions can correlate each endpoint query to fields on the relationship row, but cannot compare two joined sibling transaction rows to each other. Storing the shared values lets policy verify each endpoint independently, reject same-account links, and preserve amount/account/currency facts during transaction edits. It also lets direct Jazz writes receive the same pair-shape checks as application workflows.
- **Alternatives considered**: Enforce pair shape only in the UI or statechart (permits malformed direct Jazz writes); add transfer metadata to each transaction (creates partial pair state and duplicates lifecycle); leave current schema and weaken direct-write guarantees (does not meet the approved authorization model).

### Use exclusive transactions for pair invariants

- **Decision**: Model link, unlink, and linked deletion as statecharts owning resource acquisition, read/check decisions, staging, commit settlement, rollback, cancellation, and typed outcomes. Use Jazz exclusive transactions for their serializable authority validation. Leaf promise actors carry out individual database operations.
- **Rationale**: Each action reads both transactions and permissions, validates invariants, and writes multiple related records. The installed Jazz package exposes `beginExclusiveTransaction()`. Jazz's transaction documentation states that exclusive transactions validate a stable read/write view at the authority and reject conflicting changes; unlike mergeable work, they cannot be accepted offline. XState memory requires explicit states for these decisions and resource lifecycles.
- **Alternatives considered**: Mergeable transactions permit concurrent changes and can violate one-counterpart-per-transaction; a single async callback or `fromPromise` containing the whole operation is rejected by `.specify/memory/xstate.md`.

### Add separate account-level delete authority

- **Decision**: Add a distinct delete capability to account grants and an administrator-managed control before enabling linked deletion actions. Ordinary write permission alone will not authorize deleting a linked movement.
- **Rationale**: The current `accountMemberships.access` is only `read` or `write`, while the approved transfer foundation requires delete authorization to be checked separately. Current transaction deletion policy uses write access and cannot satisfy that requirement by assumption.
- **Alternatives considered**: Treat write as delete permission (contradicts the approved transfer authorization rule); make all deletions administrator-only without making the new capability assignable (does not provide the required per-account permission model).

### Filter totals from linked relationship records

- **Decision**: Workspace expense totals and categorized breakdowns exclude transactions referenced by an internal-transfer relationship. Account histories and balances retain them.
- **Rationale**: This matches the approved reporting rule while keeping the account movement visible. The legacy `transfer` payment method remains unrelated.
- **Alternatives considered**: Remove rows from all views (incorrect account balance/history); exclude by category or payment-method value (not a linked status and can hide ordinary expenses).

### Match a seven-day, exact same-currency window

- **Decision**: Suggest transactions in the active workspace with opposite kind, another account, exact currency and minor-unit amount, no current relationship, and a business date within seven calendar days before or after the edited transaction. Sort nearest dates first.
- **Rationale**: Uses the approved same-currency equality rule and the initial product default from the spec. It avoids online conversion and prioritizes likely matches.
- **Alternatives considered**: Date-only or amount-only matching (too ambiguous); cross-currency suggestions (could imply conversion); wider or user-configurable window (not requested for the first slice).

## Repository Findings

- Transactions are defined in `src/lib/schema/transactions.ts`; the app combines table schemas in `src/lib/schema.ts` and policies in `src/lib/permissions.ts`.
- Current permissions support organization roles and account grants with `read`/`write` access. Transaction deletion currently follows write access; there is no independent delete field or management control.
- Transaction editing is integrated in `TransactionEditEntry.svelte`; `TransactionForm.svelte` is presentation. The edit workflow uses `transaction-save.ts`.
- `ExpenseOverview.svelte` computes period, category, and currency totals from the transactions it receives. Account history and transaction grouping are separate and must remain unchanged.
- `src/lib/machines/independent-transaction-persistence.ts` and bank account write statecharts demonstrate resource-owning Jazz transactions and typed settlement. They are references, not a reason to reuse or relocate their orchestration.
- The current schema has migration history through `20261021T133935-3407b5b1f26c.json`; the new schema needs an additive migration from that version. No data reset is authorized.
- The installed Jazz alpha.59 types and runtime expose `beginExclusiveTransaction()`; no runtime check or server publication has been performed.
- Cross-currency linking is deferred in this feature; the existing approved finance spec remains the future source of those requirements.
- The feature adds visible strings, so message catalog changes require `localization.md` and Paraglide compilation after implementation review.

## Risks to Resolve During Implementation

- Verify the transfer policies reject missing policy facts and malformed direct writes, including during paired creation and unlink-and-delete transactions.
- Exclusive link operations require authoritative acceptance, so disconnected users can review suggestions but cannot complete a link or unlink until the authority responds. Ensure pending/cancellation behavior does not imply rollback before actual settlement.
- Verify whether Jazz migration generation produces a compatible migration and snapshot from the current schema. Do not publish/reset data as part of local implementation.
- Account-level delete controls do not currently exist; keep permission grant changes in a focused review slice and inspect every affected access helper and UI caller.
