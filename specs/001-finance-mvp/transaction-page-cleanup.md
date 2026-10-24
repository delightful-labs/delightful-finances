# Income and expense page cleanup

## Focused scope

Centralize transaction kind constants, collection paths and localized noun descriptors.
The transaction layout resolves its kind and presentation once, passing the heading
and list path into its children. The create integration uses the same descriptors
for its title and cancellation path. Retain existing query parameters, pagination,
workspace scoping and income/expense noun forms.

This is a pure synchronous presentation mapping: no async steps, acquired resources,
authorization decisions or actor changes. Existing query and actor ownership remains
in integration components. Localization still runs in Svelte components.

## Review checklist

- [x] Add shared kind/path constants and typed presentation configuration.
- [x] Adopt configuration in layout, workspace, list and create integration.
- [x] User implementation review.
- [x] After approval, add focused unit coverage for exact/nested income route matching
      and configuration; inspect/update `src/routes/finance.e2e.ts` and relevant
      transaction route navigation coverage before running relevant tests.

## Recommended later cycles

- Adopt kind/path constants in route entry points, edit fallback and save redirects.
- Express income-only inline check entry as an explicit presentation capability;
  preserve existing expense check references and machine-owned validation rules.
- Replace repeated handwritten kind unions with the shared TransactionKind type.
- Build the tag-name index once in the list instead of finding a tag for every link.
- Keep schema enum and migration changes separate from this presentation cleanup.

## Follow-up implementation review

Shared constants now cover create route entry points, the edit observation fallback,
and post-save navigation. The shared presentation mapping owns a paymentEntry mode:
inline for income, preserve for expense. Create/edit integrations pass this mode
into the pure form; the form no longer chooses controls from the transaction kind.
Existing expense payment/check references remain submitted through hidden fields.
This mode is presentation policy, not authorization or validation.

The machine-first gate classifies this change as synchronous mapping plus an
existing navigation leaf operation. No new workflow, actor, resource acquisition,
or lifecycle change is introduced. The completion callback still invokes only
navigation; save orchestration and its cancellation/failure handling are unchanged.
The existing expense comparison in dirty checking uses the shared constant and
retains its prior semantics.

- [x] Adopt constants in new routes, edit fallback and save navigation.
- [x] Pass explicit payment-entry presentation mode into the form.
- [x] Review follow-up implementation before adding or running its tests.
- [x] After approval, inspect transaction-entry unit fixtures/assertions and finance,
      transaction-check and transaction-navigation Playwright coverage for income
      controls, expense reference retention and workspace-scoped save redirects.

Shared-kind adoption elsewhere and the tag-index optimization remain later cycles.

## Shared kind type review

Replace the remaining handwritten production income/expense unions with TransactionKind
in sample controls, sample integration, independent persistence plans and bank import
values/context. This changes type annotations and type-only imports only. Schema-derived
kinds remain inferred from their canonical validation/schema definitions.

The machine-first gate introduces no operation to classify: actor implementations,
helper bodies, statecharts, resource ownership and runtime imports are unchanged.

- [x] Consolidate remaining handwritten production kind unions.
- [x] Review this type-only implementation.

Affected coverage is `sample-transactions.test.ts`,
`independent-transaction-persistence.test.ts`, bank-sync `import-transaction.test.ts`,
and the transaction workspace/edit Playwright suites. Their runtime contracts remain
unchanged; no tests are added or run in this review cycle.

The tag-name index optimization remains the next focused recommendation.

## Shared tag-name indexing review

TransactionView and the overview integration now use one pure transactionTagNames
helper. Build a tag-ID index once, accumulate an insertion-ordered Set of names for
each transaction, and return arrays through the existing read-only map contract.
This removes repeated tag scans and repeated array/Set reconstruction per link.
Retain original link order, name deduplication, archived tag names and omission of
missing or empty names. Jazz row IDs are unique within the subscribed tag table.

Machine-first classification: synchronous data transformation only. No workflow,
permissions, subscriptions or actor lifecycle changes; integrations retain query
ownership and presentation receives the existing map prop.

- [x] Share tag-name indexing between list and overview.
- [x] Review implementation before adding or running tests.
- [x] After approval, cover helper empty/missing/duplicate labels, order, multiple
      transactions and renamed labels; inspect transaction-workspace.e2e.ts,
      transaction-edit.e2e.ts and expense-overview.e2e.ts for affected tag fixtures
      and assertions before running relevant coverage.

## Approved verification results

- Focused unit run: 53 tests pass across transaction-kind, transaction-tags,
  transaction-entry, sample-transactions, independent-transaction-persistence,
  bank-sync/import-transaction and expense-overview.
- Focused browser run: all 29 tests pass using
  `pnpm exec playwright test --config playwright.transaction-cleanup.config.ts`.
  Coverage includes desktop/mobile income/expense creation and cancellation,
  workspace-scoped redirects, pagination, offline samples and edits, income check
  controls, expense check-reference retention, overview filters and archived tag
  labels/renaming in both consumers.
- `pnpm exec tsc --project tests/tsconfig.json --noEmit` passes.
- Prettier and `git diff --check` pass for the test/configuration changes.

The first browser attempts failed at initialization because Vite denied externally
resolved pnpm Jazz assets. Agent-only Vite configuration now explicitly allows the
resolved Jazz WASM and worker package directories. A new test's memo selector was
also corrected to the existing localized accessible name before the passing run.
The disposable agent server remains at http://127.0.0.1:5186.
