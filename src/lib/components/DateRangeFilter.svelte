<script lang="ts">
	import { Button, InputDate } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		start,
		end,
		onchange,
		onpreset
	}: {
		start: string
		end: string
		onchange: (start: string, end: string) => void
		onpreset: (days: number) => void
	} = $props()
</script>

<InputDate
	label={m['overview_expenses.start']()}
	value={start}
	max={end}
	oninput={(event) => onchange(event.currentTarget.value, end)}
/>
<InputDate
	label={m['overview_expenses.end']()}
	value={end}
	min={start}
	oninput={(event) => onchange(start, event.currentTarget.value)}
/>
<Button onclick={() => onpreset(7)}>{m['overview_expenses.last7']()}</Button>
<Button onclick={() => onpreset(30)}>{m['overview_expenses.last30']()}</Button>
