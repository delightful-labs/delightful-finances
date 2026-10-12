# Delightful Finance Constitution

## Core Principles

### I. Local-First Finance

Jazz is the durable application data and authorization layer. Reads and writes must remain useful offline; local writes are optimistic and synchronize when connectivity returns. Do not make ordinary finance workflows depend on a network round trip.

### II. Safe, Explicit TypeScript

Use strict TypeScript. Do not use `any` or TypeScript `as` casts. Do not write `switch` statements or `case` clauses; prefer discriminated-union narrowing, lookup records, or clear conditional expressions. Prefer `unknown` with narrowing, generics, `satisfies`, and typed adapters for under-typed third-party APIs. Model domain variants with discriminated unions and required variant-specific fields instead of loosely related optional fields.

### III. Financial Integrity

Represent money as integer `amountMinor` plus an ISO 4217 `currency`; never use floating-point amounts. MVP entry is USD, but persisted records retain currency. Transactions reference financial accounts by `accountId`, carry `organizationId`, and use a non-negative amount with an explicit kind. Keep user-assigned `bookedOn` distinct from Jazz audit timestamps.

### IV. Organization-Based Access

An organization is the tenancy boundary; a financial account is a ledger, not an identity or tenant. Scope business data to organizations and enforce access through Jazz permissions. Org owners/admins can access all org accounts. For members/viewers, `accountAccessMode` is authoritative: `all` grants access to all org accounts, while `selected` grants access only to explicitly granted accounts; no grants in `selected` mode means no account access. Members can write accounts they can access according to their grants; viewers are read-only. Account grants do not grant access without active organization membership. SimpleFIN credentials are readable only by org owners/admins.

### V. Accessible, Internationalized UI

Use SvelteKit with Svelte 5, semantic HTML controls, and Paraglide JS for every user-visible string from the beginning. Keep the interface unstyled and wireframe-like unless the user approves a visual direction; do not invent colors, decoration, or custom visual treatments. Prefer native semantic HTML controls over bespoke controls. Components must stay small and reusable. Do not use Tailwind. Use XState for multi-step workflows; use Svelte runes/stores for simple UI state. Preserve accessible interaction semantics.

### VI. Provider Secrets and Imports

SimpleFIN is optional, bring-your-own-key, and organization-scoped. Never persist setup tokens. Treat the claimed Access URL as a secret. Claiming and fetching happen in a server-side sync worker, not browser replicas. Imported transactions carry provider provenance and an external identifier for idempotency.

### VII. Additive, Queryable Domain Design

Keep provider/check-specific data in dedicated related tables when it needs to be queried; avoid sparse columns and generic JSON blobs. Evolve Jazz schemas through additive fluid migrations where practical. Keep the schema and permissions ready for grants, attachments, batches, and SimpleFIN before their full UI ships.

### VIII. Tested Application Code

Every application feature and production code path must have appropriate automated unit tests and end-to-end coverage in Playwright. Unit tests cover domain logic, validation, state machines, permission helpers/adapters, and edge cases; Playwright tests cover user-visible workflows, authorization outcomes, and offline behavior where feasible. Add or update tests in the same change as the code. A feature is not complete until its tests pass.

## Technology Constraints

- App: SvelteKit 3, Svelte 5, TypeScript, Jazz (`jazz-tools` v2).
- UI: semantic HTML controls, native Svelte CSS, CSS variables; no Tailwind.
- Complex UI flow: XState with `@xstate/svelte`.
- Localization: Paraglide JS; English is the initial locale, and no visible strings are hardcoded in components.
- Installable shell: native SvelteKit service worker and a web app manifest. Cache public page shells and assets only; keep Jazz data/auth/sync out of runtime caching. Workbox is deferred.
- Native wrappers are deferred.
- GitHub organization/URL namespace: `https://github.com/delightful-labs/`.

## Development Workflow and Quality

- Spec Kit artifacts in `.specify/` and `specs/` are the project source of truth; the inherited plan file is a migration reference/scratchpad.
- Before implementation, keep requirements, technical plan, and task checklist aligned. Resolve consequential ambiguity in the spec before building dependent features.
- Every application feature and production code path needs appropriate unit and Playwright end-to-end coverage. Do not run tests until the user has reviewed and approved the exact implementation being tested.
- Use Prettier for formatting. Keep formatting configuration in the repository and do not reformat unrelated files.
- Work incrementally: implement one task at a time. Add or change at most one route or component in a review cycle, then stop and wait for the user's review before continuing.
- Do not add timestamps such as `createdOn`/`updatedOn` where Jazz system audit fields already provide them.

## Governance

This constitution governs implementation and supersedes conflicting project conventions. Amend it when a deliberate architectural decision changes, and update dependent specs/plans in the same change. Each feature plan must state how it complies with the principles above.

**Version**: 1.4.0 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-12
