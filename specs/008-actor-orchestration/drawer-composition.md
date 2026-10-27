# Drawer presentation composition

## Requirements and plan

Break the large AppDrawer into focused components composed as children in AppShell,
retaining navigation order, drawer behavior, account filtering/ordering, small balance
text, workspace selection, sync controls, status and existing styling/localization.

- AppDrawer owns the drawer container, binding, shared theme and children/footer slots.
- AppDrawerNavigation owns primary links and renders child sections before login.
- AppDrawerAccounts owns account disclosure, filter/balance/order presentation and the
  existing account-creation snippet.
- AppDrawerSettings owns the settings disclosure and workspace selector presentation.
- AppDrawerStatus owns the sync/status presentation and existing PWA integration.
- AppShell composes these components through children and the footer snippet.

These are focused presentation responsibilities with explicit data/callback props.
Jazz subscriptions, authorization decisions, actor lifetimes and browser effects remain
with their existing owners. The machine-first gate finds no new workflow, async actor,
resource, business decision or interruption path. Existing messages are reused unchanged;
styles move with their markup. No new visual design is introduced.

## Review and verification

- [x] Implement the six-file presentation composition refactor.
- [ ] User implementation review before adding or running tests.
- [ ] After approval, inspect navigation, account-order, multiple-workspaces and PWA
      browser coverage; update fixtures if needed, then run relevant checks for
      desktop/mobile drawer behavior, filtering, balance display, order controls,
      workspace selection, account creation and sync/status rendering.
