import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import {
	nativeTextReplySchema,
	type NativeTextReference
} from '../../contracts/native-text-transfer.js'
import { nativeTextStoreMachine, resolveNativeText } from './native-text-store.js'

const requestId = '550e8400-e29b-41d4-a716-446655440000'
function fixture() {
	let source = 'a'.repeat(4095) + '😀' + 'b'.repeat(5000)
	let allowed = true
	const actor = createActor(nativeTextStoreMachine, {
		input: {
			textScope: 'test',
			source: () => source,
			canRead: () => allowed,
			canWrite: () => allowed
		}
	}).start()
	return {
		actor,
		source,
		changeSource: () => {
			source = 'changed'
		},
		revoke: () => {
			allowed = false
		}
	}
}
function upload(actor: ReturnType<typeof fixture>['actor'], text: string): NativeTextReference {
	actor.send({ type: 'COMMAND', command: { type: 'START', requestId, field: 'memo' } })
	let index = 0
	for (let offset = 0; offset < text.length; offset += 4096) {
		actor.send({
			type: 'COMMAND',
			command: { type: 'CHUNK', requestId, index: index++, text: text.slice(offset, offset + 4096) }
		})
	}
	actor.send({ type: 'COMMAND', command: { type: 'COMMIT', requestId, parts: index } })
	const reply = nativeTextReplySchema.parse(actor.getSnapshot().context.reply)
	expect(reply.status).toBe('ready')
	if (!reply.reference) throw new Error('Missing committed reference')
	return {
		kind: 'text',
		textScope: reply.textScope,
		reference: reply.reference,
		version: reply.version
	}
}
describe('private native text transport', () => {
	it('captures an immutable read and preserves surrogate pairs across bounded chunks', () => {
		const f = fixture()
		f.actor.send({ type: 'COMMAND', command: { type: 'READ', requestId, field: 'memo' } })
		f.changeSource()
		let text = ''
		for (;;) {
			const reply = nativeTextReplySchema.parse(f.actor.getSnapshot().context.reply)
			expect(reply.text.length).toBeLessThanOrEqual(4096)
			text += reply.text
			if (reply.done) break
			f.actor.send({ type: 'COMMAND', command: { type: 'NEXT', requestId, offset: text.length } })
		}
		expect(text).toBe(f.source)
		expect(f.actor.getSnapshot().context.read).toBeUndefined()
		f.actor.stop()
	})
	it('commits privately and rejects stale references even when a request ID is reused', () => {
		const { actor } = fixture()
		const old = upload(actor, 'x'.repeat(20000))
		expect(resolveNativeText(actor.getSnapshot(), 'memo', old)).toHaveLength(20000)
		const next = upload(actor, 'replacement')
		expect(resolveNativeText(actor.getSnapshot(), 'memo', old)).toBeUndefined()
		expect(resolveNativeText(actor.getSnapshot(), 'description', next)).toBeUndefined()
		expect(resolveNativeText(actor.getSnapshot(), 'memo', next)).toBe('replacement')
		actor.send({ type: 'RESET' })
		const reset = upload(actor, 'after reset')
		expect(reset.version).toBeGreaterThan(next.version)
		expect(resolveNativeText(actor.getSnapshot(), 'memo', next)).toBeUndefined()
		actor.send({ type: 'SHUTDOWN' })
		expect(resolveNativeText(actor.getSnapshot(), 'memo', reset)).toBeUndefined()
		expect(actor.getSnapshot().output).toEqual({ outcome: 'released' })
	})
	it.each(['cancel', 'out of order', 'revoked'])(
		'discards %s staging without overwriting the committed draft',
		(failure) => {
			const f = fixture()
			const reference = upload(f.actor, 'original')
			f.actor.send({ type: 'COMMAND', command: { type: 'START', requestId, field: 'memo' } })
			f.actor.send({
				type: 'COMMAND',
				command: { type: 'CHUNK', requestId, index: 0, text: 'incomplete' }
			})
			if (failure === 'cancel')
				f.actor.send({ type: 'COMMAND', command: { type: 'CANCEL', requestId } })
			if (failure === 'out of order')
				f.actor.send({
					type: 'COMMAND',
					command: { type: 'CHUNK', requestId, index: 2, text: 'invalid' }
				})
			if (failure === 'revoked') {
				f.revoke()
				f.actor.send({ type: 'COMMAND', command: { type: 'COMMIT', requestId, parts: 1 } })
			}
			expect(f.actor.getSnapshot().matches('available')).toBe(true)
			expect(f.actor.getSnapshot().context.pieces).toBeUndefined()
			expect(resolveNativeText(f.actor.getSnapshot(), 'memo', reference)).toBe('original')
			f.actor.stop()
		}
	)
	it('revokes a read before exposing another chunk', () => {
		const f = fixture()
		f.actor.send({ type: 'COMMAND', command: { type: 'READ', requestId, field: 'memo' } })
		f.revoke()
		f.actor.send({ type: 'COMMAND', command: { type: 'NEXT', requestId, offset: 4096 } })
		expect(f.actor.getSnapshot().context.reply?.status).toBe('unavailable')
		expect(f.actor.getSnapshot().context.reply?.text).toBe('')
		expect(f.actor.getSnapshot().context.read).toBeUndefined()
		f.actor.stop()
	})
})
