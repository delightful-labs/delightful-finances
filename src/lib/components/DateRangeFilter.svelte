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
	label={m['labels.start_subject']({ subject: m['nouns.date']({ count: 1 }) })}
	value={start}
	max={end}
	oninput={(event) => onchange(event.currentTarget.value, end)}
/>
<InputDate
	label={m['labels.end_subject']({ subject: m['nouns.date']({ count: 1 }) })}
	value={end}
	min={start}
	oninput={(event) => onchange(start, event.currentTarget.value)}
/>
{#each [7, 30] as days (days)}
	<Button onclick={() => onpreset(days)}
		>{m['labels.last_count_subjects']({
			count: days,
			subjects: m['nouns.day']({ count: days })
		})}</Button
	>
{/each}
