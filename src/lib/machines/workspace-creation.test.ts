import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, setup, assign, type AnyActorRef } from 'xstate'
import type {
	CreationBinding,
	CreationRequest,
	CreationResult
} from './workspace-creation-operation.js'
import { createWorkspaceCreationMachine } from './workspace-creation.js'
import { attempt, creationFixture, userId, profileId } from './workspace-creation.fixture.js'
const { started, interrupted } = vi.hoisted(() => ({ started: vi.fn(), interrupted: vi.fn() }))
vi.mock('./workspace-creation-operation.js', () => ({
	workspaceCreationOperation: setup<
		{ result: CreationResult },
		{ type: 'FINISH'; result: CreationResult } | { type: 'SHUTDOWN' | 'CANCEL' },
		{},
		{},
		{},
		{},
		never,
		string,
		{ binding: CreationBinding; request: CreationRequest },
		CreationResult
	>({}).createMachine({
		initial: 'waiting',
		context: ({ input }) => {
			started(input)
			return { result: result('editing') }
		},
		output: ({ context }) => context.result,
		states: {
			waiting: {
				on: {
					SHUTDOWN: { actions: interrupted },
					CANCEL: { actions: interrupted },
					FINISH: { target: 'done', actions: assign({ result: ({ event }) => event.result }) }
				}
			},
			done: { type: 'final' }
		}
	})
}))
const actors: { stop: () => void }[] = []
afterEach(() => {
	actors.splice(0).forEach((actor) => actor.stop())
	vi.clearAllMocks()
})
const binding = { key: 'environment/user', userId, profileId }
const record = { key: binding.key, attempt }
function result(outcome: CreationResult['outcome'], withRecord = false): CreationResult {
	return {
		outcome,
		record: withRecord ? record : undefined,
		workspace: undefined,
		settlement: 'notStarted',
		error: undefined
	}
}
function start() {
	const f = creationFixture()
	const actor = createActor(createWorkspaceCreationMachine(f.db), { input: { binding } }).start()
	actors.push(actor)
	return actor
}
function finish(actor: ReturnType<typeof start>, value: CreationResult) {
	const child: AnyActorRef | undefined = actor.getSnapshot().children.operation
	if (!child) throw new Error('Expected operation')
	child.send({ type: 'FINISH', result: value })
}
describe('workspace creation owner', () => {
	it('ignores double submit and does not replay a recovered attempt on load', () => {
		const actor = start()
		actor.send({ type: 'SUBMIT', name: 'Ignored during load' })
		expect(started).toHaveBeenCalledTimes(1)
		finish(actor, result('recovered', true))
		actor.send({ type: 'OBSERVED', binding: { ...binding } })
		expect(actor.getSnapshot().matches('recovered')).toBe(true)
		expect(started).toHaveBeenCalledTimes(1)
		actor.send({ type: 'RETRY' })
		expect(started.mock.lastCall?.[0].request).toEqual({ mode: 'retry', record })
	})
	it('waits for original resources before replacing identity and uses the latest observation', () => {
		const actor = start()
		actor.send({ type: 'OBSERVED', binding: { ...binding, key: 'second' } })
		actor.send({ type: 'OBSERVED', binding: { ...binding, key: 'third' } })
		expect(actor.getSnapshot().matches({ operating: 'replacing' })).toBe(true)
		expect(started).toHaveBeenCalledTimes(1)
		finish(actor, result('closed', true))
		expect(started).toHaveBeenCalledTimes(2)
		expect(started.mock.lastCall?.[0].binding.key).toBe('third')
	})
	it('preserves shutdown over late binding changes and retries', () => {
		const actor = start()
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'OBSERVED', binding: { ...binding, key: 'late' } })
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().status).toBe('active')
		finish(actor, result('closed'))
		expect(actor.getSnapshot().status).toBe('done')
		expect(started).toHaveBeenCalledTimes(1)
	})
	it('rereads a journal after cancelled loading or a conflict retry', () => {
		const actor = start()
		actor.send({ type: 'CANCEL' })
		finish(actor, result('cancelled'))
		expect(started).toHaveBeenCalledTimes(2)
		expect(started.mock.lastCall?.[0].request).toEqual({ mode: 'load' })
		finish(actor, result('conflict', true))
		actor.send({ type: 'RETRY' })
		expect(started.mock.lastCall?.[0].request).toEqual({ mode: 'load' })
	})
	it('requires an explicit new action after completion', () => {
		const actor = start()
		finish(actor, result('complete', true))
		actor.send({ type: 'SUBMIT', name: 'Ignored after success' })
		expect(started).toHaveBeenCalledTimes(1)
		actor.send({ type: 'NEW' })
		expect(started.mock.lastCall?.[0].request).toEqual({ mode: 'clear', record })
	})
})
