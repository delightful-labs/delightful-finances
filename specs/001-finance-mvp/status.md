# MVP requirement classification

This is an evidence-based inventory as of 2026-10-24, not a new test run or a claim that the entire current tree or deployed environment passes. “Verified complete” means implementation plus recorded passing relevant verification. Later feature records supersede older chronological task notes only for the behavior they cover. “Needs verification” includes implementation with incomplete evidence or an environment-specific readiness check. “Remaining MVP work” identifies required implementation, not deferred feature development.

## Verified complete within recorded scope

| Item | Evidence and limits |
| --- | --- |
| Hosted startup and sample finance UI/reload flows | Fresh isolated hosted Chromium checks pass for account creation, above-old-limit expense and received-Check income, including reload. Remote acceptance and cross-device persistence are not established by reload alone. |
| Replacement hosted schema and policy publication | Authenticated catalogue checks confirm the current structural hash and policy representations match local code, accounting for optional null serialization fields. Runtime behavior remains separate. |
| Sign-in, recovery-phrase connection, startup/retry and session ownership | MVP tasks T016–020/T058 and feature 008 session recovery records; recovery of identity is not an independent finance backup. |
| Initial workspace, creation/switching, URL scope, rename, starter categories | Feature 006 spec/plan/quickstart and feature 008 workspace verification; equivalent-workspace behavior supersedes older unique-personal-home language. Sharing is excluded. |
| USD account create/list/archive and retained history | MVP tasks T021–024; recorded unit/browser coverage includes offline writes and denied writes. |
| Exact USD amount entry and supported integer storage range | MVP tasks “Remove the unrequested amount ceiling”: 94 focused tests plus browser amount-boundary coverage; no deployment to an existing environment claimed. |
| Income/expense creation, editing, descriptions/memos, grouped lists/details and tags | MVP core task evidence and later transaction workspace/edit verification; imported editing has 178 focused unit/SDK tests and focused browser results. |
| Independent Checks, optional payment methods, staged-save recovery and account moves | Feature 009 tasks: 1,023 unit tests across 74 files, 25 transaction edit/workspace browser cases across focused runs, plus 84 focused coordinator/resource/authority tests. Written-check creation, exclusive assignment and existing-Check selection are deferred. |
| Categories/tags, kinds, duplicate checks, archive filters and historical associations | MVP later duplicate-name/tag-kind/archive-filter verification; required-kind alpha storage supersedes transitional untyped-tag policies. Existing-environment transition remains open. |
| Profile name/avatar persistence and basic creator/latest-editor attribution | MVP T049–051 records unit/browser verification. Later avatar display refinements have separate outstanding checks below. |
| Current role/account-grant enforcement and transaction reference integrity | MVP permission verification and feature 009 authority tests. This verifies current policies, not approved future sharing privacy/capabilities. |
| SimpleFIN explicit setup/discovery/manual sync, encrypted credential workflow, idempotent import and cleanup | Feature 002/008 records focused unit/browser verification with synthetic WebAuthn and mocked provider responses. Actual physical-device behavior is not established. |
| Core actor orchestration, shutdown, stale-report and session-replacement protocols | Feature 008 completed ownership/recovery records; this is not a guarantee about every future workflow. |
| PWA public-shell/cache boundaries, offline navigation and update notice | Feature 007 records ten browser scenarios passing across runs, build and static checks. Native installation prompt/device review remains open. |
| Localization and locale formatting, approved UI controls, transaction pagination/developer menu, desktop transaction workspace and create-to-list navigation | MVP T041 records the visible-string/formatting audit and 88 unit/four browser checks; corresponding later UI verification records cover the named workflows. Newer UI refinements and untested edge cases remain separate below. |

## Needs verification

| Item | Outstanding evidence or decision |
| --- | --- |
| Hosted remote persistence, replication and cached-client behavior | Replacement hosted schema/policies and basic hosted UI/reload flows now pass (verified below). Remote acceptance, independent-device replication and installed/cached-client updates remain unverified; no legacy migration is needed for the fresh namespace. |
| Physical-device passkeys, credential unlock and encrypted replication | Feature 002 explicitly leaves actual supported-device validation open; synthetic credentials do not prove cross-device support. |
| Combined offline/access matrix and native installation prompts | MVP T040 remains open despite focused passing offline/access/PWA cases. |
| CI and broader browser regression status | GitHub Actions success and all relevant browser suites are not established by focused runs. Historical browser failures must not be treated as resolved solely because the unit suite passed. |
| Pagination/developer-menu edge cases outside recorded coverage | Recorded focused scenarios explicitly exclude offline batches, startup-disabled controls, workspace replacement during an in-flight batch, and result-shrink races. |
| Attribution avatar rendering and object-URL cleanup | Later display refinement has an explicit outstanding focused verification item. |
| Transaction View Transitions and mobile Back to list links | Explicit focused coverage items remain open in MVP tasks; static checks alone do not verify them. |
| Older UI review/test notes and default-category regression | Reconcile remaining navigation/drawer/extraction checkboxes against later covered scenarios. The historical blank default-category regression needs explicit evidence of resolution; later broad success does not establish that exact scenario passed. |

