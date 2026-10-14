# Reusable forms

`Form.svelte` collects native form fields on submission and connects them to an XState machine. `WorkspaceNameForm`, `TransactionForm`, and `AccountForm` use this API. The transaction migration is reviewed: 29 adapter unit tests and three form browser regressions pass, including workspace draft reset and check validation retry. The machine has unit coverage for validation, transformed values, save failures and retries, busy-state event handling, and reset. Five browser tests cover sidebar navigation preserving the workspace and database session, workspace renaming, whitespace validation and retry, reload persistence, owner/admin access, member/viewer read-only controls and server-denied writes, and workspace switching. Run `pnpm test:workspace` against the shared development server.

## Inputs

Entity validation modules match their schema counterparts: `validation/accounts.ts` and `validation/transactions.ts`. Canonical transaction rules and their derived form adapter live together in `transactions.ts`; matching unit tests use the same filenames.

- `schema`: a Zod schema for the submitted field object. Native field values are strings or files; use schema coercion/transforms where needed.
- `save`: an async function receiving validated values and `{ context, signal }`.
- `context`: form-specific values such as the workspace ID.
- `disabled`: prevents submission, independently of the machine's current state.
- `fields`: a required Svelte snippet.
- `controls` and `feedback`: optional snippets.

Each snippet receives `state` (the XState snapshot), `busy`, `disabled`, and Zod `issues`. Read saved output from `state.context.result`; inspect failures through `state.context.error`.

## Lifecycle

Submission invokes Zod validation, then invokes the save actor only on successful validation. Validation failures enter `invalid`; save failures enter `error`; successful saves enter `success`. Each outcome allows corrected submissions or a native reset. Additional submit/reset events are ignored while validating or saving; the component also prevents native resets while busy.

`schema`, `save`, and `context` are fixed for a mounted instance. Treat context as immutable and key the component by record identity when switching records. The save function receives an abort signal; cancellation support depends on the operation it calls.

## Workspace example

Consumers call `getDb()` during component initialization to read the database from Jazz's shared provider. The provider renders consumers after the database is ready, so they do not need nullable database state or a mount callback just to obtain it. Keep subscription setup and disposal in lifecycle callbacks. Shared write operations live in `data.ts`.

Finance filters are shared through Svelte context from the root layout. AppShell reads and updates that context directly; WorkspaceBootstrap and the layout do not forward filter props. The workspace browser suite captures Svelte ownership mutation/binding warnings and fails if they appear. Three focused navigation/filter tests pass after this cleanup.

Bind the record ID through context:

```svelte
<script lang="ts">
	import { z } from 'zod'
	import { getDb } from 'jazz-tools/svelte'
	import { renameWorkspace } from '#lib/data.js'
	import Form from '#lib/components/Form.svelte'
	import type { FormSave } from '#lib/machines/form.js'
	import type { Organization } from '#lib/schema.js'

	// Excerpt: workspace, canRename, and m come from the workspace component.
	const db = getDb()
	const schema = z.object({ name: z.string().trim().min(1) })
	const saveName: FormSave<z.output<typeof schema>, void, Pick<Organization, 'id'>> = (
		values,
		{ context }
	) => renameWorkspace(db, context.id, values.name)
</script>

{#key workspace.id}
	<Form {schema} save={saveName} context={{ id: workspace.id }} disabled={!canRename}>
		{#snippet fields(form)}
			<label for="workspace-name">{m['labels.workspace_name']()}</label>
			<input
				id="workspace-name"
				name="name"
				value={workspace.name}
				required
				disabled={form.disabled}
			/>
		{/snippet}
		{#snippet controls(form)}
			<button type="submit" disabled={form.disabled}>{m['actions.save']()}</button>
		{/snippet}
		{#snippet feedback(form)}
			{#if form.state.matches('success')}
				<p role="status">{m['workspace.name_saved']()}</p>
			{/if}
		{/snippet}
	</Form>
{/key}
```

