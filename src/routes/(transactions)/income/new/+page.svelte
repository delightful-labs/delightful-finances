<script lang="ts">
	import { INCOME } from '#lib/domain/transaction-kind.js'
	import TransactionEntry from '#lib/components/TransactionEntry.svelte'
</script>

<TransactionEntry kind={INCOME} />
