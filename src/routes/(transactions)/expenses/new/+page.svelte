<script lang="ts">
	import { EXPENSE } from '#lib/domain/transaction-kind.js'
	import TransactionEntry from '#lib/components/TransactionEntry.svelte'
</script>

<TransactionEntry kind={EXPENSE} />
