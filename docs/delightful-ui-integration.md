# Delightful UI integration trial

The Finance integration uses a packed local Delightful UI 0.0.24 archive in `vendor/`, consumed through a relative file dependency. It is a snapshot of the library source at packing time, not a published release or a live link. Repack explicitly to trial later library changes. Svelte must satisfy the library's ^5.57.2 peer requirement.

The full global theme is imported once in the root layout. Its default light colors, typography, control styles and focus treatment are approved for this trial. The existing responsive shell remains the application layout. Shared forms use grid/flex gap for layout spacing: 0.5rem between fields and 1rem between field, action and feedback groups. Use gap rather than padding or margin for spacing between sibling controls; padding remains appropriate inside controls. Empty groups are hidden and feedback paragraph margins are reset so they do not add incidental spacing. Buttons use the library defaults and explicit native types.

## Integrated controls

Account, category, workspace and transaction forms use InputText, Select, InputDate, Textarea and Button where applicable. Login/recovery use Textarea, Button and Checkbox. Revealing the recovery phrase opens Dialog; Backdrop dismissal, Close, confirmed completion and Escape clear the phrase and confirmation state. Dialog content is rendered only while open. The saved checkbox gates completion, not dismissal. Sidebar workspace/account filters use Select and Checkbox; account archiving uses Button. Query loading and startup use LoadingSpinner with translated labels. Query loading keeps its visible message and one status announcement.

Native field names, IDs, validation, FormData collection and the shared Form/XState workflow are retained. Amounts remain decimal text parsed by Finance into integer minor units. Dates remain date-only strings. Payment-method attachment forwarding initializes conditional check fields when the select mounts; native callbacks update them when it changes. Initial/reset defaults use defaultValue without parent bindings; workspace naming retains its reactive value prop so external name updates remain visible. No Jazz, permission, persistence or domain-schema changes are part of this trial.

The trial started from committed Finance HEAD, excluding uncommitted business-logic work. Before merging, retain the concurrently committed category settings route, navigation and business behavior from main; CategoryForm is already migrated. New components authored by the business-logic agent are outside this UI trial.

## Original component proposals

These proposals were recorded during the first trial. The second adoption batch below now implements the corresponding library primitives at selected call sites. Finance-specific parsing, permissions and translated text stay in the application.

### Currency entry

TransactionForm needs decimal input mode, a currency label, a pattern and reliable native submission/reset behavior. A currency-entry composition could standardize presentation and device/custom keyboard selection while keeping decimal drafts and integer-money conversion application-owned. InputNumber would change the value contract and is not used. NumberKeypad already exists; wiring its editing/focus workflow is deferred.

### Field feedback

Form exposes Zod issues, but individual fields currently have only aggregate validation feedback. A reusable field help/error interface could provide linked descriptions and invalid states across InputText, Select, InputDate and Textarea. TagInput already has an analogous help/error API. Any future adapter must map issues in Finance without making the library depend on Zod or XState.

### Status feedback

QueryContent and forms repeatedly render loading, success and error messages. A StatusMessage primitive could standardize visible messages, optional spinner and status/alert semantics without duplicate live announcements. LoadingSpinner alone hides its status text, so QueryContent composes a visible paragraph with an aria-hidden spinner today.

### Tables

AccountList and TransactionList use semantic native tables. A small DataTable presentation component or shared table tokens could provide responsive overflow, caption/header styling and row actions. Jazz querying, sorting, currency formatting and archive permissions remain caller responsibilities. No table behavior is introduced in this pass.

### Navigation

AppShell combines native links, workspace selection and account checkbox filters. Shared navigation/layout primitives or tokens could improve consistent spacing and selected-link presentation. Routing and workspace state remain application-owned; do not replace navigation links with action buttons.

## Review and validation

Validation passed: library packaging/publint, Finance production build, Svelte/application/service-worker static checks (zero errors or warnings), changed-file Prettier checks and git diff whitespace checks. After user review, 89 focused unit tests and all 27 integration browser scenarios passed, including native FormData/reset defaults, reactive category choices, income check-field visibility, decimal/date preservation, workspace filters, recovery/restore, archive permissions and modal dismissal. The modal regression covers Close, Escape, backdrop and confirmed completion, content removal, checkbox reset, clicks inside and focus return. Use `pnpm exec playwright test --config playwright.integration.config.ts` with the isolated dev server on port 5180. The category Select is keyed by default category ID to handle workspace query updates; ordinary category-list updates preserve explicit selections. Run static/build checks before browser checks, because generated-manifest updates reload active pages.

## Second component adoption — reviewed and verified

This review batch starts from committed Finance main at 08e219b in the separate feat/ui-components-round-two worktree. Refresh the local package snapshot from Delightful UI c9423b0 without publishing a release. Adopt StatusMessage in query/form/list feedback; FieldFeedback and InputCurrency in transaction entry; Table in account listing; Navigation and Drawer in the shell; InputImage in avatar upload. Preserve Jazz, permissions, form actors, validation and persistence. The grouped transaction list remains a date-grouped list rather than being converted into a table.

