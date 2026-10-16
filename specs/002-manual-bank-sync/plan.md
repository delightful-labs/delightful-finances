# Implementation Plan: Manual SimpleFIN Bank Sync

> **Needs replanning:** The updated [specification](spec.md) adopts passkey-protected encrypted credential replication across the connecting user's devices. This plan and its derived research, data model, contracts, and quickstart still describe the earlier device-local design and MUST NOT guide implementation until aligned with the updated spec.

**Branch**: `002-manual-bank-sync` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-manual-bank-sync/spec.md`

## Summary

Add device-local SimpleFIN connection setup, organization-scoped provider-account mapping, and transaction import only when a user presses Sync now. Preserve local-first finance workflows, keep provider credentials out of plaintext shared records, and use provider transaction identity to make repeated manual syncs idempotent. No automatic, scheduled, startup, reconnect, or retry-based provider fetch is allowed.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5

**Primary Dependencies**: SvelteKit 3, `jazz-tools` v2, Paraglide JS, existing Zod validation and XState workflow conventions; SimpleFIN service integration to be selected/implemented

**Storage**: Jazz for organization-scoped connection metadata, account mappings, imported transactions, and local-first finance data; the SimpleFIN Access URL is held in device-local storage outside plaintext Jazz replicas. Any cross-device secret sharing is deferred pending an explicit encryption and key-distribution design.

**Testing**: Vitest unit coverage and Playwright user-flow/authorization coverage are required by the constitution, but tests are added/run only after the user reviews and approves the implementation

**Target Platform**: Responsive browser/PWA; client-initiated provider operations with a stateless CORS relay only if the provider's CORS policy requires one

**Project Type**: SvelteKit web application

**Performance Goals**: Connection status and locally available transaction data remain responsive without waiting on SimpleFIN. Manual sync communicates progress and completes or fails with a visible result.

**Constraints**: No `any`, no TypeScript `as` casts, no `switch`/`case`; all user-visible text via Paraglide; setup token/Access URL must remain out of plaintext shared Jazz records, logs, and URLs; provider requests are user initiated; no transaction fetch absent explicit Sync now action; integer monetary values and existing date-only transaction rules; use repo Prettier; do not invent styling.

**Scale/Scope**: One local SimpleFIN connection per organization per device in the initial feature, explicit provider-to-local account mapping, transaction import with deduplication. No recurring sync or automatic first fetch. Cross-device secret sharing is not included.

**Clarification for planning**: The spec's explicit Sync now button governs transaction fetching/import. Provider account discovery is not transaction sync; its trigger must be made explicit during implementation planning and must not fetch transactions.

## Constitution Check

- **Local-first finance**: PASS. Existing transactions remain locally available; only the explicit provider operation requires network access.
- **Safe, explicit TypeScript**: PASS as a design constraint; typed provider boundary and validated normalization are required.
- **Financial integrity**: PASS. Provider values must be validated and represented in integer minor units with currency and date-only business date.
- **Organization access**: PASS for organization-scoped account mapping and transaction writes; local connection possession is device-local and separate from organization membership roles.
- **Accessible, internationalized UI**: PASS. Connection and sync controls use semantic controls and Paraglide; maintain existing wireframe direction.
- **Provider secrets and imports**: PASS with a data-model change. Keep the Access URL in device-local secret storage, not plaintext Jazz organization records. A stateless CORS relay may forward a user-initiated request only if required; it must not retain or log sensitive values. Cross-device sharing is not in scope.
- **Additive domain design**: PASS with additive schema changes; avoid generic JSON data and keep sync attempt/status and provider identity queryable.
- **Tested application code**: PASS after review gate. Add appropriate unit and Playwright tests once implementation is reviewed and approved.

## Project Structure

### Documentation (this feature)

```text
specs/002-manual-bank-sync/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── schema/                 # Additive provider status, mapping and sync metadata as needed
│   ├── validation/             # Provider payload/normalization boundary validation
│   ├── domain/                 # Pure transaction conversion/idempotency helpers when reused
│   └── components/             # Small props-only presentation components if needed
├── routes/
│   └── settings/               # Connection, mapping and manual-sync integration UI
└── lib/                        # Add device-local credential adapter and optional relay client if justified

tests/
├── unit/                       # Existing test organization to be confirmed during task planning
└── e2e/                        # Existing Playwright organization to be confirmed during task planning
```

**Project Structure**: Use the existing single SvelteKit application. Keep Jazz queries and sync workflow orchestration in the settings route, composing small presentation components. Store the Access URL through a device-local storage adapter and use it only from the client-side integration flow. If a relay is required for CORS, keep it stateless, host-allowlisted, and limited to forwarding the explicit claim/sync request. Do not place the secret in Jazz organization replicas.

## Complexity Tracking

No constitution violations are planned. Device-local credential storage and user-initiated provider requests follow the amended local-first provider-secret principle.
