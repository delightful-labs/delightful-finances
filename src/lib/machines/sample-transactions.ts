import { assign, fromPromise, setup } from 'xstate'

// One local write per invocation. Leaving the screen stops subsequent writes;
// an already issued local transaction can still finish.
type Input = { create: (index: number) => Promise<void> }
type Context = Input & { saved: number }
const write = fromPromise<void, Input & { index: number }>(({ input }) => input.create(input.index))
export const sampleTransactionsMachine = setup<
	Context,
	{ type: 'ADD' } | { type: 'CANCEL' },
	{ write: typeof write },
	{},
	{},
	{},
	never,
	string,
	Input
>({ actors: { write } }).createMachine({
	context: ({ input }) => ({ saved: 0, create: input.create }),
	initial: 'idle',
	states: {
		idle: { on: { ADD: { target: 'saving', actions: assign({ saved: 0 }) } } },
		saving: {
			on: { CANCEL: 'cancelled' },
			invoke: {
				src: 'write',
				input: ({ context }) => ({ create: context.create, index: context.saved }),
				onDone: { target: 'next', actions: assign({ saved: ({ context }) => context.saved + 1 }) },
				onError: [
					{ guard: ({ context }) => context.saved > 0, target: 'partial' },
					{ target: 'failure' }
				]
			}
		},
		next: {
			always: [
				{ guard: ({ context }) => context.saved === 25, target: 'complete' },
				{ target: 'saving' }
			]
		},
		complete: { on: { ADD: { target: 'saving', actions: assign({ saved: 0 }) } } },
		partial: { on: { ADD: { target: 'saving', actions: assign({ saved: 0 }) } } },
		failure: { on: { ADD: 'saving' } },
		cancelled: { type: 'final' }
	}
})
