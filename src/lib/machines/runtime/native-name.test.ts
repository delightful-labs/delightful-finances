import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import {
	nativeNameOwnerMachine,
	resolveNativeName,
	selectNativeNameReply
} from './native-name-owner.js'
import {
	nativeNameInputMachine,
	selectNativeNameInput,
	type NativeNameValue
} from './native-name-input.js'
import type {
	NativeTextCommand,
	NativeTextReference,
	NativeTextReply
} from '../../contracts/native-text-transfer.js'
const requestId = '550e8400-e29b-41d4-a716-446655440000'
function fixture() {
	let revision = 0,
		allowed = true,
		initialized = false
	const owner = createActor(nativeNameOwnerMachine, {
		input: {
			textScope: 'account/lease',
			revision: () => {
				if (!initialized) throw new Error('Sibling is not initialized')
				return revision
			},
			canWrite: () => allowed
		}
	}).start()
	initialized = true
	const exchange = vi.fn(async (command: NativeTextCommand, _signal: AbortSignal) => {
		const before = selectNativeNameReply(owner.getSnapshot())
		owner.send({ type: 'TEXT', draftRevision: revision, command })
		const after = selectNativeNameReply(owner.getSnapshot())
		return after !== before ? after : undefined
	})
	return {
		owner,
		exchange,
		advance: () => revision++,
		revoke: () => {
			allowed = false
		}
	}
}
async function prepared(f: ReturnType<typeof fixture>, name: string) {
	const deliver = vi.fn<(value: NativeNameValue) => void>()
	const actor = createActor(nativeNameInputMachine, {
		input: { requestId, exchange: f.exchange }
	}).start()
	actor.send({ type: 'PREPARE', name, deliver })
	await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce())
	const result = deliver.mock.calls[0]?.[0]
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	return result
}
it('defers sibling access and forwards short raw names without applying canonical normalization', async () => {
	const f = fixture()
	expect(await prepared(f, '  raw Name  ')).toBe('  raw Name  ')
	expect(f.exchange).not.toHaveBeenCalled()
	f.owner.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.owner)).toEqual({ outcome: 'released' })
})
it('preserves a full long name and rejects references after a revision change or explicit reset', async () => {
	const f = fixture(),
		name = 'a'.repeat(4095) + '😀' + 'tail'.repeat(2000)
	const reference = await prepared(f, name)
	if (!reference || typeof reference === 'string') throw new Error('Missing name reference')
	expect(resolveNativeName(f.owner.getSnapshot(), reference)).toBe(name)
	f.advance()
	expect(resolveNativeName(f.owner.getSnapshot(), reference)).toBeUndefined()
	const replacement = await prepared(f, 'replacement'.repeat(1000))
	if (!replacement || typeof replacement === 'string')
		throw new Error('Missing replacement reference')
	expect(replacement.version).toBeGreaterThan(reference.version)
	expect(resolveNativeName(f.owner.getSnapshot(), reference)).toBeUndefined()
	f.owner.send({ type: 'RESET' })
	expect(resolveNativeName(f.owner.getSnapshot(), replacement)).toBeUndefined()
	f.owner.send({ type: 'SHUTDOWN' })
	await toPromise(f.owner)
})
it('rejects stale revisions and another form namespace before revealing a private name', async () => {
	const f = fixture()
	const reference = await prepared(f, 'private'.repeat(1000))
	if (!reference || typeof reference === 'string') throw new Error('Missing reference')
	const foreign: NativeTextReference = { ...reference, textScope: 'category/lease' }
	expect(resolveNativeName(f.owner.getSnapshot(), foreign)).toBeUndefined()
	f.advance()
	f.owner.send({
		type: 'TEXT',
		draftRevision: 0,
		command: { type: 'READ', requestId, field: 'name' }
	})
	expect(selectNativeNameReply(f.owner.getSnapshot())).toBeUndefined()
	f.owner.send({ type: 'SHUTDOWN' })
	await toPromise(f.owner)
})
it('does not forward a name after write authority is revoked mid-transfer', async () => {
	const f = fixture(),
		deliver = vi.fn()
	const exchange = async (command: NativeTextCommand, signal: AbortSignal) => {
		if (command.type === 'CHUNK') f.revoke()
		return f.exchange(command, signal)
	}
	const actor = createActor(nativeNameInputMachine, { input: { requestId, exchange } }).start()
	actor.send({ type: 'PREPARE', name: 'private'.repeat(1000), deliver })
	await waitFor(actor, (snapshot) => snapshot.matches('failed'))
	expect(selectNativeNameInput(actor.getSnapshot())).toEqual({ busy: false, failed: true })
	expect(deliver).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	f.owner.send({ type: 'SHUTDOWN' })
	await toPromise(f.owner)
})
it('retains native cancellation and its immutable capture until the child actually settles', async () => {
	const f = fixture(),
		deliver = vi.fn(),
		late = vi.fn()
	const held = Promise.withResolvers<NativeTextReply | undefined>(),
		cancelled = Promise.withResolvers<NativeTextReply | undefined>()
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
	const actor = createActor(nativeNameInputMachine, { input: { requestId, exchange } }).start()
	actor.send({ type: 'PREPARE', name: 'first'.repeat(2000), deliver })
	await vi.waitFor(() => expect(signal).toBeDefined())
	actor.send({ type: 'PREPARE', name: 'late replacement', deliver: late })
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().matches({ transferring: 'closing' })).toBe(true)
	expect(signal?.aborted).toBe(true)
	await vi.waitFor(() => expect(f.exchange.mock.calls.at(-1)?.[0].type).toBe('CANCEL'))
	cancelled.resolve(selectNativeNameReply(f.owner.getSnapshot()))
	expect(await toPromise(actor)).toEqual({ outcome: 'released' })
	expect(deliver).not.toHaveBeenCalled()
	expect(late).not.toHaveBeenCalled()
	held.resolve(undefined)
	f.owner.send({ type: 'SHUTDOWN' })
	await toPromise(f.owner)
})
