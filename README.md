# Delightful Finance

Delightful Finance is a local-first personal finance app using Jazz, Svelte 5, and SvelteKit 3.

## Development

Use Node 22.17 or newer and pnpm. Start the shared development server with `pnpm dev`; its URL is printed by Vite. `pnpm check` checks application and service-worker types without starting another Jazz server. `pnpm build` produces the production app and native service worker.

`pnpm dev` keeps the app at `http://localhost:5173` and Jazz on port 5174, with Jazz's persistent project storage. An occupied port causes startup to fail. Always use the same browser profile and hostname (`localhost` and `127.0.0.1` have separate browser storage).

Agents should use `pnpm dev:agent` at `http://localhost:5180`. This uses the existing isolated configuration with an in-memory Jazz server on an automatically assigned port; its data is disposable across restarts. Concurrent agents can choose separate page ports with `pnpm dev:agent --port 5181`. Keep the user's persistent server and storage untouched. The default and authentication Playwright configurations also start isolated servers rather than reusing the user's server.

Set `PUBLIC_JAZZ_APP_ID` and `PUBLIC_JAZZ_SERVER_URL` for the production deployment before building. These public settings are declared in `src/env.ts` and included in the build. The Jazz development plugin supplies them for the local development server.

## Netlify deployment

Create and claim a hosted app in the Jazz dashboard first. In Netlify's environment variables, set `PUBLIC_JAZZ_APP_ID` to that hosted app's ID, `PUBLIC_JAZZ_SERVER_URL` to `https://v2.sync.jazz.tools/`, and `JAZZ_ADMIN_SECRET` to its admin secret. Make these values available during builds; keep the admin secret private and restrict it to the production deploy context. Never give it a `PUBLIC_` prefix or commit it.

`netlify.toml` runs `pnpm deploy:jazz && pnpm build` for production deployments. The Jazz command uses the installed SDK version and deploys `src/lib/schema.ts`, `src/lib/permissions.ts`, and migrations from `src/lib/migrations`. A failed database deployment stops the frontend build. A successful database deployment takes effect immediately, even if the subsequent frontend build fails, so schema and permission changes must remain compatible with the currently published app.

Other Netlify contexts run only `pnpm build` and do not deploy database changes. Configure separate Jazz app settings for previews when they need database access. Local `pnpm build` also remains a frontend-only build.

## Debug logging

`PUBLIC_DEBUG` is the sole gate for application logging and the developer menu. Vite defaults it to `true` when serving in development mode and `false` otherwise, while preserving explicit shell or mode-specific `.env` values. Set `PUBLIC_DEBUG=false` in `.env.local` to disable debugging locally, then restart the development server. To enable debugging in a deployed lower environment, set `PUBLIC_DEBUG=true` in that Netlify context with build scope, then rebuild.

The same setting enables the existing developer menu, including its sample transaction controls. The menu trigger retains its existing keyboard-focus behavior and appearance. Sample creation still requires the current workspace's write permissions.

Use `createLogger(scope)` from `src/lib/logger.ts` for application `info`, `warn`, and `error` messages. Select only non-sensitive scalar fields; never log credentials, finance records, provider payloads, or raw errors/messages/stacks. Existing bank diagnostics retain their error classification and timing heartbeats. SDK-internal logs are controlled separately.

Jazz's embedded inspector requires its development server integration; `PUBLIC_DEBUG` does not enable it in a deployed build. Use the [standalone Jazz Inspector](https://v2.inspector.jazz.tools/) for a hosted lower-environment app, entering its server URL, app ID, and admin secret directly into that tool. Never expose the admin secret through a `PUBLIC_` variable.

