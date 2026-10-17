<script lang="ts">
	import { useMachine } from '@xstate/svelte'
	import { getContext, type Snippet } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { getDb, getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import type { z } from 'zod'
	import { accountFormSchema } from '#lib/validation/accounts.js'
	import { createFormController } from '#lib/forms.svelte.js'
	import type { FormSave } from '#lib/machines/form.js'
	import { accountCreationAccessMachine } from '#lib/machines/account-creation-access.js'
	import type { Account } from '#lib/schema.js'
	import { createAccount } from '#lib/data.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountForm from './AccountForm.svelte'
	import QueryContent from './QueryContent.svelte'

	let { trigger }: { trigger?: Snippet<[() => void, boolean]> | undefined } = $props()

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const db = getDb()
	const session = fromStore(getJazzSession())
	const scope = $derived(`${filters.activeOrganizationId}:${session.current.account?.id}`)
	const membership = new QuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const access = useMachine(accountCreationAccessMachine)
	const accessSnapshot = fromStore(access.snapshot)
	$effect(() => {
		access.send({
			type: 'OBSERVE',
			source: {
				organizationId: filters.activeOrganizationId,
				userId: session.current.account?.id,
				sessionReady: session.current.status === 'ready',
				membership: membership.current,
				loading: membership.isLoading,
				error: membership.error
			}
		})
	})
	const save: FormSave<
		z.output<typeof accountFormSchema>,
		Account,
		{ organizationId: string | null }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		const authorization = accessSnapshot.current
		// Recheck scope at the persistence boundary, including changes before observation effects run.
		if (
			!context.organizationId ||
			context.organizationId !== filters.activeOrganizationId ||
			!authorization.hasTag('can-create') ||
			authorization.context.organizationId !== context.organizationId ||
			authorization.context.userId !== session.current.account?.id
		)
			throw new Error('Account creation is not authorized in the current workspace.')
		return createAccount(db, context.organizationId, values.name, values.kind)
	}
	const form = createFormController({
		schema: accountFormSchema,
		save,
		context: () => ({ organizationId: filters.activeOrganizationId }),
		key: () => scope,
		disabled: () => !accessSnapshot.current.hasTag('can-create')
	})
</script>

<QueryContent
	queries={[membership]}
	loadingMessage={m['status.loading']({ subject: m['labels.accounts']() })}
	errorMessage={m['errors.load']({ subject: m['labels.accounts']() })}
>
	<AccountForm organizationId={filters.activeOrganizationId} {scope} {form} {trigger} />
</QueryContent>
