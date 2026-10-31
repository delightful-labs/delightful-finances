# Transaction list filters and search

## Requirements

Expense and income lists support inclusive start/end dates, the overview's Last 7
days and Last 30 days presets, category, currency and text search. Initially all
dates, categories and currencies are included. Show the currency filter only when
the account-scoped list contains more than one currency. Empty date bounds are
open-ended; reversed bounds show the existing date-range error. Search ignores case and extra
whitespace and requires every word to occur across description, memo, category
name or tag names. All controls combine, within the existing workspace and account
scope. Filter before grouping, daily totals and pagination; changes reset page 1.
Filters live in URL query parameters so pagination and reloads retain them.

## Design

TransactionView retains Jazz subscriptions and URL binding. TransactionListFilters
is pure presentation and reuses DateRangeFilter. The synchronous filter helper
has no persistence, authorization, asynchronous workflow or acquired resources;
the machine-first gate does not require a statechart for this transformation.
Transfer-pair lists and the overview remain outside this focused implementation.

## Review and verification

- [x] Implement filtering, controls and expense/income integration.
- [x] Approve search localization: `actions.search_subject`, “Search {subject}”.
- [x] Review implementation before adding or running tests.
- [x] After approval, add filter-helper unit tests for boundaries, combined filters,
      whitespace/case, multiple search terms and missing optional text.
- [x] Inspect `tests/features/transaction-list.e2e.ts` and update
      `tests/transaction-workspace.e2e.ts` for filters, presets, pagination reset,
      daily totals, retained URL state and mobile controls.

Five filter-helper unit tests and eight Playwright tests pass. Four new browser
cases cover expense/income filters at desktop/mobile sizes, combined text fields,
dates/category/currency, filtered totals, presets, invalid ranges, empty results,
pagination reset/retention, reload retention and mobile overflow. Four existing
regressions cover empty lists, account/workspace changes, historical category/tag
names, currency totals and drawer pagination through selection/creation/reload.
Browser verification uses the disposable agent server at port 5186.
Svelte checking reports zero errors and warnings; test TypeScript checking,
Prettier checking and `git diff --check` pass.
Browser coverage uses real-clock relative dates and USD/TZS accounts,
matching the current account schema. Category and currency controls use the shared
`actions.filter_subject` message so their names distinguish them from editor fields.
SvelteKit shallow URL observations use `page.shallow?.url ?? page.url` so filtering
and pagination update immediately after a shallow query change.

## DUI control correction

The search field now uses DUI InputText with type search; category and currency
use DUI Select. DateRangeFilter already uses DUI InputDate and Button. The
fieldset resets its native border, margin, padding and minimum inline size; legend
padding is also reset. Accessible control names and callbacks remain the same.
After user approval, eight unit tests pass, including three component cases for
zero, one and multiple currencies. All four expense/income filter browser cases
pass at desktop/mobile sizes using the DUI controls, including single-currency
filter absence, multiple-currency visibility, the fieldset border/spacing reset
and mobile overflow assertions. Svelte checking reports zero errors and warnings;
test TypeScript, formatting and diff checks pass. The earlier four existing list
and drawer regression results above precede this presentation correction.
