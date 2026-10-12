import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { z } from 'zod'
import { createFormMachine, type FormSave } from './form.js'

const schema = z.object({ name: z.string().trim().min(1) })
const context = { id: 'workspace' }

describe('form machine', () => {
	it('validates and transforms fields before saving with context and an abort signal', async () => {
		const save = vi.fn(async () => 'saved')
		const actor = createActor(createFormMachine(schema, save, context)).start()
		try {
			actor.send({ type: 'SUBMIT', values: { name: '  Home  ' } })
			const state = await waitFor(actor, (state) => state.matches('success'))
			expect(save).toHaveBeenCalledExactlyOnceWith(
				{ name: 'Home' },
				{ context, signal: expect.any(AbortSignal) }
			)
			expect(state.context.result).toBe('saved')
			expect(state.hasTag('busy')).toBe(false)
		} finally {
			actor.stop()
		}
	})

	it('does not save invalid fields and allows a corrected submission', async () => {
		const save = vi.fn(async () => 'saved')
		const actor = createActor(createFormMachine(schema, save, context)).start()
		try {
			actor.send({ type: 'SUBMIT', values: { name: ' ' } })
			const invalid = await waitFor(actor, (state) => state.matches('invalid'))
			expect(invalid.context.error).toBeInstanceOf(z.ZodError)
			expect(save).not.toHaveBeenCalled()
			actor.send({ type: 'SUBMIT', values: { name: 'Home' } })
			const success = await waitFor(actor, (state) => state.matches('success'))
			expect(success.context.error).toBeNull()
			expect(save).toHaveBeenCalledTimes(1)
		} finally {
			actor.stop()
		}
	})

	it('exposes save failures and allows retry', async () => {
		const error = new Error('Write failed')
		const save = vi.fn(async () => 'saved').mockRejectedValueOnce(error)
		const actor = createActor(createFormMachine(schema, save, context)).start()
		try {
			actor.send({ type: 'SUBMIT', values: { name: 'Home' } })
			const failed = await waitFor(actor, (state) => state.matches('error'))
			expect(failed.context.error).toBe(error)
			actor.send({ type: 'SUBMIT', values: { name: 'Work' } })
			const success = await waitFor(actor, (state) => state.matches('success'))
			expect(success.context.error).toBeNull()
			expect(save).toHaveBeenCalledTimes(2)
		} finally {
			actor.stop()
		}
	})

	it('ignores submissions and resets while validating or saving', async () => {
		const pending = Promise.withResolvers<string>()
		const save = vi.fn<FormSave<z.output<typeof schema>, string, typeof context>>(
			() => pending.promise
		)
		const actor = createActor(createFormMachine(schema, save, context)).start()
		try {
			actor.send({ type: 'SUBMIT', values: { name: 'Home' } })
			expect(actor.getSnapshot().matches('validating')).toBe(true)
			expect(actor.getSnapshot().hasTag('busy')).toBe(true)
			actor.send({ type: 'RESET' })
			actor.send({ type: 'SUBMIT', values: { name: 'Ignored' } })
			await waitFor(actor, (state) => state.matches('saving'))
			actor.send({ type: 'RESET' })
			actor.send({ type: 'SUBMIT', values: { name: 'Also ignored' } })
			expect(actor.getSnapshot().matches('saving')).toBe(true)
			expect(actor.getSnapshot().hasTag('busy')).toBe(true)
			pending.resolve('saved')
			await waitFor(actor, (state) => state.matches('success'))
			expect(save).toHaveBeenCalledTimes(1)
			expect(save.mock.calls[0]?.[0]).toEqual({ name: 'Home' })
		} finally {
			actor.stop()
		}
	})

	it('clears form state on reset after success', async () => {
		const actor = createActor(createFormMachine(schema, async () => 'saved', context)).start()
		try {
			actor.send({ type: 'SUBMIT', values: { name: 'Home' } })
			await waitFor(actor, (state) => state.matches('success'))
			actor.send({ type: 'RESET' })
			expect(actor.getSnapshot().matches('editing')).toBe(true)
			expect(actor.getSnapshot().context).toEqual({
				submitted: undefined,
				validated: null,
				result: undefined,
				error: null
			})
		} finally {
			actor.stop()
		}
	})
})
