# Delightful UI integration trial

The Finance integration uses a packed local Delightful UI 0.0.24 archive in `vendor/`, consumed through a relative file dependency. It is a snapshot of the library source at packing time, not a published release or a live link. Repack explicitly to trial later library changes. Svelte must satisfy the library's ^5.57.2 peer requirement.

The full global theme is imported once in the root layout. Its default light colors, typography, control styles and focus treatment are approved for this trial. The existing responsive shell remains the application layout. Shared forms use grid/flex gap for layout spacing: 0.5rem between fields and 1rem between field, action and feedback groups. Use gap rather than padding or margin for spacing between sibling controls; padding remains appropriate inside controls. Empty groups are hidden and feedback paragraph margins are reset so they do not add incidental spacing. Buttons use the library defaults and explicit native types.

## Integrated controls

Account, category, workspace and transaction forms use InputText, Select, InputDate, Textarea and Button where applicable. Login/recovery use Textarea, Button and Checkbox. Revealing the recovery phrase opens Dialog; Backdrop dismissal, Close, confirmed completion and Escape clear the phrase and confirmation state. Dialog content is rendered only while open. The saved checkbox gates completion, not dismissal. Sidebar workspace/account filters use Select and Checkbox; account archiving uses Button. Query loading and startup use LoadingSpinner with translated labels. Query loading keeps its visible message and one status announcement.

Native field names, IDs, validation, FormData collection and the shared Form/XState workflow are retained. Amounts remain decimal text parsed by Finance into integer minor units. Dates remain date-only strings. Payment-method attachment forwarding initializes conditional check fields when the select mounts; native callbacks update them when it changes. Initial/reset defaults use defaultValue without parent bindings; workspace naming retains its reactive value prop so external name updates remain visible. No Jazz, permission, persistence or domain-schema changes are part of this trial.

The trial started from committed Finance HEAD, excluding uncommitted business-logic work. Before merging, retain the concurrently committed category settings route, navigation and business behavior from main; CategoryForm is already migrated. New components authored by the business-logic agent are outside this UI trial.

## Suggested future components

These are proposals supported by current call sites, not new MVP requirements or implemented exports. Finance-specific parsing, permissions and translated text stay in the application.

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
