<script lang="ts">
	import WorkerOverview from '#lib/components/reports/WorkerOverview.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()
</script>

<WorkerOverview {navigation} />
