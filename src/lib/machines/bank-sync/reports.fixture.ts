import { createActor, fromTransition, type EventObject } from 'xstate'
import { bankAvailabilityMachine, type AvailabilityEvent } from './availability.js'
import type { BankSource } from './types.js'

export function collectReports<Event extends EventObject>() {
	return createActor(
		fromTransition((events: Event[], event: Event) => [...events, event], [])
	).start()
}

export function availabilityReport(source: BankSource, generation: number) {
	const recipient = collectReports<AvailabilityEvent>()
	const actor = createActor(bankAvailabilityMachine, {
		input: { ...source, generation, recipient }
	}).start()
	const report = recipient.getSnapshot().context.at(-1)?.report
	actor.stop()
	recipient.stop()
	if (!report) throw new Error('Expected availability report')
	return report
}
