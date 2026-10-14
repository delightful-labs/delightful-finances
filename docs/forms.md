# Reusable forms

Pages initialize form workflows through controller modules. Presentation components receive the controller's view and callbacks through props and render with `FormContent.svelte`. They do not initialize Jazz queries or XState actors.

## Controller API

`createFormController` lives in `controllers/form.svelte.ts`. Initialize it from a page controller during Svelte component initialization.

- `schema`: a Zod schema for submitted values. Derive field validation from the canonical entity schema; use its transforms and defaults for normalization.
- `save`: an async function receiving validated values and `{ context, signal }`. Check workspace identity and applicable permissions before writing through shared data helpers.
- `context`: a getter providing values captured when an actor is created, such as the workspace ID.
- `key`: an optional getter identifying the active workspace/record. A key change stops the old actor and creates a fresh one.
- `disabled`: an optional getter preventing submissions and native resets.
- `arrayFields`: an optional getter listing repeated field names, such as `['tags']`.

The controller exposes `view`, `submit`, `reset`, and `submitValues`. Native submission reads `FormData` once using `Object.fromEntries`; configured array fields use `getAll`. `submitValues` supports button actions such as archiving without constructing a native form.

The reactive view contains the XState `state`, `busy`, `disabled`, and Zod `issues`. Saved output is available through `state.context.result`, and failures through `state.context.error`.

## Presentation API

`FormContent` accepts `view`, `onsubmit`, `onreset`, a required `fields` snippet, and optional `controls` and `feedback` snippets. Each snippet receives the form view. FormContent owns native form markup and layout, with no actor or database lifecycle.

A presentation component uses its controller prop like this:

```svelte
<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
	{#snippet fields(view)}
		<InputText
			label={m['labels.account_name']()}
			id="account-name"
			name="name"
			required
			disabled={view.disabled}
		/>
	{/snippet}
	{#snippet controls(view)}
		<Button type="submit" disabled={view.disabled}>{m['actions.save']()}</Button>
	{/snippet}
</FormContent>
```

This excerpt assumes `form` is a prop and the presentation component imports FormContent, Delightful UI controls, and messages. See `AccountForm.svelte` for complete success, validation, save-error, and reset feedback.

## Lifecycle

Submission invokes Zod validation and then the save actor. Validation failures enter `invalid`; save failures enter `error`; successful saves enter `success`. Corrected submissions and resets are supported. Submissions and resets are blocked while validating or saving.

The schema and save callback are fixed for the controller. Context is captured per actor. Effects recreate the actor when `key` changes and stop it on page teardown; save actors receive an abort signal, but cancellation depends on the underlying operation.

Key the native form markup by the same workspace/record identity to reset uncontrolled field values alongside the actor. “Add another” uses native form reset. Repeated tag fields are collected through `arrayFields`, not individual bindings.

## Current integrations

| Page                 | Controller                                 | Presentation                             |
| -------------------- | ------------------------------------------ | ---------------------------------------- |
| Add account          | `controllers/account-form.svelte.ts`       | `AccountForm`                            |
| Workspace settings   | `controllers/workspace-settings.svelte.ts` | `WorkspaceNameForm`                      |
| Category settings    | `controllers/category-settings.svelte.ts`  | `CategoryForm`, `CategoryList`           |
| Tag settings         | `controllers/tag-settings.svelte.ts`       | `TagForm`, `TagList`                     |
| Add income / expense | `controllers/transaction-form.svelte.ts`   | `TransactionForm`, `TransactionTagInput` |

Controllers obtain the database from the shared Jazz provider during initialization. Query loading/error presentation is composed by pages through `QueryContent`. Shared writes live in `data.ts` and wait for local persistence where required; ordinary offline writes do not require a network round trip.

## Entity validation

Validation modules match schema filenames, such as `validation/accounts.ts`, `validation/categories.ts`, `validation/tags.ts`, and `validation/transactions.ts`. Each owns canonical validation and its derived form adapters.

Transactions use current account/category rows to resolve workspace and currency, reject unavailable or archived selections, and convert amounts to integer minor units. Check income requires a nonblank number and valid date; presentation shows those fields only for Check. The system category supplies the default unless overridden. The date input defaults to today. Tag suggestions come from the page controller; repeated tag names are validated and persisted with the transaction.

Tag settings shares one category query for historical labels and active form options. Form validation rejects category selections that are unavailable in the active workspace. Archived categories remain available as historical labels.

## Verification

After implementation review, run focused unit and browser checks for affected workflows. The shared form machine covers validation, transformed values, save failures/retries, busy-state events, and resets. The workspace browser suite covers native forms, workspace switches, persistence, role permissions, conditional check fields, tags, and offline writes; it also fails on Svelte ownership warnings.

Finish Paraglide-generating unit/type commands before browser runs: generated-file updates can reload pages on the shared development server and disrupt fixtures. Use `pnpm check:tests` for browser-test type checking and `pnpm test:workspace` for relevant browser scenarios.
