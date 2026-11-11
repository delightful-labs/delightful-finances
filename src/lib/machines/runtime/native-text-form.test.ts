import { expect, it, vi } from 'vitest'
import { createActor, waitFor, toPromise } from 'xstate'
import {
	nativeTextFormMachine,
	selectNativeTextForm,
	type NativeFormDraft
} from './native-text-form.js'
import { nativeTextStoreMachine, resolveNativeText } from './native-text-store.js'
import { resolveNativeTextDraft } from '../../contracts/native-text-draft.js'
import type { NativeTextCommand, NativeTextReply } from '../../contracts/native-text-transfer.js'
import { transactionRouteCommandSchema } from '../../runtime/worker/transaction-route-protocol.js'

const requestId = '550e8400-e29b-41d4-a716-446655440000'
function fixture() {
	const store = createActor(nativeTextStoreMachine, {
		input: {
			textScope: 'fixture',
			source: () => 'legacy '.repeat(1000),
			canRead: () => true,
			canWrite: () => true
		}
	}).start()
	const exchange = vi.fn(async (command: NativeTextCommand, _signal: AbortSignal) => {
		store.send({ type: 'COMMAND', command })
		return store.getSnapshot().context.reply
	})
	const loaded = vi.fn(),
		failed = vi.fn()
	const delivered: { command: NativeFormDraft; values: unknown }[] = []
	const deliver = (command: NativeFormDraft) => {
		transactionRouteCommandSchema.parse(command)
		const result = resolveNativeTextDraft(
			command.values,
			['description', 'memo', 'checkNumber'],
			(field, reference) => resolveNativeText(store.getSnapshot(), field, reference)
		)
		if (result.kind !== 'valid') throw new Error('Invalid prepared native draft')
		delivered.push({ command, values: result.values })
	}
	return { store, exchange, loaded, failed, deliver, delivered }
}
it('loads full native input values and prepares every long field before dispatching submit', async () => {
	const f = fixture()
	const actor = createActor(nativeTextFormMachine, {
		input: {
			requestId,
			readFields: ['description', 'memo'],
			exchange: f.exchange,
			loaded: f.loaded,
			failed: f.failed,
			deliver: f.deliver
		}
	}).start()
	await waitFor(actor, (snapshot) => snapshot.matches('idle'))
	expect(f.loaded.mock.calls).toEqual([
		['description', 'legacy '.repeat(1000)],
		['memo', 'legacy '.repeat(1000)]
	])
	const values = {
		description: 'description '.repeat(1000),
		memo: 'memo '.repeat(1000),
		checkNumber: 'check'.repeat(2000),
		amount: '1.23'
	}
	actor.send({ type: 'DRAFT', replaceable: false, command: { type: 'SUBMIT', values } })
	await vi.waitFor(() => expect(f.delivered).toHaveLength(1))
	expect(f.delivered[0]?.values).toEqual(values)
	expect(f.failed).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(actor)).toEqual({ outcome: 'released' })
	f.store.stop()
})
it('coalesces replaceable native drafts, preserves ordered tag edits, and flushes an immutable submit', async () => {
	const f = fixture()
	const held = Promise.withResolvers<NativeTextReply | undefined>()
	let first: NativeTextReply | undefined
	let holding = true
	const exchange = async (command: NativeTextCommand, signal: AbortSignal) => {
		const reply = await f.exchange(command, signal)
		if (holding && command.type === 'CHUNK') {
			holding = false
			first = reply
			return held.promise
		}
		return reply
	}
	const actor = createActor(nativeTextFormMachine, {
		input: {
			requestId,
			readFields: [],
			exchange,
			loaded: f.loaded,
			failed: f.failed,
			deliver: f.deliver
		}
	}).start()
	actor.send({
		type: 'DRAFT',
		replaceable: true,
		command: { type: 'CHANGE', values: { memo: 'first '.repeat(1000) } }
	})
	await vi.waitFor(() => expect(first).toBeDefined())
	actor.send({
		type: 'DRAFT',
		replaceable: false,
		command: { type: 'CHANGE', values: { tagEdit: { id: requestId, selected: false } } }
	})
	actor.send({
		type: 'DRAFT',
		replaceable: true,
		command: { type: 'CHANGE', values: { memo: 'obsolete' } }
	})
	actor.send({
		type: 'DRAFT',
		replaceable: true,
		command: { type: 'CHANGE', values: { memo: 'latest '.repeat(1000) } }
	})
	const submitted = { memo: 'submitted '.repeat(1000), amount: '1.23' }
	actor.send({ type: 'DRAFT', replaceable: false, command: { type: 'SUBMIT', values: submitted } })
	actor.send({
		type: 'DRAFT',
		replaceable: true,
		command: { type: 'CHANGE', values: { memo: 'late' } }
	})
	expect(selectNativeTextForm(actor.getSnapshot()).blocked).toBe(true)
	held.resolve(first)
	await vi.waitFor(() => expect(f.delivered).toHaveLength(4))
	expect(f.delivered.map((item) => item.values)).toEqual([
		{ memo: 'first '.repeat(1000) },
		{ tagEdit: { id: requestId, selected: false } },
		{ memo: 'latest '.repeat(1000) },
		submitted
	])
	expect(f.delivered.at(-1)?.command.type).toBe('SUBMIT')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	f.store.stop()
})
it('joins native cancellation before releasing and never dispatches queued financial intent', async () => {
	const f = fixture()
	const held = Promise.withResolvers<NativeTextReply | undefined>()
	const cancelled = Promise.withResolvers<NativeTextReply | undefined>()
	let signal: AbortSignal | undefined
	const exchange = async (command: NativeTextCommand, currentSignal: AbortSignal) => {
		const reply = await f.exchange(command, currentSignal)
		if (command.type === 'CHUNK') {
			signal = currentSignal
			return held.promise
		}
		if (command.type === 'CANCEL') return cancelled.promise
		return reply
	}
	const actor = createActor(nativeTextFormMachine, {
		input: {
			requestId,
			readFields: [],
			exchange,
			loaded: f.loaded,
			failed: f.failed,
			deliver: f.deliver
		}
	}).start()
	actor.send({
		type: 'DRAFT',
		replaceable: false,
		command: { type: 'SUBMIT', values: { memo: 'private '.repeat(1000) } }
	})
	await vi.waitFor(() => expect(signal).toBeDefined())
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().matches({ transferring: 'closing' })).toBe(true)
	expect(actor.getSnapshot().status).toBe('active')
	expect(signal?.aborted).toBe(true)
	await vi.waitFor(() => expect(f.store.getSnapshot().context.pieces).toBeUndefined())
	cancelled.resolve(f.store.getSnapshot().context.reply)
	expect(await toPromise(actor)).toEqual({ outcome: 'released' })
	expect(f.delivered).toEqual([])
	held.resolve(undefined)
	f.store.stop()
})

