import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { nativeTextIoMachine } from './native-text-io.js'
import { nativeTextStoreMachine, resolveNativeText } from './native-text-store.js'
import type { NativeTextCommand, NativeTextReply } from '../../contracts/native-text-transfer.js'
const requestId = '550e8400-e29b-41d4-a716-446655440000'
function fixture(source = '') {
	const store = createActor(nativeTextStoreMachine, {
		input: { textScope: 'test', source: () => source, canRead: () => true, canWrite: () => true }
	}).start()
	const commands: NativeTextCommand[] = []
	const exchange = vi.fn(async (command: NativeTextCommand, _signal: AbortSignal) => {
		commands.push(command)
		store.send({ type: 'COMMAND', command })
		return store.getSnapshot().context.reply
	})
	return { store, commands, exchange }
}
it.each(['', 'a'.repeat(4095) + '😀' + 'z'.repeat(12000)])(
	'reads full native text through bounded sequential exchanges',
	async (source) => {
		const f = fixture(source)
		const actor = createActor(nativeTextIoMachine, {
			input: { requestId, field: 'memo', request: { kind: 'read' }, exchange: f.exchange }
		}).start()
		expect(await toPromise(actor)).toEqual({ outcome: 'read', text: source })
		expect(f.commands[0]?.type).toBe('READ')
		expect(f.commands.every((command) => command.type === 'READ' || command.type === 'NEXT')).toBe(
			true
		)
		f.store.stop()
	}
)
it.each(['', 'a'.repeat(4095) + '😀' + 'z'.repeat(12000)])(
	'uploads native text and returns only a field reference',
	async (text) => {
		const f = fixture()
		const actor = createActor(nativeTextIoMachine, {
			input: { requestId, field: 'memo', request: { kind: 'write', text }, exchange: f.exchange }
		}).start()
		const result = await toPromise(actor)
		expect(result.outcome).toBe('written')
		if (result.outcome !== 'written') throw new Error('Missing text reference')
		expect(resolveNativeText(f.store.getSnapshot(), 'memo', result.reference)).toBe(text)
		expect(
			f.commands
				.filter((command) => command.type === 'CHUNK')
				.every((command) => command.text.length <= 4096)
		).toBe(true)
		expect(f.commands.at(-1)?.type).toBe('COMMIT')
		f.store.stop()
	}
)
it('cancels an outstanding native exchange and ignores its late reply', async () => {
	const f = fixture()
	const held = Promise.withResolvers<NativeTextReply | undefined>()
	let signal: AbortSignal | undefined
	const exchange = (command: NativeTextCommand, currentSignal: AbortSignal) => {
		if (command.type !== 'CHUNK') return f.exchange(command, currentSignal)
		signal = currentSignal
		f.store.send({ type: 'COMMAND', command })
		return held.promise
	}
	const actor = createActor(nativeTextIoMachine, {
		input: { requestId, field: 'memo', request: { kind: 'write', text: 'private' }, exchange }
	}).start()
	await waitFor(actor, (snapshot) => snapshot.matches('writing'))
	actor.send({ type: 'CANCEL' })
	expect(await toPromise(actor)).toEqual({ outcome: 'cancelled' })
	expect(signal?.aborted).toBe(true)
	expect(f.store.getSnapshot().context.pieces).toBeUndefined()
	held.resolve(f.store.getSnapshot().context.reply)
	await Promise.resolve()
	expect(actor.getSnapshot().output).toEqual({ outcome: 'cancelled' })
	expect(f.store.getSnapshot().context.documents).toEqual({})
	f.store.stop()
})
it('rejects a wrong-field reply and cancels staging instead of publishing a reference', async () => {
	const f = fixture()
	const actor = createActor(nativeTextIoMachine, {
		input: {
			requestId,
			field: 'memo',
			request: { kind: 'write', text: 'private' },
			exchange: async (command, signal) => {
				const reply = await f.exchange(command, signal)
				return reply ? { ...reply, field: 'description' } : undefined
			}
		}
	}).start()
	expect(await toPromise(actor)).toEqual({ outcome: 'unavailable' })
	expect(f.store.getSnapshot().context.pieces).toBeUndefined()
	expect(f.commands.at(-1)?.type).toBe('CANCEL')
	f.store.stop()
})