The shell uses inline space-reserving navigation on wide screens and modal overlay navigation at or below 48rem. Toggles expose expanded/control relationships; inline navigation remains open on link selection, while overlay selection dismisses it. Native dialog supplies modal focus/background behavior. Mode changes close the drawer; users can reopen it with the persistent toggle. Field errors use translated Finance messages with caller-owned issue mapping and aria-describedby/aria-invalid; raw Zod messages are not shown. Avatar selection preview/removal belongs to InputImage, while saved-avatar removal remains the existing application action.

Implementation review uses package validation, application/service-worker checks, build and formatting. After user approval, 110 focused unit tests and eight browser scenarios pass. Library component test results do not establish Finance integration coverage.

The updated archive is `vendor/delightful-ui-0.0.24-sidebar-height.tgz`, built from UI commit `c9423b0` plus the approved LoadingScreen and Drawer refinements; only this file dependency changes in the lockfile. The original archive is retained for the first trial's provenance. No registry release is needed for this local review.

Verification: packaging/publint, application/service-worker checks (zero errors/warnings), changed-file formatting and whitespace checks pass. The production build compiles client/server code but fails at prerendering: `/transactions/[id]` is marked prerenderable by the existing root layout and has no crawlable entry. This branch leaves the routing/PWA configuration unchanged; resolve the dynamic-route build policy separately. The isolated review server is http://127.0.0.1:5181. After implementation review, 110 unit tests and eight Chromium browser cases pass for money/transaction/form/avatar behavior, recovery dismissal, avatar upload/replace/remove, account table creation, workspace navigation, expense/income submission, stable sidebar geometry, full-height internal scrolling, compact controls, mobile Escape/backdrop dismissal and focus return. Browser-test type checks pass. Use FINANCE_INTEGRATION_URL=http://127.0.0.1:5181 with the integration configuration for this worktree.

### Remaining consumer opportunities

StatusMessage can replace aggregate feedback in additional settings/authentication forms in later focused batches. FieldFeedback is adopted first in transaction entry; other forms still need caller-owned translated issue mapping before adopting it. A future field composition could group a control with its linked help/error without repeating IDs, but it should preserve uncontrolled FormData and native attributes. Responsive Drawer policy remains caller-owned; the repeated breakpoint/initial-open behavior may inform a later shell composition after this consumer trial. Popover and NumberKeypad are available but are not added without a corresponding interaction need. The date-grouped transaction list deliberately retains its current list semantics.

The Jazz startup fallback uses the new LoadingScreen composition for loading/error feedback, centered vertically and horizontally with a single visible message. Its translated startup message is “Loading your finances…”. Workspace preparation retains its own single message; errors retain actionable retry text. Removed unused startup/workspace descriptions and the separate error heading, and simplified the database message keys. The decorative spinner adds no repeated hidden text.

Sidebar presentation revision: the external Open navigation button is hidden while open; the Drawer has one compact × close button with a translated accessible label. Its navigation heading is visually hidden while retaining the accessible name. Drawer retains its inert visual panel through exit motion so closing reverses opening; reduced-motion preferences skip transitions. Inline focus restoration waits for the external trigger to be revealed. This revision was visually approved and covered by the focused sidebar browser scenarios.

Sidebar height/layout revision: the Open navigation control now lives in a persistent main-content toolbar. While the drawer is open, the toolbar is invisible/inert but retains its geometry, eliminating vertical jumps. The drawer spans the viewport height (sticky inline, fixed overlay), with its body scrolling beneath a stationary close control. This refinement was visually approved; the focused sidebar browser scenarios pass.

## Current local package (2026-10-15)

Finance uses `vendor/delightful-ui-0.0.24-navigation-compact-status.tgz`, built from DUI’s `main` at `756bdbb`. That commit is pushed to GitHub and includes TopNavigation, the inline Drawer, and compact StatusMessage support.

The archive was built with `pnpm package` and `pnpm pack`. Finance keeps using a local file dependency.

Finance and DUI static checks pass with no errors or warnings. DUI packaging, 15 focused unit tests, and eight Drawer browser tests pass. The Drawer tests now match its current API; those test changes are still uncommitted and do not affect the package.

## Typography and spacing migration (review pending)

Finance now consumes `vendor/delightful-ui-0.0.24-typography-primitives.tgz`, packaged from local DUI commit `b21ee28`. The library still declares version 0.0.24; the archive name distinguishes this snapshot. Built in an isolated temporary directory with `svelte-package`, validated with `publint`, and packed with pnpm.

The first review batch adopts Heading/Text in PageHeader and the profile forms, InputAvatar for profile file selection, and canonical spacing tokens in PageContent/FormContent. InputAvatar receives localized upload/remove labels. The saved-avatar image remains native because DUI exports an upload control, not a standalone display Avatar. Keep page/form layout CSS; use DUI spacing tokens for gaps rather than custom values. Remaining screens and shell typography/spacing need subsequent review batches. Tests are deferred until implementation approval.