it('keeps form intent fenced after a transfer failure and reloads native fields on explicit retry', async () => {
	const f = fixture()
	let failRead = true
	const exchange = async (command: NativeTextCommand, signal: AbortSignal) => {
		if (command.type === 'READ' && failRead) {
			failRead = false
			return undefined
		}
		return f.exchange(command, signal)
	}
	const actor = createActor(nativeTextFormMachine, {
		input: {
			requestId,
			readFields: ['memo'],
			exchange,
			loaded: f.loaded,
			failed: f.failed,
			deliver: f.deliver
		}
	}).start()
	await waitFor(actor, (snapshot) => snapshot.matches('failed'))
	expect(selectNativeTextForm(actor.getSnapshot()).blocked).toBe(true)
	expect(f.failed).toHaveBeenCalledOnce()
	actor.send({
		type: 'DRAFT',
		replaceable: false,
		command: { type: 'SUBMIT', values: { memo: 'not admitted' } }
	})
	expect(f.delivered).toEqual([])
	actor.send({ type: 'RETRY' })
	await waitFor(actor, (snapshot) => snapshot.matches('idle'))
	expect(f.loaded).toHaveBeenCalledWith('memo', 'legacy '.repeat(1000))
	actor.send({
		type: 'DRAFT',
		replaceable: false,
		command: { type: 'SUBMIT', values: { memo: 'explicit retry draft' } }
	})
	expect(f.delivered.map((item) => item.values)).toEqual([{ memo: 'explicit retry draft' }])
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	f.store.stop()
})
