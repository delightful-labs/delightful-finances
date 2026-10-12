<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import { getDb, getSession } from 'jazz-tools/svelte'
	import { createAccount } from '#lib/data.js'
	import type { Account } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'

	let saveError = $state(false)
	let saving = $state(false)
	let savedAccount = $state<Account | null>(null)
	let db: ReturnType<typeof getDb> | null = null
	let userId = $state<string | null>(null)
	const filters = getContext<FinanceFilters>(financeFiltersKey)

	onMount(() => {
		db = getDb()
		userId = getSession().current?.user.account ?? null
	})

	async function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		if (!db || !userId) {
			saveError = true
			return
		}

		saving = true
		saveError = false
		try {
			const formData = new FormData(event.currentTarget)
			const name = String(formData.get('name') ?? '').trim()
			const accountKindValue = String(formData.get('kind') ?? '')
			if (
				accountKindValue !== 'cash' &&
				accountKindValue !== 'bank' &&
				accountKindValue !== 'card'
			) {
				throw new Error('Choose an account type.')
			}
			const organizationId = filters.activeOrganizationId
			if (!organizationId) throw new Error('No workspace is selected.')

			savedAccount = createAccount(db, organizationId, name, accountKindValue)
		} catch {
			saveError = true
		} finally {
			saving = false
		}
	}
</script>

<svelte:head>
	<title>{m['actions.add_account']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['actions.add_account']()}</h1>

{#if savedAccount}
	<p role="status">{m['accounts.saved']({ name: savedAccount.name })}</p>
{:else}
	<form onsubmit={submit}>
		<label for="account-name">{m['labels.account_name']()}</label>
		<input id="account-name" name="name" required />

		<label for="account-kind">{m['labels.account_type']()}</label>
		<select id="account-kind" name="kind" required>
			<option value="" selected disabled>{m['labels.account_type']()}</option>
			<option value="cash">{m['accounts.type.cash']()}</option>
			<option value="bank">{m['accounts.type.bank']()}</option>
			<option value="card">{m['accounts.type.card']()}</option>
		</select>

		<p>{m['accounts.currency_usd']()}</p>

		{#if saveError}
			<p role="alert">{m['accounts.save_error']()}</p>
		{/if}

		<button type="submit" disabled={saving || !userId}>
			{saving ? m['accounts.saving']() : m['actions.add_account']()}
		</button>
	</form>
{/if}
