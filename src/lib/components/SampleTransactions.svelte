<script lang="ts">
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession, QuerySubscriptionOne, QuerySubscription } from 'jazz-tools/svelte'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	const dev = import.meta.env.DEV
	import { createActor } from 'xstate'
	import { readable } from 'svelte/store'
	import { fromStore } from 'svelte/store'
	import { onDestroy } from 'svelte'
	import { createSampleTransactionsMachine } from '#lib/machines/sample-transactions.js'
	import {
		createTransactionEntryFormOptions,
		transactionEntryScope,
		writableTransactionAccounts,
		applicableTransactionCategories
	} from '#lib/machines/transaction-entry.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import { independentTransactionFormSchema } from '#lib/validation/transactions.js'
	import type { TransactionEntryObservation } from '#lib/transaction-entry-contract.js'
	import {
		developerMenuKey,
		unavailableSampleControls,
		type DeveloperMenuContent
	} from '#lib/developer-menu.js'

	let { kind }: { kind: 'income' | 'expense' } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const developerMenu = getContext<DeveloperMenuContent>(developerMenuKey)
	const accounts = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId, kind })
			: undefined
	)
	const db = getDb()
	const session = fromStore(getJazzSession())
	const membership = new QuerySubscriptionOne(() =>
		dev
			? organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
			: undefined
	)
	const grants = new QuerySubscription(() =>
		dev && filters.activeOrganizationId && session.current.account?.id
			? app.accountMemberships.where({
					organizationId: filters.activeOrganizationId,
					userId: session.current.account.id
				})
			: undefined
	)
	function sampleObservation(): TransactionEntryObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			kind,
			membership: membership.current,
			grants: grants.current ?? [],
			accounts: accounts.current ?? [],
			categories: categories.current ?? [],
			tags: [],
			loading: [membership, grants, accounts, categories].some((query) => query.isLoading),
			failed: [membership, grants, accounts, categories].some((query) => query.error != null)
		}
	}
	let batchScope = ''
	const currentSampleScope = () =>
		JSON.stringify([
			session.current.account?.id,
			filters.activeOrganizationId,
			kind,
			filters.selectedAccountIds
		])
	const creation = createTransactionEntryFormOptions({
		binding: db,
		db,
		observe: sampleObservation
	})
	const sampleMachine = createSampleTransactionsMachine(creation.operation, (index) => {
		if (!dev || batchScope !== currentSampleScope()) throw new Error('Sample scope changed')
		const observation = sampleObservation()
		const account = writableTransactionAccounts(observation).find(
			(account) =>
				filters.selectedAccountIds === null || filters.selectedAccountIds.includes(account.id)
		)
		const category = applicableTransactionCategories(observation)[0]
		const date = new Date()
		date.setDate(date.getDate() - Math.floor(index / 5))
		const bookedOn = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
		const transaction = independentTransactionFormSchema(() => ({
			...observation,
			accounts: writableTransactionAccounts(observation)
		})).parse({
			accountId: account?.id,
			categoryId: category?.id,
			bookedOn,
			amount: `${Math.floor((100 + index * 137) / 100)}.${String((100 + index * 137) % 100).padStart(2, '0')}`,
			paymentMethod: 'cash',
			description: m['labels.sample_subject_number']({
				subject: m['nouns.transaction']({ count: 1 }),
				number: index + 1
			}),
			tags: []
		})
		return {
			request: {
				id: index,
				scopeRevision: 0,
				scope: transactionEntryScope(observation),
				values: transaction
			},
			observation: { revision: observationRevision, facts: observation }
		}
	})
	let observationRevision = 0
	const samples = createActor(sampleMachine)
	const sampleSnapshot = readable(samples.getSnapshot(), (set) => {
		const subscription = samples.subscribe(set)
		return () => subscription.unsubscribe()
	})
	samples.start()
	onDestroy(() => {
		if (samples.getSnapshot().status !== 'active') {
			samples.stop()
			return
		}
		const subscription = samples.subscribe({
			complete: () => {
				subscription.unsubscribe()
				samples.stop()
			},
			error: () => {
				subscription.unsubscribe()
				samples.stop()
			}
		})
		samples.send({ type: 'SHUTDOWN' })
	})
	$effect(() => {
		const scope = currentSampleScope()
		const facts = sampleObservation()
		observationRevision += 1
		if (batchScope && batchScope !== scope) samples.send({ type: 'INVALIDATE' })
		else samples.send({ type: 'OBSERVE', observation: { revision: observationRevision, facts } })
	})

	$effect(() => {
		developerMenu[kind] = {
			busy:
				$sampleSnapshot.matches('saving') ||
				$sampleSnapshot.matches('preparing') ||
				$sampleSnapshot.matches('next'),
			saved: $sampleSnapshot.context.saved,
			failed: $sampleSnapshot.matches('failure') || $sampleSnapshot.matches('partial'),
			onadd: () => {
				batchScope = currentSampleScope()
				samples.send({ type: 'ADD' })
			}
		}
		return () => {
			developerMenu[kind] = unavailableSampleControls()
		}
	})
</script>
