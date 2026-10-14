<script lang="ts">
	let { message, role }: { message: string; role?: 'alert' | 'status' } = $props()
</script>

<p {role}>{message}</p>
