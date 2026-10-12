# Feature Specification: Delightful Finance MVP

**Feature Branch**: `001-finance-mvp`
**Created**: 2026-10-11
**Status**: Draft
**Input**: Migrate the finance tracking app plan into an implementable MVP specification.

## Summary

Delightful Finance is a local-first personal finance tracker. A signed-in user can keep a personal organization, manage cash/bank/card accounts, record income and expenses, and organize transactions with categories and tags. The data model and permissions must support future business organizations, account-scoped sharing, SimpleFIN imports, attachments, and batch entry without requiring a tenancy redesign.

## User Scenarios & Testing

### User Story 1 — Start a personal finance workspace (P1)

As a user, I can sign in and land in a personal organization that is created automatically on first login, so I can begin tracking finances without setup friction.

**Acceptance Scenarios**

1. **Given** an authenticated user with no personal organization, **When** the app initializes their workspace, **Then** it creates one personal organization, an owner membership, and the required default categories.
2. **Given** an existing user, **When** they sign in again, **Then** the existing personal organization and its data are reused rather than duplicated.
3. **Given** a user without access to an organization, **When** they request its data, **Then** Jazz permissions prevent that data from being read or modified.

### User Story 2 — Manage financial accounts (P1)

As a user, I can create, list, and archive USD cash, bank, or card accounts within my organization.

**Acceptance Scenarios**

1. **Given** an active organization, **When** I create an account with a name, **Then** it is associated with that organization and appears in its account list.
2. **Given** an account with transactions, **When** I archive it, **Then** it is hidden from new-entry choices while its historical transactions remain available.
3. **Given** an offline session, **When** I create or archive an account, **Then** the local state updates immediately and synchronizes when online.

### User Story 3 — Record and review transactions (P1)

As a user, I can create and review income and expense transactions for an account with amount, date, category, memo, and tags.

**Acceptance Scenarios**

1. **Given** an active account, **When** I save an expense or income, **Then** the transaction stores a non-negative integer amount in minor units, currency copied from the account, organization and account references, a `bookedOn` calendar date stored as an ISO 8601 `YYYY-MM-DD` string, and a category matching its kind.
2. **Given** I record income paid by check, **When** I save it, **Then** check-specific details are required and stored in a related check-details record; other income methods do not require those fields.
3. **Given** a transaction with no chosen category, **When** it is saved, **Then** it receives the organization's system Uncategorized category for that transaction kind.
4. **Given** I create a transaction while offline, **When** I save it, **Then** it is visible locally without waiting for a network response and later syncs.

### User Story 4 — Organize transactions with categories and tags (P2)

As a user, I can manage categories and tags and attach multiple tags to a transaction.

**Acceptance Scenarios**

1. **Given** an expense or income form, **When** I choose a category, **Then** only categories of the matching kind are offered.
2. **Given** a tag is archived, **When** I search/select tags for a new transaction, **Then** the archived tag is omitted while remaining visible on historical transactions.
3. **Given** the tag picker supports creating a tag, **When** I create and select one, **Then** the tag is scoped to the current organization and can optionally be assigned a category.

### User Story 5 — Prepare for shared workspaces and imports (P3)

As the product evolves, organizations can support multiple roles, selective account access, and an optional organization-owned SimpleFIN connection without exposing provider credentials to ordinary members.

**Acceptance Scenarios**

1. **Given** an org owner/admin, **When** they access org accounts, **Then** they can access all accounts in that org.
2. **Given** a member/viewer in `all` account access mode, **When** they access the org, **Then** they can access all org accounts and related data.
3. **Given** a member/viewer in `selected` account access mode with no account grants, **When** they access the org, **Then** they have no account access.
4. **Given** a member/viewer in `selected` account access mode with account grants, **When** they access the org, **Then** they can access only granted accounts and related data; members may write only grants with write access, and viewers remain read-only.
5. **Given** a SimpleFIN connection, **When** an owner/admin reads connection settings, **Then** they can read its status; members/viewers cannot read its Access URL.
6. **Given** a setup token is submitted, **When** a future server-side worker claims it, **Then** the setup token is not persisted and the resulting credential is protected as an Access URL.

## Product Requirements

### MVP

- **FR-001**: The application MUST provide Jazz-backed sign-in and automatically create/reuse a personal organization for each first-time user.
- **FR-002**: The application MUST provide create, list, and archive flows for USD financial accounts scoped to the active organization.
- **FR-003**: The application MUST provide create/list flows for income and expense transactions on an account.
- **FR-004**: Every transaction MUST have `amountMinor >= 0`, an ISO 4217 currency, `kind`, `accountId`, `organizationId`, `bookedOn` as an ISO 8601 `YYYY-MM-DD` calendar-date string, and a category matching its kind.
- **FR-005**: Manually entered income MUST have a payment method (`cash`, `check`, `transfer`, or `electronic`); check income MUST use separate check details. Imported SimpleFIN income may omit the payment method.
- **FR-006**: Each organization MUST have non-deletable system Uncategorized categories for both expense and income.
- **FR-007**: Users MUST be able to create and archive org-scoped categories and tags; tags MUST support optional category association and many-to-many transaction assignment.
- **FR-008**: Archived accounts MUST be excluded from new transaction selection while historical data remains accessible. Archived tags MUST be excluded from new selection while retained on historical transactions.
- **FR-009**: The application MUST be usable offline for previously available data and local writes, with synchronization handled by Jazz when connectivity returns.
- **FR-010**: User-visible strings MUST use Paraglide message functions; initial supported locale is English.
- **FR-011**: The UI MUST use accessible native HTML controls, SvelteKit/Svelte 5, native CSS and CSS variables, and responsive layouts.
- **FR-012**: Multi-step transaction compose and tag selection flows MUST be modeled with XState; simple UI state may use Svelte runes/stores.
- **FR-013**: The application MUST expose a lightweight organization switcher shell and sync/pending status affordance; creating/joining another organization may be deferred.
- **FR-022**: Workspace settings MUST let owners/admins rename the active workspace without changing its identity or associated accounts. The form MUST trim the submitted name, reject blank names, use local persistence, and remain read-only for members/viewers. Jazz permissions remain the authorization boundary.

