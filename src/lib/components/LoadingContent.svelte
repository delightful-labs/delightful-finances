<script lang="ts">
	import { LoadingScreen } from 'delightful-ui'
	import type { Snippet } from 'svelte'

	let {
		loading = true,
		text,
		variant = 'loading',
		style,
		children
	}: {
		loading?: boolean
		text: string
		variant?: 'loading' | 'error'
		style?: string | undefined
		children?: Snippet
	} = $props()
</script>

{#if children}
	<div class="loading-content" aria-busy={loading}>
		<div class="content" class:loading inert={loading} aria-hidden={loading}>
			{@render children()}
		</div>
		{#if loading}
			<div class="overlay">
				<LoadingScreen {text} {variant} style="--dui-loading-screen-min-height: auto" />
			</div>
		{/if}
	</div>
{:else}
	<LoadingScreen {text} {variant} {style} />
{/if}

<style>
	.loading-content {
		display: grid;
		min-inline-size: 0;
	}

	.content,
	.overlay {
		grid-area: 1 / 1;
		min-inline-size: 0;
	}

	.content {
		display: grid;
		align-content: start;
		gap: var(--dui-spacing-md);
	}

	.content.loading {
		opacity: 0.35;
	}

	.overlay {
		z-index: 1;
		display: grid;
		place-items: center;
	}
</style>
