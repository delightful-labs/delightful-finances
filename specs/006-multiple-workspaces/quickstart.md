# Workspace validation

Read [spec.md](spec.md) for product behavior and [tasks.md](tasks.md) for completion evidence. The [operation contract](contracts/workspace-creation.md) describes implemented URLs and recovery.

Use the disposable environment only; do not reset or stop persistent 5173/5174 data. Finish static/unit generation before starting browser tests because both regenerate shared environment files.

```sh
pnpm check
pnpm check:tests
pnpm exec vitest run
pnpm exec playwright test --config playwright.multiple-workspaces.config.ts
# Keep a disposable dev:agent Jazz server running for these two commands.
# Use its Jazz server URL (not the Vite page URL).
FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=<disposable-jazz-url> pnpm build
pnpm exec playwright test --config playwright.pwa.config.ts
```

Workspace browser tests start `pnpm dev:agent` at http://localhost:5180 with in-memory Jazz. Production shell tests use preview at http://127.0.0.1:4173 and local browser storage, backed by the same disposable in-memory Jazz server. A build with no Jazz URL proves compilation only; fresh-identity runtime verification requires that server. Announce the URL before starting either server. Tests never deploy migrations.

Covered scenarios include duplicate names and explicit switching; isolated account/transaction data; independent tabs/history/reload; immediate discard of unfinished transaction input; warm offline creation/reconnection; frozen journal recovery without replay; explicit retry using original IDs; optional-default edits remaining unchanged; existing-workspace required integrity repair; lost membership without receipt resurrection; blocked journal storage; and creator/outsider real-server policy outcomes.

Local creation success means locally persisted. Server policy assertions use global-tier reads/waits; none claim that offline writes are already remotely accepted. Future sharing and ownership administration require their own implementation and validation.
