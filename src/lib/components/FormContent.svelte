<script lang="ts" generics="Values, Result, Context">
	import type { Snippet } from 'svelte'
	import type { FormView } from '#lib/machines/form.js'

	let {
		view,
		onsubmit,
		onreset,
		fields,
		controls,
		controlsFill = false,
		feedback
	}: {
		view: FormView<Values, Result, Context>
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		fields: Snippet<[FormView<Values, Result, Context>]>
		controls?: Snippet<[FormView<Values, Result, Context>]> | undefined
		controlsFill?: boolean
		feedback?: Snippet<[FormView<Values, Result, Context>]> | undefined
	} = $props()
</script>

<form {onsubmit} {onreset} aria-busy={view.busy}>
	<div class="form-fields">{@render fields(view)}</div>
	{#if controls}
		<div class="form-controls" class:fill={controlsFill}>{@render controls(view)}</div>
	{/if}
	<!-- Future field feedback: docs/delightful-ui-integration.md#field-feedback -->
	{#if feedback}
		<div class="form-feedback">{@render feedback(view)}</div>
	{/if}
</form>

<style>
	form {
		display: grid;
		gap: var(--dui-spacing-md);
	}

	.form-fields,
	.form-feedback {
		display: grid;
		gap: var(--dui-spacing-xs);
		min-width: 0;
	}

	.form-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-spacing-xs);
	}

	.form-controls.fill :global(> button) {
		flex: 1 1 calc((100% - var(--dui-spacing-xs)) / 2);
		min-inline-size: 0;
	}

	.form-fields:empty,
	.form-controls:empty,
	.form-feedback:empty {
		display: none;
	}
</style>
