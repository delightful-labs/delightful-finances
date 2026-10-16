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

Account management uses the shared sidebar and existing account list/create forms. Account transaction history is reviewed in the income/expense views using account filters.

**Acceptance Scenarios**

1. **Given** an active organization, **When** I create an account with a name, **Then** it is associated with that organization and appears in its account list.
2. **Given** an account with transactions, **When** I archive it, **Then** it is hidden from new-entry choices while its historical transactions remain available in the income/expense views.
3. **Given** an offline session, **When** I create or archive an account, **Then** the local state updates immediately and synchronizes when online.

### User Story 3 — Record and review transactions (P1)

As a user, I can create and review income and expense transactions for an account with amount, date, category, memo, and tags.

**Acceptance Scenarios**

1. **Given** an active account, **When** I save an expense or income, **Then** the transaction stores a non-negative integer amount in minor units, currency copied from the account, organization and account references, a `bookedOn` calendar date stored as an ISO 8601 `YYYY-MM-DD` string, and a category matching its kind.
2. **Given** I record income paid by check, **When** I save it, **Then** check number and a valid check date are required and stored in a related check-details record; other income methods do not require those fields.
3. **Given** a transaction with no chosen category, **When** it is saved, **Then** it receives the organization's system Uncategorized category for that transaction kind.
4. **Given** I create a transaction while offline, **When** I save it, **Then** it is visible locally without waiting for a network response and later syncs.
5. **Given** an income or expense view, **When** I review transactions, **Then** entries are grouped by calendar date newest first, with daily totals reflecting selected account filters and kept separate by currency. Each entry shows category, tags, account, amount, and its memo when present.

### User Story 6 — Maintain a login profile (P2)

As a user, I can set a display name and add, replace, or remove an avatar for my login account, so workspace members can identify me.

**Acceptance Scenarios**

1. **Given** my login account, **When** I save a name or avatar, **Then** the profile belongs to my login identity and is reused across workspaces and devices.
2. **Given** another user's profile, **When** I attempt to change it, **Then** permissions reject the change.
3. **Given** transaction attribution, **When** an author has no name or avatar, **Then** a stable identity fallback is shown.
4. **Given** authorized workspace members, **When** they review attribution, **Then** they can resolve authors to display profiles without access to private credentials or unrelated workspace data.

### User Story 4 — Organize transactions with categories and tags (P2)

As a user, I can manage categories and tags and attach multiple tags to a transaction.

**Acceptance Scenarios**

1. **Given** an expense or income form, **When** I choose a category, **Then** only categories of the matching kind are offered.
2. **Given** a tag is archived, **When** I search/select tags for a new transaction, **Then** the archived tag is omitted while remaining visible on historical transactions.
3. **Given** the transaction tag picker supports creating a tag, **When** I save a transaction with a new tag, **Then** the tag is scoped to the current organization and inherits the transaction's selected category. Selecting an existing tag does not change that tag's category. Tags created separately in tag settings may omit a category.
4. **Given** category settings, **When** I review a category, **Then** I can see counts of its connected transactions and directly associated tags within my read permissions. Counts include retained history and archived tags and do not change with sidebar account filters.

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
- **FR-002**: The application MUST provide create, list, and archive flows for USD financial accounts scoped to the active organization, using the shared sidebar and existing account list/create forms. Account history is reviewed through the income/expense views.
- **FR-003**: The application MUST provide create/list flows for income and expense transactions on an account. New income and expense forms MUST default to the first checked active account in sidebar list order. When all accounts are checked, use the first account; when none are checked, require manual selection. All active accounts remain available for manual selection. Once the form is open, changes to defaults MUST preserve its current account and category selections.
- **FR-004**: Every transaction MUST have `amountMinor >= 0`, an ISO 4217 currency, `kind`, `accountId`, `organizationId`, `bookedOn` as an ISO 8601 `YYYY-MM-DD` calendar-date string, and a category matching its kind.
- **FR-005**: Manually entered income MUST have a payment method (`cash`, `check`, `transfer`, or `electronic`); check income MUST use separate check details with a nonblank check number and a valid check date. The form MUST show those fields only when Check is selected. Imported SimpleFIN income may omit the payment method.
- **FR-006**: Each organization MUST have non-deletable system Uncategorized categories for both expense and income.
- **FR-007**: Users MUST be able to create and archive org-scoped categories and tags; tags MUST support optional category association and many-to-many transaction assignment.
- **FR-008**: Archived accounts MUST be excluded from new transaction selection while historical data remains accessible. Archived tags MUST be excluded from new selection while retained on historical transactions.
- **FR-009**: The application MUST be usable offline for previously available data and local writes, with synchronization handled by Jazz when connectivity returns.
- **FR-010**: User-visible strings MUST use Paraglide message functions; initial supported locale is English.
- **FR-011**: The UI MUST use accessible native HTML controls, SvelteKit/Svelte 5, native CSS and CSS variables. Responsive-layout audit and comprehensive keyboard/focus review are deferred until after the post-MVP design revision.
- **FR-012**: Multi-step transaction compose and tag validation/save flows MUST be modeled with XState. Delightful UI TagInput provides tag search, selection, and removal interactions; simple UI state may use Svelte runes/stores.
- **FR-013**: The application MUST expose a lightweight organization switcher shell; creating/joining another organization may be deferred.
- **FR-022**: Workspace settings MUST let owners/admins rename the active workspace without changing its identity or associated accounts. The form MUST trim the submitted name, reject blank names, use local persistence, and remain read-only for members/viewers. Jazz permissions remain the authorization boundary.

