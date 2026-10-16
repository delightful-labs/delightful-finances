import { setup } from 'xstate'

type OrderEvent =
	| { type: 'EDIT' }
	| { type: 'DONE' }
	| { type: 'RESET'; ids: readonly string[] }
	| { type: 'OBSERVE'; ids: readonly string[] }
	| { type: 'MOVE'; id: string; direction: 'up' | 'down' }

export function orderAccounts<T extends { id: string }>(
	accounts: readonly T[],
	ids: readonly string[]
): T[] {
	const positions = new Map(ids.map((id, index) => [id, index]))
	return [...accounts].sort(
		(left, right) =>
			(positions.get(left.id) ?? ids.length) - (positions.get(right.id) ?? ids.length)
	)
}

const order = setup<{ ids: readonly string[] }, OrderEvent>({})
const observe = order.assign(({ event }) =>
	event.type === 'RESET' || event.type === 'OBSERVE' ? { ids: event.ids } : {}
)
const canMove = ({
	context,
	event
}: {
	context: { ids: readonly string[] }
	event: OrderEvent
}) => {
	if (event.type !== 'MOVE') return false
	const index = context.ids.indexOf(event.id)
	return event.direction === 'up' ? index > 0 : index >= 0 && index < context.ids.length - 1
}
const move = order.assign(({ context, event }) => {
	if (event.type !== 'MOVE') return {}
	const ids = [...context.ids]
	const index = ids.indexOf(event.id)
	const destination = index + (event.direction === 'up' ? -1 : 1)
	ids.splice(index, 1)
	ids.splice(destination, 0, event.id)
	return { ids }
})

export const accountOrderMachine = order.createMachine({
	id: 'account-order',
	initial: 'viewing',
	context: { ids: [] },
	on: {
		RESET: { target: '.viewing', actions: observe },
		OBSERVE: { actions: observe }
	},
	states: {
		viewing: { on: { EDIT: 'editing' } },
		editing: {
			on: {
				DONE: 'viewing',
				MOVE: { guard: canMove, actions: move }
			}
		}
	}
})