### Schema and authorization readiness

- **FR-014**: The schema MUST include profiles, organizations, organizationMembers, accounts, categories, tags, transactions, transactionTags, checkDetails, and accountMemberships.
- **FR-015**: Authorization MUST implement the organization roles and explicit `accountAccessMode` rules in the constitution, including inherited access to associated transaction/tag data. Account grants MUST NOT grant access without active organization membership; viewer access MUST remain read-only.
- **FR-016**: The schema MUST include SimpleFIN connection/account-link records, transaction source and optional externalId, and organization-scoped admin-only credential access.
- **FR-017**: The schema MUST reserve attachment and batch records/relationships for later use; full attachment/batch UI is out of scope.
- **FR-018**: Jazz audit fields MUST be used rather than adding redundant createdOn/updatedOn columns. `bookedOn` is the user-assigned business date stored as a date-only string, separate from timestamps.
- **FR-019**: Every application feature and production code path MUST include appropriate automated unit tests and Playwright end-to-end tests. Tests MUST be added or updated with the feature implementation.
- **FR-020**: Unit tests MUST cover domain logic, money/date handling, validation, state machines, permission helpers/adapters, and relevant edge cases. Playwright MUST cover each primary user workflow, authorization behavior, and offline workflows where supported by the runtime.
- **FR-021**: A feature MUST NOT be considered complete until its relevant automated tests pass. New code requires coverage at the level appropriate to its behavior; tests need not be written to test test code or generated/vendor assets.

### Out of scope for MVP

- SimpleFIN periodic import/sync worker, account linking, and transaction import UI. A minimal connection setup stub may be implemented if feasible, but connection claiming is server-side only.
- Foreign exchange conversion or non-USD entry UI.
- Image upload, transaction batches/templates, advanced invites, fine-grained sharing UI, and Capacitor/Tauri native wrappers.
- Transfers as a transaction kind; the model may add a third kind or linked pair later.

## Data Model Invariants

- Financial accounts are distinct from login identity and organization tenancy.
- `amountMinor` is a non-negative integer; the sign is represented by `kind`.
- Currency is copied from the account at creation and stored on the transaction.
- `categoryId`, `accountId`, and `organizationId` are required references on every transaction.
- Check details live in a one-to-one related table; do not put check-only sparse fields on every transaction.
- `source` is a discriminated union in application types: manual, or SimpleFIN with `externalId`.
- Jazz owns synchronized durable data and system audit timestamps.

## Key Entities

- **Profile**: Jazz user display profile.
- **Organization**: personal or business workspace with a default currency.
- **Organization Member**: organization/user association with owner, admin, member, or viewer role.
- **Account**: USD cash/bank/card ledger belonging to an organization; archivable.
- **Account Membership**: explicit read/write grant to an account for an org member in `selected` access mode.
- **Category**: org-scoped expense/income classification; system Uncategorized entries cannot be deleted.
- **Tag**: org-scoped label with optional category; can be archived.
- **Transaction**: account-linked income or expense, with amount, currency, date, category, source, optional memo/provider id/batch, and tags.
- **Check Details**: one-to-one transaction record for check income.
- **SimpleFIN Connection / Account Link**: org-scoped connection credential/status and mapping to local accounts.
- **Transaction Attachment / Batch**: schema-ready relationships for later features.

## Non-Functional Requirements

- **NFR-001**: Read/write flows for already available data MUST not require connectivity.
- **NFR-002**: Unauthorized organization/account data and SimpleFIN secrets MUST be unavailable through Jazz permissions.
- **NFR-003**: Money handling MUST avoid floating-point arithmetic and preserve the stored currency code.
- **NFR-004**: Main flows MUST work on mobile-size screens and with keyboard/screen-reader accessible controls.
- **NFR-005**: Native SvelteKit service-worker caching MUST cover public page shells and build assets and coexist with Jazz's persistence and synchronization. Jazz data/auth/sync requests MUST NOT be added to the service-worker runtime cache.
- **NFR-006**: The automated test suite MUST include unit tests and browser-level Playwright tests and run reliably in local development and CI.

## Assumptions and Dependencies

- Jazz Cloud is the initial hosted sync/auth option; self-hosting can be considered later.
- Personal org defaults to USD and English. The schema stores currency codes for future multi-currency use.
- The starting repository is initialized for Spec Kit and Codex; application scaffolding is the next implementation phase.
- Planned GitHub namespace is `https://github.com/delightful-labs/`.

## Success Criteria

- **SC-001**: A new user can sign in and reach a reusable personal workspace without manually creating an organization.
- **SC-002**: A user can create an account and enter/list income and expense transactions with categories and tags.
- **SC-003**: Every saved transaction satisfies the data invariants above and is tied to exactly one account and organization.
- **SC-004**: Previously available data and local account/transaction writes remain usable without network access.
- **SC-005**: Permission rules prevent cross-organization access and protect SimpleFIN credentials from member/viewer roles.
- **SC-006**: Every visible label, hint, and error in shipped UI is sourced from Paraglide messages.
- **SC-007**: Every shipped application module has appropriate unit coverage, and each primary user workflow has a passing Playwright end-to-end test.
