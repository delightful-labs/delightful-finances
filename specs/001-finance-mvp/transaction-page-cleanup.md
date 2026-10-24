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
- [ ] User implementation review.
- [ ] After approval, add focused unit coverage for exact/nested income route matching
      and configuration; inspect/update `src/routes/finance.e2e.ts` and relevant
      transaction route navigation coverage before running relevant tests.

## Recommended later cycles

- Adopt kind/path constants in route entry points, edit fallback and save redirects.
- Express income-only inline check entry as an explicit presentation capability;
  preserve existing expense check references and machine-owned validation rules.
- Replace repeated handwritten kind unions with the shared TransactionKind type.
- Build the tag-name index once in the list instead of finding a tag for every link.
- Keep schema enum and migration changes separate from this presentation cleanup.