## Remaining MVP work

### First verification finding: schema transition coverage

Read-only inspection found that the latest checked-in migration, `20261021T133945-workspace-initialization-45a86ca09b02-3407b5b1f26c.ts`, still ends with optional tag kinds, integer (`s.int()`) transaction amounts, and the retired checkDetails model without independent Checks/checkId. Current application schemas require tag kinds, bigint amounts, and independent Checks/checkId. No subsequent checked-in migration covers that gap.

This establishes a migration-record gap, not the schema currently active on any server. Disposable in-memory test success does not prove an existing environment has transitioned. Keep deployed compatibility classified as needs verification until the intended real-data environment is identified and its active schema is checked. Any required deployment/reset/data transition remains separate work requiring explicit authorization; do not start the persistent dev environment to investigate because its plugin may deploy schema automatically.

Local SDK schema hashing succeeds: current structural schema hash is `2ef8450fd994`, compared with the last checked-in migration endpoint `3407b5b1f26c`. The installed SDK provides a read-only `permissions status` command that fetches stored structural schema identity and the published permission head; its implementation does not publish schema or permissions. Use it only after identifying the intended environment. Matching structural hashes alone do not establish that the published permission bundle matches local policy or that existing records are compatible; those require separate checks. No target server has been inspected during this review.

The user identified `https://finance.delightfullabs.com/` as the real-data environment. Read-only public HTML/asset inspection found Jazz Cloud at `https://v2.sync.jazz.tools/`, app ID `87d2eaab-55f1-40a2-822f-77dea18cea00`. The served client schema in `BHxCfGmc.js` uses `amountMinor: A.int()` and the retired `checkDetails`/`checkDetailsId` relationship; the transaction detail query includes checkDetails. Thus the hosted client is behind the local bigint/independent-Check implementation. This is evidence about the served client, not the server's published schema or permission head. Admin credentials are absent from the session and project `.env`; authenticated server-side verification remains pending. No hosted session was opened, finance data read, schema published, or database modified. Local schema validation passed for 19 tables, with warnings that transactionTags and transactionAttachments have no explicit update policy (updates denied); these warnings do not by themselves establish a defect.

| Item | Required result |
| --- | --- |
| Implement verified backup/restore for released data types (FR-056) | Complete versioned export, optional encryption, validated restore into a new owned workspace, supported relationships and values preserved, truthful incomplete/resume handling, and approved recovery verification. Future attachment/split support is added when those types ship. |
| Resolve any failures exposed by the readiness checks above | Address confirmed defects in focused review cycles. This inventory does not assert that every open verification item requires production changes. |

## Deferred features and their release gates

These are not unfinished MVP implementations. USD-only handling is already supported by the inspected parser/import guards; maintain that boundary (FR-057). Currency-aware entry/import/editing/formatting/totals must be reviewed before enabling additional currencies.

Sharing requires the FR-058 policy/schema migration and direct-query authorization verification before release, including multiple accepted owners, scoped capabilities and selected-account privacy. It does not block an owned-workspace MVP merely because future sharing remains unimplemented.

Splits, linked transfers, attachments, multi-currency entry/conversion, transaction version history/restoration, workspace archive/restore, account merging, and batches/templates/recurrence remain deferred under their approved compatibility requirements or unresolved designs. Archive enforcement and offline/pending-write behavior remain undecided, not approved as online-only. Broader responsive/keyboard audit remains deliberately deferred until after the design revision. Whole-device sync-completion observability, extra credential recovery/sharing, native wrappers, written-check controls and exclusive Check assignment are also deferred.

## Hosted deployment compatibility review

Repository `netlify.toml` runs `pnpm deploy:jazz && pnpm build` for production; other contexts build only. README explicitly notes that database publication takes effect before the frontend build and remains effective if that build fails. This is repository configuration, not proof of the hosted site's current Netlify settings or deployment revision.

Current local policies deny all retired checkDetails operations and require null checkDetailsId plus a valid independent checkId for Check payments. The publicly served older frontend queries checkDetails and writes the older relationship. Therefore publishing current policies without a compatibility strategy risks breaking old-client Check reads/writes, including cached/PWA clients. No live permission outcome has been exercised here.

