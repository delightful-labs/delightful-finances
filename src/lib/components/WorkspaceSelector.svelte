<script lang="ts">
	import { Select } from 'delightful-ui'
	import type { Organization } from '#lib/schema.js'
	import { workspaceLabel } from '#lib/domain/workspace-routes.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		organizations,
		organizationId,
		label = m['workspace.current'](),
		onchange
	}: {
		organizations: readonly Pick<Organization, 'id' | 'name'>[]
		organizationId: string | null
		label?: string
		onchange: (organizationId: string) => void
	} = $props()
	const selectedOrganizationId = $derived(
		organizations.find((organization) => organization.id === organizationId)?.id ?? ''
	)
</script>

<Select
	{label}
	value={selectedOrganizationId}
	onchange={(event) => onchange(event.currentTarget.value)}
>
	<option value="" disabled>{m['workspace.choose']()}</option>
	{#each organizations as organization (organization.id)}
		<option value={organization.id}>{workspaceLabel(organization, organizations)}</option>
	{/each}
</Select>
{#if organizations.length === 0}<p>{m['workspace.empty']()}</p>{/if}
