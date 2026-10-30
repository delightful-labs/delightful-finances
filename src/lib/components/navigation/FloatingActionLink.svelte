<script lang="ts">
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import Icon from './AppIcon.svelte'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'

	let { href, label }: { href: string; label: string } = $props()
</script>

<div class="floating-action-space">
	<AppLink {href}>
		{#snippet render(destination)}
			<a class="floating-action-link" href={destination} aria-label={label} title={label}>
				<Icon icon={AddIcon} />
			</a>
		{/snippet}
	</AppLink>
</div>

<style>
	.floating-action-space {
		position: sticky;
		bottom: 0;
		display: flex;
		justify-content: end;
	}

	.floating-action-link {
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 3.5rem;
		block-size: 3.5rem;
		border: var(--dui-border-width) solid var(--dui-color-foreground);
		border-radius: 50%;
		background-color: var(--dui-color-accent);
		color: var(--dui-color-on-accent);
		font-size: var(--dui-font-size-xxl);
		text-decoration: none;
		box-shadow: var(--dui-shadow);
	}

	.floating-action-link:hover {
		background-color: var(--dui-color-foreground);
		color: var(--dui-color-background);
	}
</style>