- **FR-023**: Transaction attribution MUST expose its creator, most recent editor, and corresponding timestamps using Jazz's built-in `$createdBy`, `$createdAt`, `$updatedBy`, and `$updatedAt` metadata, without redundant application-owned audit columns. Edits MUST preserve creator attribution and update latest-editor attribution. A complete edit-history UI is not required.
- **FR-024**: Users MUST be able to set a display name and add, replace, or remove an optional avatar for their login account. Profiles MUST belong to login identities, be reused across workspaces, and be editable only by their owners. Authorized workspace members MUST be able to resolve transaction authors to display profiles, with usable fallbacks for missing profile details.

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
- Transaction attachment image upload, transaction batches/templates, advanced invites, fine-grained sharing UI, and Capacitor/Tauri native wrappers.
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

- **Profile**: login-identity display profile with a display name and optional avatar, reused across workspaces. Profile avatar upload is included in MVP scope.
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

## Delightful UI Integration Trial and Future Components

The approved trial replaces applicable existing controls with Delightful UI and imports its full default light theme. This is an explicit exception to the wireframe-only presentation default. Existing responsive layouts, Paraglide labels, native form semantics, permissions, local-first persistence, integer money and date-only values remain requirements. Amount entry stays text-based; keypad workflows and new domain features are deferred. Form layout spacing uses grid/flex gap, with a small gap between fields and a larger gap before actions; sibling spacing should generally use gap rather than margin or padding.

Future reusable component proposals, based on integration call sites, are currency-entry composition, linked field help/error feedback, status feedback, semantic table presentation and navigation/layout primitives. These are candidates for later library specifications, not additional MVP requirements. See `docs/delightful-ui-integration.md` and linked code comments for evidence, current solutions and ownership boundaries.

Recovery phrase revelation uses the library's native modal Dialog with translated warning, read-only phrase and saved confirmation. Completion requires confirmation, while backdrop clicks, Close and Escape allow immediate dismissal. The dialog uses native `closedby="any"` light dismissal. Every dismissal clears the phrase and confirmation state; closed dialog content excludes the phrase.

Finance owns responsive drawer policy: at viewport widths up to and including 48rem, navigation starts closed and selecting a sidebar link or Sync now dismisses it. Above 48rem, navigation starts open and those actions preserve its open state. The toggle works at every width. Resizing alone preserves the user’s drawer state; subsequent actions use the current viewport width. Delightful UI supplies the controlled drawer and navigation primitives without device detection or link-dismissal policy.

On mobile, opening the drawer pushes the full-width main content offscreen rather than shrinking it. The drawer occupies the viewport width minus a 3.5rem strip of main content; horizontal overflow is clipped. Desktop retains the space-reserving drawer and flexible main-content width.

While mobile navigation is open, main content is inert. A transparent, accessibly named Close navigation button covers the visible main-content strip; activating it closes the drawer and returns focus to the navigation toggle. Resizing updates inertness without changing drawer disclosure. Desktop main content remains interactive.

### Sidebar settings navigation

Group Workspace (`/settings/workspace`), Banks (`/settings/banks`), and Account (`/account`) inside a Settings disclosure using the shared Details component. Both Accounts and Settings disclosures start closed. Label the account page Account, retain recovery-specific section copy, and label the sign-in navigation and submit action Login. Include decorative icons beside each sidebar menu item.

The Accounts disclosure sits immediately above Settings and contains the account management link, account filters, and Add account action. The workspace selector lives inside Settings and is labeled Current workspace. Only a link matching the current page receives `aria-current="page"`; highlight it with the green theme accent background, black text, and no underline.
