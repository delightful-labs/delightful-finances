# Reusable forms

`Form.svelte` collects native form fields on submission and connects them to an XState machine. `WorkspaceNameForm` and `TransactionForm` use this API. The transaction migration is reviewed: 29 adapter unit tests and three form browser regressions pass, including workspace draft reset and check validation retry. The machine has unit coverage for validation, transformed values, save failures and retries, busy-state event handling, and reset. Five browser tests cover sidebar navigation preserving the workspace and database session, workspace renaming, whitespace validation and retry, reload persistence, owner/admin access, member/viewer read-only controls and server-denied writes, and workspace switching. Run `pnpm test:workspace` against the shared development server.

## Inputs

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

`transactionFormSchema` converts submitted native field values into the existing transaction domain schema. It uses the current account/category rows to resolve workspace and currency, rejects unavailable or archived selections, parses integer minor-unit amounts, and delegates calendar-date and check validation to `appTransactionSchema`. The component supplies a save callback to the shared machine. Keying by workspace and transaction kind resets the actor and native fields when either changes. “Add another transaction” uses native form reset.
