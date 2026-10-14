<script lang="ts">
	import { Button, InputText, Select } from 'delightful-ui'
	import type { z } from 'zod'
	import type { Category, Tag } from '#lib/schema.js'
	import type { FormController } from '#lib/controllers/form.svelte.js'
	import type { tagFormSchema } from '#lib/validation/tags.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'

	let {
		organizationId,
		canCreate,
		categories,
		form
	}: {
		organizationId: string
		canCreate: boolean
		categories: readonly Category[]
		form: FormController<z.output<typeof tagFormSchema>, Tag, { organizationId: string | null }>
	} = $props()
</script>

{#key organizationId}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
		{#snippet fields(form)}
			{#if !form.state.matches('success')}
				<InputText
					label={m['labels.tag_name']()}
					id="tag-name"
					name="name"
					required
					disabled={form.busy || !canCreate}
				/>
				<Select
					label={m['labels.category']()}
					id="tag-category"
					name="categoryId"
					defaultValue=""
					disabled={form.busy || !canCreate}
				>
					<option value="">{m['tags.no_category']()}</option>
					{#each categories as category (category.id)}
						<option value={category.id}
							>{category.name} ({category.kind === 'expense'
								? m['labels.expenses']()
								: m['labels.income']()})</option
						>
					{/each}
				</Select>
			{/if}
		{/snippet}
		{#snippet controls(form)}
			{#if form.state.matches('success')}
				<Button type="reset" disabled={!canCreate}>{m['actions.add_tag']()}</Button>
			{:else}
				<Button type="submit" disabled={form.disabled}
					>{form.busy
						? m['status.saving']({ subject: m['labels.tag']() })
						: m['actions.add_tag']()}</Button
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
	</FormContent>
{/key}