The example omits error feedback for brevity; `WorkspaceNameForm` provides translated validation/save errors and a read-only explanation. Field collection currently uses `Object.fromEntries(FormData)`; repeated field names require a deliberate mapping before supporting multi-value controls.

## Transaction forms

`appTransactionSchema` is the canonical transaction schema. `transactionFormSchema` derives its submitted fields with `.pick()` and reuses canonical field validators; it does not maintain independent transaction rules. Memo trimming/empty-text normalization and manual-income cash defaults live on the canonical schema. Check income requires a nonblank check number and valid check date; its fields are only displayed when Check is selected. The form inherits them; `createTransaction` persists the parsed result so other callers inherit them too. Zod transforms/defaults handle normalization and validation. The adapter then resolves current rows and maps the form shape into the canonical transaction shape. It uses the current account/category rows to resolve workspace and currency, rejects unavailable or archived selections, parses integer minor-unit amounts, and delegates transaction validation—including dates, payment methods, check details, and memo types—to `appTransactionSchema`. Canonical/form/persistence unit coverage and the existing form browser regressions pass. The component supplies a save callback to the shared machine. Keying by workspace and transaction kind resets the actor and native fields when either changes. “Add another transaction” uses native form reset. `defaultTransactionCategory` resolves the active workspace’s unarchived system category for the transaction kind; the native select defaults to it, and the adapter uses it when no category ID is submitted. Explicit category choices are preserved and validated. Default-category unit tests and both expense/income browser cases pass, covering overrides, live updates, reset, and workspace switching. The date input uses native `defaultValue` so reset restores today; this fix is reviewed and verified.

## Account forms

`appAccountSchema` owns account validation: trimmed nonblank names, account types, workspace UUIDs, currency with a USD default, and archive state with an active (`null`) default. `accountFormSchema` derives name/type with `.pick()`; it adds no independent rules. `createAccount` parses through the canonical schema before writing. Jazz reuses its name/currency validators and enum values. `AccountForm` passes the active workspace ID through fixed context. Workspace changes reset the form. `createAccount` waits for local persistence before the shared machine enters success; no network round trip is required. Validation and save failures use separate translated feedback. After review, 11 schema unit tests and three persistence unit tests pass. Three focused browser regressions pass for blank-name correction, cash/bank/card creation, draft reset on workspace changes, creation in the selected workspace, and listing after reload.

Canonical account validation and parsed persistence have passing unit/browser regression coverage. The combined focused unit run has 80 passing tests.

## Account archiving

`AccountList` uses `createFormMachine` directly for its Archive action. Its derived action schema validates account/workspace IDs; a shared data helper sets `archivedAt` and waits for local persistence. Feedback lives outside the table so it survives the archived row leaving the reactive results. The action is offered to owners/admins and members with all-account or selected-account write access, while Jazz enforces writes. Accounts and their transactions are retained. After review, archive validation/local-persistence units and the existing account/shared-machine regressions pass (44 unit tests). Eight browser tests pass for offline archiving, synchronization, retained history, new-entry exclusion, list behavior, and role/grant permissions. Run `pnpm test:workspace --grep "account archive|account list"` after type checks finish; generated-file updates can reload a shared dev-server page during test setup.

After review, the conditional check fields and required date have passing coverage: 68 focused unit tests and five browser regressions. Tests reject missing/empty/invalid check dates, preserve valid dates in writes, hide the fields for cash/transfer/electronic income, enforce both required fields, and reset visibility/values on workspace changes and adding another transaction.

## Form Presentation Boundary

New page integrations initialize `createFormController` from `controllers/form.svelte.ts` through their page controller. Its `key` getter resets the actor when the active record/workspace changes; effect cleanup stops invoked work and removes subscriptions. The controller exposes a reactive `view` and native submit/reset callbacks.

`FormContent` is the presentation component: pass `view`, `onsubmit`, `onreset`, and fields/controls/feedback snippets. It owns no actor or database lifecycle. AccountForm now follows this API. Existing `Form` is temporarily an adapter for the other forms and will be removed after those page/controller migrations; its old schema/save/context examples above describe that transitional API.
