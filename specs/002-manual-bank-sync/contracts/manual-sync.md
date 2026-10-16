# Manual Sync Contract

This is a user-visible behavior contract, not an implementation-specific HTTP schema. Exact request/response shapes belong in implementation tasks after the server runtime and authentication boundary are confirmed.

## Authorization

- The caller must be an authenticated owner or admin of the target organization.
- Members and viewers cannot initiate a sync.
- Organization identity must be verified against caller permissions on the server.

## Trigger

- A transaction-fetch attempt begins only after one explicit Sync now action by an authorized user.
- Connection setup, account discovery, startup, reload, network reconnection, timers, ordinary data changes, and failure handling do not initiate or repeat transaction fetching.
- A repeated action while the same connection is running does not start a concurrent second attempt.

## Outcome

The result communicates:

- Attempt status: running, succeeded, partial, or failed.
- Attempt time and last outcome.
- Number of imported, already-present, and omitted transactions when available.
- A sanitized user-facing error or next step when unsuccessful.

- The result never includes a setup token or claimed Access URL. A failed/partial attempt does not roll back previously persisted valid transactions and does not automatically retry.

## Local credential custody

- The setup token is transient and is used only for the one-time claim operation.
- The resulting Access URL is stored device-locally, separate from plaintext shared Jazz organization records.
- The Access URL is available to the local client integration only when the user initiates a provider operation; it is not automatically replicated to another device or member.
- If browser CORS requires a relay, the relay forwards only the user's explicit request and must not retain or log setup tokens, Access URLs, or provider financial responses.
- This storage boundary does not protect an unlocked app from same-origin script compromise. Device-local encryption, key handling, recovery, and sync behavior must be specified before implementation.
