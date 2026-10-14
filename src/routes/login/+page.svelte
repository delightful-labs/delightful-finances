<script lang="ts">
	import { createLoginState } from '#lib/controllers/login.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import LoginForm from '#lib/components/LoginForm.svelte'

	const login = createLoginState()
</script>

<svelte:head><title>{m['login.heading']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['login.heading']()} />
<LoginForm
	restoring={login.restoring}
	restoreError={login.restoreError}
	onsubmit={login.restoreAccount}
/>
