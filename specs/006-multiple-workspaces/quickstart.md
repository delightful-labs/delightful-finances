# Validation guide — after implementation approval

This is a future validation guide. No application code or tests were added/run during planning.

## Prerequisites

Review and approve each focused implementation before adding/running its tests. Use the repository pnpm installation and isolated disposable Jazz environment. Do not reset user data, deploy schema, or start/stop the persistent 5173/5174 environment as part of this guide.

When browser verification is authorized, announce and start `pnpm dev:agent` at **http://localhost:5180**. Use `--port 5181` only for a distinct concurrent session. Inspect existing workspace Playwright configuration before execution: it must point to the isolated agent environment rather than persistent data. Finish static/unit generation before browser runs to avoid shared generated-environment races.

## Scenarios

1. New identity: one initial workspace, linked profile/owner membership, required and optional starter rows, no accounts/transactions. Reload creates no additional workspace.
2. Existing identity: create a second workspace; profile name/avatar and original finances remain unchanged. New workspace appears without automatic active-selection change. Duplicate display name is accepted.
3. Warm offline identity: create and locally persist an additional workspace before reconnecting. Feedback says locally saved, not server-confirmed. Existing workspaces stay usable.
4. Invalid name and repeated submit: whitespace is rejected; repeated submit during creation produces one attempt. Explicit Create another creates a distinct workspace.
5. Interruption/reload: journal precedes commit; same attempt reconciles without new IDs or destructive upserts. Local-storage failure blocks issuance. Failed/unknown write does not trigger blind retry.
6. Identity replacement/teardown: no replacement workspace/profile writes, stale selection callbacks, or false rollback claims. Issued write settlement drains under the original binding.
7. Legacy/multiple workspaces: no unique-personal selection, optional-category replenishment, or automatic membership resurrection. Ambiguous no-selection state requests explicit selection.
8. Defaults: edit central optional definition, create another workspace, and verify old categories are unchanged. Stable identities survive localization changes and retries.
9. Authorization: current real-server policies accept intended creator bootstrap and reject another identity mutating the new workspace. Local success alone is not the assertion.

## Checks once authorized

- Prettier on changed files only and `pnpm check` for static validation.
- Focused Vitest files for creation persistence, journal, initialization and statecharts after implementation approval; choose actual paths from the reviewed increment.
- Focused workspace Playwright cases under isolated configuration, including offline/identity replacement. No full-suite expansion without a new reason.

Expected evidence: exact local vs remote outcomes, one logical workspace per attempt, correct profile/membership/category relationships, and zero modifications to unrelated workspaces. See [UI contract](contracts/workspace-creation.md) and [data model](data-model.md).
