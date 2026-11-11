<script lang="ts">
	import WorkerTransactionEntry from '#lib/components/transactions/WorkerTransactionEntry.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()
</script>

<WorkerTransactionEntry {navigation} />