With `PUBLIC_DEBUG=true`, [Stately Inspector](https://stately.ai/docs/inspector) opens in a separate browser tab; allow popups for the app origin if necessary. It observes the application/startup/workspace/bank tree, shared forms, and transaction editing. Inspection includes state values, event types and actor relationships, with context, event payloads, results and raw errors removed before transmission to the external inspector. Other independent roots are not yet attached.

## Native PWA

SvelteKit bundles and registers `src/service-worker/index.ts` in production. `static/manifest.webmanifest` supplies the installation metadata and existing app icon. No PWA plugin or Workbox dependency is used.

The root layout prerenders generic HTML shells for the current routes. The worker precaches those shells, build files, and static assets, so reloads and direct navigation can use the cached app after a successful online installation. Financial data is loaded only in the browser by Jazz; data, authentication, and synchronization requests are not runtime-cached by the worker.

Updates wait until the user chooses “Update and reload” in the drawer above online status, or until the existing app tabs close. “Later” dismisses the same update for that page session. Accepting activates the update and reloads the requesting tab; other tabs offer a reload action without automatically reloading. Unsaved-edit checking is deferred, so accepting can discard unsubmitted form values. Activation failures offer retry after a bounded wait. Validate installation and offline behavior against a production build served over HTTPS or localhost; the development server does not install the production worker.

After implementation review, run `pnpm test:pwa` against a production build with valid public database settings. The dedicated Playwright configuration starts and stops a production preview on `http://127.0.0.1:4173`. It covers an unvisited expense page and reload offline with a persisted account, public cache boundaries, and a worker update waiting without reloading an unsaved form. Its update fixture temporarily changes the generated worker file and restores it afterward; do not run it against a shared deployment or concurrently with a build.

For local verification, keep the development database running and build with `FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=<local-database-url> pnpm build`. Use the database URL supplied by the development plugin, which differs from the Vite page URL. Production deployments require their own database settings. Native installation prompts and multi-tab update activation still need browser-specific review.

Workspace authorization checks run with `pnpm test:permissions` against the same development server. They use isolated identities, server-filtered reads, globally settled writes, and owner-side checks for unauthorized changes. Nine role/grant cases pass: unrelated users, admins, members/viewers with all access, selected access without grants, read/write grants, and grants without membership. The category-move regression exposed missing destination workspace authorization. The category update guard now requires owner/admin/member access in both the original and destination workspaces and rejects updates to system categories. After implementation review, all ten permission checks passed, including the previously failing category-move regression. `pnpm check:tests` checks the TypeScript in the browser test files.

Workspace, account-list, and transaction-list checks run with `pnpm test:workspace`. Five workspace tests cover sidebar navigation preserving the workspace and database session, owner/admin renaming, trimmed names and validation retries, reload persistence, member/viewer read-only controls and server-denied writes, and switching workspaces. Two additional account-list tests cover empty results, creation and reload persistence, sorting, archived-account exclusion, live archive updates, and workspace switching. Run just these with `pnpm test:workspace --grep "account list"`. Two transaction-list tests cover empty income/expense views, date ordering, account filters, workspace switching, live inserts, and reload persistence. Run these with `pnpm test:workspace --grep "transaction list"`. Three transaction-form tests cover no-account handling, expense/check-income saves, workspace-specific options, archived and wrong-kind filtering, check details, and adding another transaction. Run these with `pnpm test:workspace --grep "transaction form"`. Account-form validation/workspace-reset tests run with `pnpm test:workspace --grep "account form"`. Open `/settings/workspace` through the sidebar’s Workspace link.

## Project documents

Account restoration checks run with `pnpm test:auth`. The dedicated suite uses two isolated browser profiles and starts its own disposable development server at `http://127.0.0.1:5180`. It checks recovered accounts, workspace reuse, repeated restoration, reloads, and starter category counts. Trace, screenshot, and video capture are disabled for this recovery-phrase workflow. Workspace initialization reads existing records before opening its write transaction and waits for local persistence. This prevents cold reloads from recreating protected records and leaving rejected writes that block account restoration. Eight consecutive restoration runs passed after the fix; the final three also checked starter category counts. The account creation/expense entry regression passed as well.

- [Constitution](.specify/memory/constitution.md): architecture and implementation rules.
- [MVP specification](specs/001-finance-mvp/spec.md): product requirements and acceptance criteria.
- [Implementation plan](specs/001-finance-mvp/plan.md): technical design and phases.
- [Task checklist](specs/001-finance-mvp/tasks.md): implementation backlog.
- [Original planning notes](finance_jazz_svelte_1ec5536a.plan.md): source material for the formalized artifacts.
- [Manual bank-sync specification](specs/002-manual-bank-sync/spec.md): manual SimpleFIN imports and passkey-protected credentials across the connecting user's devices.
- [Bank-sync requirements checklist](specs/002-manual-bank-sync/checklists/requirements.md): specification quality review.

The bank-sync specification reflects the approved passkey direction. Its [implementation plan](specs/002-manual-bank-sync/plan.md), research, data model, behavior contract, and quickstart still describe the earlier device-local credential design and must be aligned before bank-sync implementation. The plan contains an explicit warning; these documents are not implementation-ready.

## Spec Kit

This project uses GitHub [Spec Kit](https://github.com/github/spec-kit) with the Codex integration. Spec Kit skills are in `.agents/skills/`, and shared workflows and templates are in `.specify/`. Start with the spec artifacts above; use `$speckit-clarify` before implementation if unresolved product decisions need discussion.

## Planned GitHub namespace

`https://github.com/delightful-labs/`

## Planned bank credential protection

The approved bank-sync design encrypts the SimpleFIN Access URL locally using a PRF-capable passkey and replicates only ciphertext and non-secret unlock metadata through Jazz. The password manager, such as 1Password, separately syncs the passkey. The same signed-in user can unlock the connection on compatible devices with that original passkey; organization membership alone does not grant decryption access.

Before consuming a SimpleFIN setup token, the app will verify encryption and subsequent decryption with a harmless sample. Each manual sync will require passkey verification, use the credential transiently, then lock again. Setup tokens, plaintext credentials, and usable decryption keys will not be persisted or replicated. There will be no automatic transaction fetching or retries. Lost-passkey recovery initially means reconnecting SimpleFIN; invalidating a previously copied Access URL requires provider-side revocation.

This is planned behavior, not an implemented bank integration. Sharing credentials with other organization members and additional recovery mechanisms are out of scope. An initial passkey prototype demonstrated successful sample recovery in the reported browser trial and has been removed. Physical-device passkey synchronization and production Jazz credential replication remain unverified.
