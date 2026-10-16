<script lang="ts">
	import type { Component } from 'svelte'
	import type { SVGAttributes } from 'svelte/elements'

	let {
		icon: Glyph,
		class: className,
		...attributes
	}: SVGAttributes<SVGSVGElement> & {
		icon: Component<SVGAttributes<SVGSVGElement>>
	} = $props()
</script>

<Glyph
	{...attributes}
	class={['app-icon', className]}
	viewBox="0 0 24 24"
	width="1em"
	height="1em"
	aria-hidden="true"
	focusable="false"
/>

<style>
	:global(svg.app-icon) {
		display: inline-block;
		flex-shrink: 0;
		vertical-align: middle;
	}
</style>