Before a hosted update:

1. Obtain read-only Jazz catalogue/permission-head results in an authorized admin environment for the identified hosted app; compare actual published schema and policies with served-client and local requirements. Do not put the admin secret in chat, public variables, command arguments, or committed files.
2. Establish whether hosted records include legacy Checks, untyped tags, or other incompatible data. Plan authorized inspection without logging private financial payloads. The earlier disposable-alpha policy is not permission to discard hosted data now.
3. Design a data-preserving transition and old-client policy strategy. Required tag kinds must not be guessed; Check identity/references and existing amounts must remain intact. Explicitly handle cached clients, pending offline writes, deployment failure, and recovery. SDK support for the precise transition remains to be verified.
4. Implement that focused transition and review it before tests. Verify the approved implementation against a disposable environment representing the old schema and relevant data, including old/new clients and denied/accepted writes. A clean empty database is insufficient evidence of upgrade safety.
5. Prepare the exact backend/frontend rollout and recovery procedure for approval. Frontend rollback alone cannot restore already-published permissions or undo committed data changes. Do not deploy the current branch merely to discover migration behavior.

Hosted verification remains pending: no Jazz admin secret is available in the process environment or project `.env`, and no Netlify management connector is available in this session. Read-only public asset inspection identifies configuration but cannot establish server schema, data compatibility, or deployed authorization.

Further local verification: `pnpm check` passes with zero Svelte errors/warnings and successful application/service-worker TypeScript checks. A read-only comparison using the installed SDK's `loadCompiledSchema` and `schemaTransitionRequiresRowTransform` confirms that the latest local snapshot to current schema requires a row transformation. Structural differences are exactly: tags.kind nullable → required; transactions.amountMinor Integer → BigInt; added transactions.checkId; added checks table. This comparison uses the checked-in snapshot, not an authenticated hosted schema export, and does not validate a migration or existing data. No migration was generated or applied, and no tests were run.

### Authenticated hosted catalogue result

After the user supplied an admin credential through a private temporary file, authenticated read-only SDK requests succeeded for the identified Jazz Cloud app. Four structural schemas are stored. The published permission head is version 4 and targets full schema hash `3407b5b1f26cf61abe225666049a00226fbf2e1ad4e0b0205fb25e8d60acdc84`. Current local hash `2ef8450fd994dcce2cae6cfd6128c6b5b829727e1ccbebd2c3333f5dbaca6ad5` is not among those stored schemas. The head's structural schema differs from local exactly in tags.kind nullability, Integer versus BigInt amountMinor, added transactions.checkId, and the added checks table. The published permission bundle includes retired checkDetails and has no independent checks table policy.

This confirms the hosted schema gap; it is no longer merely an inference from public assets or local migration records. It does not establish whether hosted finance records contain legacy/incompatible values or whether a proposed migration preserves them. No finance rows were queried, no application identity was created, no schema or permissions were published, and no data was modified. The credential was not printed or committed. Earlier notes about unavailable credentials describe the prior checkpoint and are superseded for this catalogue inspection only.

## Hosted alpha fresh-start proposal (not executed)

The user explicitly stated that existing hosted data need not be preserved. This supersedes the data-preservation assumption for this hosted alpha transition only; it is not permission to reset the user's persistent local environment or a general future migration policy.

Inspection of the installed SDK CLI and schema-publication APIs found no supported hosted whole-app reset command. Browser `deleteClientStorage()` concerns a local replica, not a hosted database reset. Do not infer that deleting application rows also removes schema history or account registrations, or invent an undocumented destructive endpoint.

Proposed route for review: provision a new Jazz Cloud app namespace, claim it in the user's Jazz dashboard, publish the current schema and permissions to that empty app, and point the hosted frontend at its new app ID. Official server-setup documentation describes app IDs as data/sync namespaces and requires claiming generated apps (unclaimed apps expire after 14 days). This avoids transforming existing alpha records; it does not delete the old app or promise to preserve login identities.

Sequence after approval:

1. Create and claim the replacement Jazz Cloud app; keep its admin secret private. Keep the old app unchanged during preparation.
2. Publish the current schema and permission bundle to the empty replacement app and confirm their identity through read-only catalogue checks. Do not reuse the old migration chain as proof of a fresh app's readiness.
3. Prepare a separate frontend preview using the replacement app's public ID/server URL. Account registration and recovery-phrase continuity across app IDs must be verified; plan for a fresh app-local login/workspace and bank reconnection rather than promise old-session reuse. Do not clear the user's browser storage.
4. After review, verify the approved preview and check configuration, initialization, Check saving, above-old-limit amounts and reload behavior against the replacement app. Keep checks isolated from the user's persistent local environment.
5. Prepare the exact Netlify production settings change (new public app ID, same Jazz Cloud URL, new private admin credential) and frontend deploy revision for final approval. Netlify's production command publishes schema before building, so confirm the configured target is the replacement app.
6. Verify published assets identify the replacement app and explain that older cached/offline clients may continue targeting the old app until updated. Switching namespaces isolates their writes; it does not instantly update every installed client. Old app deletion is separate optional work, not part of this proposal.

