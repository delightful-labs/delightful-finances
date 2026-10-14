<script lang="ts" generics="Values, Result, Context">
	import { untrack, type Snippet } from 'svelte'
	import { createFormController } from '#lib/controllers/form.svelte.js'
	import FormContent from './FormContent.svelte'
	import type { z } from 'zod'
	import { type FormSave, type FormView } from '#lib/machines/form.js'

	let {
		schema,
		save,
		context,
		arrayFields = [],
		disabled = false,
		fields,
		controls,
		feedback
	}: {
		schema: z.ZodType<Values>
		save: FormSave<Values, Result, Context>
		context: Context
		arrayFields?: readonly string[]
		disabled?: boolean
		fields: Snippet<[FormView<Values, Result, Context>]>
		controls?: Snippet<[FormView<Values, Result, Context>]>
		feedback?: Snippet<[FormView<Values, Result, Context>]>
	} = $props()

	const controller = untrack(() =>
		createFormController({
			schema,
			save,
			context: () => context,
			disabled: () => disabled,
			arrayFields: () => arrayFields
		})
	)
</script>

<FormContent
	view={controller.view}
	onsubmit={controller.submit}
	onreset={controller.reset}
	{fields}
	{controls}
	{feedback}
/>
