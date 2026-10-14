<script lang="ts">
	import { getDb, QuerySubscription } from 'jazz-tools/svelte'
	import type { z } from 'zod'
	import { app, type Tag } from '#lib/schema.js'
	import { createTag } from '#lib/data.js'
	import type { FormSave } from '#lib/machines/form.js'
	import { tagFormSchema } from '#lib/validation/tags.js'
	import { m } from '#lib/paraglide/messages.js'
	import Form from './Form.svelte'
	import QueryContent from './QueryContent.svelte'

	let { organizationId, canCreate }: { organizationId: string; canCreate: boolean } = $props()
	const db = getDb()
	const categories = new QuerySubscription(() =>
		app.categories.where({ organizationId, archivedAt: { isNull: true } }).orderBy('name')
	)
	const schema = tagFormSchema.refine(
		(values) =>
			values.categoryId === null ||
			categories.current?.some(
				(category) =>
					category.id === values.categoryId &&
					category.organizationId === organizationId &&
					!category.archivedAt
			) === true,
		{ path: ['categoryId'], message: 'Select an available category.' }
	)
	const save: FormSave<z.output<typeof schema>, Tag, { organizationId: string }> = async (
		values,
		{ context, signal }
	) => {
		signal.throwIfAborted()
		if (!canCreate || context.organizationId !== organizationId)
			throw new Error('The workspace is not editable.')
		return createTag(db, context.organizationId, values.name, values.categoryId)
	}
</script>

<QueryContent
	queries={[categories]}
	loadingMessage={m['status.loading']({ subject: m['labels.categories']() })}
	errorMessage={m['errors.load']({ subject: m['labels.categories']() })}
>
	{#key organizationId}
		<Form {schema} {save} context={{ organizationId }} disabled={!canCreate}>
			{#snippet fields(form)}
				{#if !form.state.matches('success')}
					<label for="tag-name">{m['labels.tag_name']()}</label>
					<input id="tag-name" name="name" required disabled={form.busy || !canCreate} />
					<label for="tag-category">{m['labels.category']()}</label>
					<select id="tag-category" name="categoryId" disabled={form.busy || !canCreate}>
						<option value="">{m['tags.no_category']()}</option>
						{#each categories.current ?? [] as category (category.id)}
							<option value={category.id}
								>{category.name} ({category.kind === 'expense'
									? m['labels.expenses']()
									: m['labels.income']()})</option
							>
						{/each}
					</select>
				{/if}
			{/snippet}
			{#snippet controls(form)}
				{#if form.state.matches('success')}
					<button type="reset" disabled={!canCreate}>{m['actions.add_tag']()}</button>
				{:else}
					<button type="submit" disabled={form.disabled}
						>{form.busy
							? m['status.saving']({ subject: m['labels.tag']() })
							: m['actions.add_tag']()}</button
					>
				{/if}
			{/snippet}
			{#snippet feedback(form)}
				{#if form.state.matches('success') && form.state.context.result}
					<p role="status">{m['tags.saved']({ name: form.state.context.result.name })}</p>
				{:else if form.state.matches('invalid')}
					<p role="alert">{m['tags.validation_error']()}</p>
				{:else if form.state.matches('error')}
					<p role="alert">{m['errors.save']({ subject: m['labels.tag']() })}</p>
				{/if}
			{/snippet}
		</Form>
	{/key}
</QueryContent>