No new app has been provisioned, old app reset/deleted, frontend deployed, credential changed, or user browser storage cleared. The outstanding user decision is whether a new hosted app namespace and fresh application login/workspace are acceptable; not preserving finance records alone does not decide identity continuity.

Source: [Jazz server setup](https://jazz.tools/docs/getting-started/server-setup).

## User-performed hosted fresh start

The user reported creating a new Jazz Cloud app, updating Netlify variables, and rebuilding. Subsequent read-only public asset inspection confirms `finance.delightfullabs.com` now targets app ID `302f9f87-1a3d-4c6e-a96a-7b2c1b70a641` at the same Jazz Cloud URL. The served client now contains bigint transaction amounts and independent checks/checkId schema and persistence code. This supersedes the older-client findings for the currently served assets; cached older clients are not covered by this inspection.

A read-only permission-head request for the new app using the existing private credential file returned HTTP 401. The new app's backend schema and permission identity therefore remain unverified; the prior app's successful admin check does not apply to the replacement app. The credential file needs the new app's private admin secret before continuing authenticated checks. No finance records were accessed or modified and no deployment was performed by the agent.

## Replacement backend verification completed

After the user updated the private credential, authenticated read-only checks for app `302f9f87-1a3d-4c6e-a96a-7b2c1b70a641` succeeded. Its catalogue contains one structural schema. Published permission head version 1 targets `2ef8450fd994dcce2cae6cfd6128c6b5b829727e1ccbebd2c3333f5dbaca6ad5`, exactly the local schema hash. The SDK's `wasmSchemasEqual` confirms structural equality, and `schemaTransitionRequiresRowTransform` returns false between hosted and local structures.

All 19 permission tables are present. Applying the installed SDK's permission normalizer to both bundles and accounting for omitted versus explicit-null optional `max_depth` and `scope` fields yields equal policy representations. Raw JSON comparison alone differs because of serialization defaults and is not a policy mismatch. These are catalogue/configuration checks, not live authorization or finance workflow tests.

The replacement app's schema/policy publication item is now verified complete within that scope; the old namespace's migration work is unnecessary for the chosen fresh-start release. Runtime initialization, real device credentials, browser/PWA update behavior, and future backup/restore remain separate items. No finance rows were accessed, no identity created, and no schema, permission, deployment, or browser storage changes were performed by the agent.

## Hosted runtime smoke verification

Following user authorization to continue, a fresh isolated Chromium session exercised the rebuilt hosted app through its UI. No local development server or existing user browser profile was used. Passing checks: initialization on a direct new-expense URL; account creation and selection; saving a labeled expense of USD 21,474,836.48 (2,147,483,648 minor units, above the old signed-32-bit limit); reopening and reloading its editable details with the exact amount; saving received-Check income of USD 12.34 with number `AGENT-SAMPLE-001` and date `2026-10-24`; reopening and reloading with the same amount, check number and date.

These are hosted UI/local-replica persistence checks, not proof of remote write acceptance or independent-device replication. No provider connection, physical passkey, offline matrix, or cached-old-client update was tested. The sample account is labeled `AGENT VERIFICATION — disposable sample`; its two transactions are explicitly labeled agent verification. They remain in the isolated identity's workspace `d4829de2-bd9e-532a-89d1-0e1237b4cda9`. A separate initial startup-only browser session also initialized an identity but created no sample account/transaction. No cleanup/delete capability was assumed and no user's existing records were queried or changed. Browser execution used no screenshots, traces, videos, or printed recovery phrases. The temporary isolated browser profile is retained outside the repository for possible focused follow-up.

## Evidence sources

- [MVP chronological tasks and verification](tasks.md), especially the final spec/code reconciliation status. Old check-detail and plaintext/admin credential descriptions are superseded.
- [Workspace validation scope](../006-multiple-workspaces/quickstart.md) and [workspace plan](../006-multiple-workspaces/plan.md).
- [Bank-sync verification and open device checks](../002-manual-bank-sync/tasks.md).
- [PWA update verification](../007-pwa-update-notice/tasks.md).
- [Orchestration completion records](../008-actor-orchestration/tasks.md).
- [Independent-Check verification and deployment limits](../009-independent-checks/tasks.md).
