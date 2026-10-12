# Delightful Finance

Delightful Finance is a local-first personal finance app using Jazz, Svelte 5, and SvelteKit 3.

## Development

Use Node 22.17 or newer and pnpm. Start the shared development server with `pnpm dev`; its URL is printed by Vite. `pnpm check` checks application and service-worker types without starting another Jazz server. `pnpm build` produces the production app and native service worker.

Set `PUBLIC_JAZZ_APP_ID` and `PUBLIC_JAZZ_SERVER_URL` for the production deployment before building. These public settings are declared in `src/env.ts` and included in the build. The Jazz development plugin supplies them for the local development server.

## Native PWA

SvelteKit bundles and registers `src/service-worker/index.ts` in production. `static/manifest.webmanifest` supplies the installation metadata and existing app icon. No PWA plugin or Workbox dependency is used.

The root layout prerenders generic HTML shells for the current routes. The worker precaches those shells, build files, and static assets, so reloads and direct navigation can use the cached app after a successful online installation. Financial data is loaded only in the browser by Jazz; data, authentication, and synchronization requests are not runtime-cached by the worker.

Updates use the browser's normal waiting lifecycle and do not force-reload an active form. The new worker becomes active after the existing app tabs close. Validate installation and offline behavior against a production build served over HTTPS or localhost; the development server does not install the production worker.

After implementation review, run `pnpm test:pwa` against a production build with valid public database settings. The dedicated Playwright configuration starts and stops a production preview on `http://127.0.0.1:4173`. It covers an unvisited expense page and reload offline with a persisted account, public cache boundaries, and a worker update waiting without reloading an unsaved form. Its update fixture temporarily changes the generated worker file and restores it afterward; do not run it against a shared deployment or concurrently with a build.

For local verification, keep the development database running and build with `FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=<local-database-url> pnpm build`. Use the database URL supplied by the development plugin, which differs from the Vite page URL. Production deployments require their own database settings. Native installation prompts and multi-tab update activation still need browser-specific review.

Workspace authorization checks run with `pnpm test:permissions` against the same development server. They use isolated identities, server-filtered reads, globally settled writes, and owner-side checks for unauthorized changes. Nine role/grant cases pass: unrelated users, admins, members/viewers with all access, selected access without grants, read/write grants, and grants without membership. A separate category-move test currently fails: the server permits moving a non-system category into an unrelated workspace because its new-value permission does not check destination workspace access. Fix that guard before treating workspace isolation as complete. `pnpm check:tests` checks the TypeScript in the browser test files.

## Project documents

Account restoration checks run with `pnpm test:auth`. The dedicated suite uses two isolated browser profiles and reuses the development server at `http://127.0.0.1:5173`, or starts one there if needed. It checks recovered accounts, workspace reuse, repeated restoration, reloads, and starter category counts. Trace, screenshot, and video capture are disabled for this recovery-phrase workflow. Workspace initialization reads existing records before opening its write transaction and waits for local persistence. This prevents cold reloads from recreating protected records and leaving rejected writes that block account restoration. Eight consecutive restoration runs passed after the fix; the final three also checked starter category counts. The account creation/expense entry regression passed as well.

- [Constitution](.specify/memory/constitution.md): architecture and implementation rules.
- [MVP specification](specs/001-finance-mvp/spec.md): product requirements and acceptance criteria.
- [Implementation plan](specs/001-finance-mvp/plan.md): technical design and phases.
- [Task checklist](specs/001-finance-mvp/tasks.md): implementation backlog.
- [Original planning notes](finance_jazz_svelte_1ec5536a.plan.md): source material for the formalized artifacts.

## Spec Kit

This project uses GitHub [Spec Kit](https://github.com/github/spec-kit) with the Codex integration. Spec Kit skills are in `.agents/skills/`, and shared workflows and templates are in `.specify/`. Start with the spec artifacts above; use `$speckit-clarify` before implementation if unresolved product decisions need discussion.

## Planned GitHub namespace

`https://github.com/delightful-labs/`
