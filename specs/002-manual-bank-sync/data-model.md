# Data Model: Manual SimpleFIN Bank Sync

## Existing Records

The current codebase defines:

- `simplefinConnections`: `organizationId`, `accessUrl`, `status`, `lastSyncAt`, `lastError`, and `claimedAt`.
- `simplefinAccountLinks`: organization id, local account id, SimpleFIN account id, and optional SimpleFIN organization id.
- `transactions`: transaction source (`manual` or `simplefin`) and optional `externalId`; application validation requires an external id for SimpleFIN-imported transactions.

Connection and account-link Jazz records currently have owner/admin-only permissions. Because Jazz records are replicated to clients with access, role restrictions are not device-local secret storage. The existing `accessUrl` field must not be used for plaintext credential storage under this feature; device-local credential storage must be separate.

## Target Conceptual Records

### Provider connection metadata (Jazz/client-safe)

- Organization identity
- Non-secret connection status that is meaningful at the organization level, where appropriate
- Last completed shared sync metadata, if it is shared across devices
- User-safe error/status summary, excluding credentials and sensitive provider response data
- Local-only connection availability is maintained separately and must not be inferred from a shared status record

### Provider credential (device-local)

- Organization/connection identity used to scope the credential to the active workspace on this device
- Claimed Access URL
- Stored in device-local secret storage separate from plaintext shared Jazz records
- Available to the local integration flow for user-initiated requests; never written to logs, URLs, or ordinary UI
- Not automatically available to another browser, device, or organization member; multi-device sharing requires a separate encrypted key-distribution and recovery design

### Provider account mapping

- Organization identity
- Provider account identity and provider organization identity when present
- Local account identity
- Mapping must resolve to an active local account in the same organization at sync time
- Mapping is unique enough to prevent one provider account from ambiguously targeting multiple local accounts
- Mapping can be shared organization data, but the local device must have a matching credential before fetching/importing

### Sync attempt

- Organization identity and local connection identity where needed
- Attempt identifier and start/completion timestamps
- Outcome: running, succeeded, partial, failed, or cancelled if cancellation is supported
- Counts of imported, already-present, and omitted records
- Sanitized user-safe failure summary
- The record represents a user-initiated action only; it does not schedule future work
- Decide which attempt metadata is shared to the organization versus retained locally to avoid implying another device has the credential

### Imported transaction

- Existing transaction financial fields and organization/account/category references
- Provider source marker
- Stable provider transaction identifier
- Provider-account/connection context sufficient to disambiguate identifiers
- Persistent idempotency invariant for repeat/manual retry

## Invariants

1. A setup token is transient and is never persisted in either Jazz or secret storage.
2. A claimed Access URL is stored only in device-local secret storage and is not synchronized in plaintext through Jazz. The local browser runtime can access it when the user initiates an operation; this does not protect against same-origin script compromise while unlocked.
3. One Sync now action creates at most one active attempt for an organization connection.
4. No timer, lifecycle event, network reconnection, or failure handler creates or retries an attempt.
5. Only transactions belonging to mapped provider accounts and active local accounts are eligible for import.
6. An imported provider transaction identity is unique within its provider/account context and cannot create duplicates on repeated sync.
7. All imported values satisfy the existing transaction amount, currency, category, account, and date invariants.
8. Failed/partial operations preserve already-committed valid transactions and expose a truthful outcome.
