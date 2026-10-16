# Implementation Plan: Manual SimpleFIN Bank Sync

The specification and constitution govern this implementation. The previous device-local plaintext credential design is superseded.

## Architecture

Use WebAuthn PRF with required user verification and HKDF-SHA-256 to derive a nonextractable AES-256-GCM key. Verify an encrypt/decrypt sample using two separate assertions before claiming a setup token. Bind encryption to the signed-in user, organization, connection, credential ID, PRF salt, and format version using authenticated additional data. Persist only ciphertext and public unlock metadata in Jazz. Never store keys or plaintext credentials.

Keep XState orchestration, Jazz subscriptions, and authorization in the bank settings integration route. Use a props-only presentation component and Paraglide messages. Connection setup uses explicit XState states for passkey creation, waiting for the encryption-test action, encrypting the sample, waiting for the unlocking-test action, verifying the sample, waiting for final confirmation, and claiming/saving. Each waiting view has an explanatory button; the token form is hidden during setup. Cancellation and scope changes clear transient setup data. Claiming occurs only in the final confirmed state. Each credential-using operation obtains a fresh passkey assertion; Web Locks reject overlapping operations across tabs without queuing; scope changes and navigation abort work. No lifecycle event starts provider requests or retries.

Support SimpleFIN Bridge HTTPS endpoints through a stateless same-origin relay to handle browser CORS. Restrict destinations to bridge.simplefin.org, reject redirects, enforce same-origin requests, omit caching and credential/response logging. No server Jazz writes: the authenticated client enforces owner and membership checks and Jazz enforces writes.

Discovery is a separate explicit action using balances-only=1. Sync now fetches a bounded date window after passkey unlock. Default to an explicit Add account action using the discovered provider name and currency and bank kind, saving the account and mapping in one local transaction with deterministic IDs. Show optional existing-account mapping only when active local accounts exist. Normalize decimal strings exactly to integer USD minor units, omit pending/invalid/unsupported records, and use deterministic transaction row IDs scoped to organization and provider account identity so concurrent devices converge on one row. Preserve existing imported rows on repeats and failure.

## Delivery batches

1. Align artifacts and add credential validation/cryptography.
2. Add encrypted Jazz records and permissions, provider adapter and restricted relay.
3. Add bank settings XState workflow, presentation, localization and navigation.
4. After implementation approval, add unit and Playwright coverage and run relevant tests. Physical-device PRF synchronization validation remains required before declaring cross-device compatibility.

## Constitution check

Local-first ordinary finance is unchanged. Provider operations require explicit actions. No plaintext secret replication, casts, any, switch statements, invented styling, or automatic requests. Use additive schema changes and deterministic import IDs. Type checks and focused formatting run during implementation; tests await review per repository instructions.
