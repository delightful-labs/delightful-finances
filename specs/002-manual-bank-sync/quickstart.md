# Quickstart: Manual SimpleFIN Bank Sync

This feature is not implemented yet. This document records the intended user-facing flow for later implementation and review.

## Local Connection Flow

1. Open organization integration settings.
2. Submit a SimpleFIN setup token.
3. The app claims the token through a client-initiated request, directly or through a stateless CORS relay if browser CORS requires it; it discards the setup token and stores the Access URL in device-local secret storage, outside plaintext shared Jazz records.
4. Review the non-secret connection status.
5. Discover provider accounts (discovery behavior to be decided during implementation; it must not fetch transactions).
6. Map provider accounts to active local accounts.
7. Press **Sync now** to initiate one transaction fetch and import attempt.
8. Review the completed, partial, or failed result and last-attempt status.
9. Press **Sync now** again only when desired; no retry happens automatically.

## Non-Goals

- No scheduled or periodic sync.
- No background sync, polling, startup fetch, reload fetch, or online/reconnect fetch.
- No automatic first transaction fetch after connecting.
- No automatic retry after failure.
- No automatic local-account creation or implicit provider-account mapping.

## Implementation Preconditions

- Select device-local secret storage appropriate to the browser/PWA target and document its limits, especially XSS, profile-copying, device-loss, and recovery behavior.
- Confirm server-route authorization and Jazz write approach.
- Confirm provider protocol semantics, limits, pagination, revocation and financial-value conversion.
- Decide and document how provider account discovery occurs without transaction fetching.
- Ensure imported transaction identity is concurrency-safe and repeatable.

## Validation After User Review

Project rule: do not add or run tests until the user reviews and approves the implementation. Once approved, add focused unit and Playwright coverage for credential confidentiality, organization/account invariants, manual-only trigger behavior, idempotency, failure preservation, and supported transaction normalization, then run only the relevant checks.
