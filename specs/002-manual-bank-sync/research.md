# Research: Manual SimpleFIN Bank Sync

**Feature**: [spec.md](spec.md)  
**Plan**: [plan.md](plan.md)

## Decisions and Findings

### 1. Provider credentials belong to local device storage

**Decision**: Claim and fetch operations are initiated by the client after user action. Keep the setup token transient and store the resulting Access URL in device-local storage, separate from plaintext shared Jazz records. If SimpleFIN does not permit browser CORS, route only the explicit request through a stateless relay that does not retain or log the token, Access URL, or financial response.

**Rationale**: The product is local-first and has no application server. The SimpleFIN Access URL is a sensitive credential but should not become shared organization state in plaintext. A relay may address CORS without becoming the credential store; it is a sensitive transient intermediary and must minimize exposure.

**Implementation implication**: Determine the device-local storage mechanism appropriate to the actual web/PWA deployment and document its threat model, persistence, backup/reset behavior, and XSS limitations. Do not store the setup token after claim. Do not use the existing Jazz `accessUrl` field for plaintext credential persistence. A future multi-device design must separately define end-to-end encryption, key distribution, recovery, and revocation.

### 2. Manual sync requests are explicit commands, not lifecycle effects

**Decision**: The settings/integration UI makes a direct provider request only from an explicit Sync now action (directly or through a stateless CORS relay if required). No mount/startup effect, polling timer, online handler, background job, dev-reload hook, or automatic retry may call the transaction-fetch operation.

**Rationale**: User-controlled provider calls are the core scope constraint and prevent unnecessary requests during development.

**Implementation implication**: Keep the explicit handler easy to audit, disable/reject repeat clicks while the same local connection is in progress, and ensure failure UI offers only a new manual attempt.

### 3. Model attempts and transaction idempotency explicitly

**Decision**: Track attempt start/completion outcome and imported/omitted counts without conflating connection health and last-sync outcome. Deduplicate imported records by organization/connection/account context plus provider transaction identifier, using a uniqueness-enforced or safely serialized upsert strategy appropriate to the selected data store.

**Rationale**: Provider identifiers may not be globally unique across all accounts, and users can repeat a manual sync after success, partial failure, or an unclear result.

**Implementation implication**: Inspect Jazz uniqueness and concurrent write behavior before choosing the exact identity constraint. Do not rely only on a client-side pre-read for uniqueness under concurrent operations.

### 4. Preserve normalized financial values and report unsupported data

**Decision**: Validate provider amounts, currencies, dates, identifiers, and account mapping before persisting transactions. Do not guess missing or unsupported values; record an omission/failure outcome visible to the user.

**Rationale**: Imported financial data must satisfy transaction invariants and must not silently corrupt local books.

**Implementation implication**: Use a typed provider adapter and the existing transaction validation boundary. Confirm SimpleFIN amount sign semantics and the supported currency/decimal handling against the protocol before implementing conversion.

### 5. Provider mapping is explicit and organization-scoped

**Decision**: Allow owner/admins to map provider accounts to active local accounts before import. Do not import from unmapped provider accounts or auto-create local accounts.

**Rationale**: Explicit mapping avoids accidental assignment and keeps sync behavior predictable.

**Implementation implication**: Enforce organization ownership and active-account constraints in the client integration and Jazz permission rules, not only in form options.

### 6. Connection setup does not trigger an initial transaction fetch

**Decision**: A successful claim records connection status but performs no account transaction fetch. Account listing needed to support mapping may be retrieved as part of an explicit account-discovery action or connection setup, provided it does not fetch transactions; the final UX/API behavior should keep this distinction clear.

**Rationale**: User specified manual start of actual sync. Avoid making connection setup a hidden transaction-sync trigger.

**Implementation implication**: The task plan must define provider-account discovery and its possible provider calls distinctly from transaction fetching, and ensure no transaction data is requested until Sync now is pressed.

## Open Research Before Implementation

- Which device-local storage mechanism should own the Access URL for this web/PWA product, and what security guarantees are expected against local file access, browser-profile copying, XSS, and device loss?
- Should SimpleFIN connection be per browser/device in the initial release, or must bank access be available across a user's devices? The latter needs a separate E2EE secret-sharing/recovery decision.
- Verify SimpleFIN CORS behavior for claim and `/accounts`; use a stateless relay only if direct browser requests are blocked.
- Decide how connection ownership and sync authority work inside a shared organization when the secret is only on one device; owner/admin metadata in Jazz is not sufficient by itself to let other devices make provider requests.
- Confirm SimpleFIN protocol claim/fetch request details, amount sign conventions, pagination/record bounds, rate limits, and revocation behavior using authoritative provider documentation before coding.
- Confirm Jazz permission/write patterns for client-initiated transaction import while preserving organization and account invariants.
- Confirm how to enforce imported-transaction uniqueness and concurrency safety in the current Jazz version.
- Decide whether provider-account discovery occurs automatically after connect or behind a separate explicit “Load accounts” action. It must never fetch transactions.
