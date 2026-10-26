<script lang="ts">
	import { Button, TopNavigation, ScreenReaderText } from 'delightful-ui'
	import Icon from './AppIcon.svelte'
	import FinanceLogo from '#lib/assets/delightful-finance-logo.svg?component'
	import MenuIcon from 'tdesign-icons-svg/src/menu-fold.svg?component'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	import { m } from '#lib/paraglide/messages.js'

	let {
		drawerId,
		toggleId,
		drawerOpen,
		onToggle
	}: {
		drawerId: string
		toggleId: string
		drawerOpen: boolean
		onToggle: () => void
	} = $props()
</script>

<TopNavigation sticky class="site-header">
	<Button
		class="navigation-toggle"
		appearance="flat"
		id={toggleId}
		type="button"
		aria-controls={drawerId}
		aria-expanded={drawerOpen}
		onclick={onToggle}
	>
		<ScreenReaderText
			>{m['actions.toggle_subject']({ subject: m['navigation.label']() })}</ScreenReaderText
		>
		<Icon
			style="width: 1.5rem; height: 1.5rem; pointer-events: none;"
			icon={drawerOpen ? CloseIcon : MenuIcon}
		/>
	</Button>
	<FinanceLogo class="app-logo" role="img" aria-label={m['app.name']()} />
</TopNavigation>

<style>
	:global {
		.site-header {
			--dui-top-navigation-padding: 0;
			inline-size: 100%;
		}

		.site-header .app-logo {
			inline-size: auto;
			max-inline-size: 100%;
			block-size: 44px;
			flex-shrink: 0;
			color: var(--dui-color-foreground, #646464);
		}

		.site-header .navigation-toggle {
			--dui-button-padding: 0;
			--dui-button-border-width: 0;
			--dui-button-min-height: 2.75rem;
			inline-size: 2.75rem;
			block-size: 2.75rem;
			display: inline-grid;
			place-items: center;
			touch-action: manipulation;
		}
	}
</style>
