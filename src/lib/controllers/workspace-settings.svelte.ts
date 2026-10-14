import { fromStore } from 'svelte/store'
import { getDb, getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
import type { z } from 'zod'
import { app, type Organization } from '#lib/schema.js'
import { renameWorkspace } from '#lib/data.js'
import type { FinanceFilters } from '#lib/finance-filters.js'
import type { FormSave } from '#lib/machines/form.js'
import { workspaceNameFormSchema } from '#lib/validation/identity.js'
import { createFormController } from './form.svelte.js'

export function createWorkspaceSettingsState(filters: FinanceFilters) {
	const db = getDb()
	const session = fromStore(getJazzSession())
	const workspaceQuery = new QuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? app.organizations.where({ id: filters.activeOrganizationId })
			: undefined
	)
	const membershipQuery = new QuerySubscriptionOne(() => {
		const userId = session.current.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const workspace = $derived(workspaceQuery.current)
	const canRename = $derived(
		membershipQuery.current?.organizationId === filters.activeOrganizationId &&
			(membershipQuery.current?.role === 'owner' || membershipQuery.current?.role === 'admin')
	)
	const save: FormSave<
		z.output<typeof workspaceNameFormSchema>,
		void,
		Pick<Organization, 'id'>
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		if (!canRename || context.id !== filters.activeOrganizationId || workspace?.id !== context.id)
			throw new Error('The workspace is not editable.')
		await renameWorkspace(db, context.id, values.name)
	}
	const form = createFormController({
		schema: workspaceNameFormSchema,
		save,
		context: () => ({ id: filters.activeOrganizationId ?? '' }),
		key: () => filters.activeOrganizationId,
		disabled: () => !workspace || !canRename
	})
	return {
		queries: [workspaceQuery, membershipQuery],
		form,
		get workspace() {
			return workspace
		},
		get canRename() {
			return canRename
		}
	}
}
