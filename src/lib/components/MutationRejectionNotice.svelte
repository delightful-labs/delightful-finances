<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import { Button } from 'delightful-ui'
	import type { MutationNotice } from '#lib/machines/application-readiness.js'

	let { notice, onDismiss }: { notice: MutationNotice | undefined; onDismiss: () => void } =
		$props()
</script>

<p role="status" aria-live="polite" aria-atomic="true">
	{#if notice}
		{notice.kind === 'generic'
			? m['sync.mutation_rejected']()
			: notice.operation === 'link'
				? m['sync.transfer_link_rejected']()
				: m['sync.transfer_unlink_rejected']()}
		<Button type="button" onclick={onDismiss}>{m['actions.dismiss']()}</Button>
	{/if}
</p>
