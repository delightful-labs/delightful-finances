import { describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { z } from 'zod'
import { createFormMachine, selectLegacyFormView } from './form.js'

const schema = z.object({ name: z.string().min(1) })
const context = { id: 'workspace' }

describe('legacy form presentation adapter', () => {
	it('projects editable and externally disabled fields without inventing reset ownership', () => {
		const actor = createActor(createFormMachine(schema, async () => {}, context)).start()
		try {
			const snapshot = actor.getSnapshot()
			const editable = selectLegacyFormView(snapshot, false)
			expect(editable).toMatchObject({
				activity: { kind: 'idle' },
				content: { kind: 'fields' },
				canSubmit: true,
				canReset: true,
				canOpen: true,
				fieldsEditable: true,
				draftRevision: undefined
			})
			expect(editable.state).toBe(snapshot)
			expect(selectLegacyFormView(snapshot, true)).toMatchObject({
				canSubmit: false,
				canReset: false,
				canOpen: false,
				fieldsEditable: false,
				disabled: true
			})
			expect('settlement' in editable).toBe(false)
		} finally {
			actor.stop()
		}
	})

	it('distinguishes validation and persistence activity and retains void success', async () => {
		const gate = Promise.withResolvers<void>()
		const actor = createActor(createFormMachine(schema, () => gate.promise, context)).start()
		try {
			actor.send({ type: 'SUBMIT', values: { name: 'Home' } })
			expect(selectLegacyFormView(actor.getSnapshot(), false)).toMatchObject({
				activity: { kind: 'validating' },
				canSubmit: false,
				canReset: false,
				fieldsEditable: false,
				canOpen: true
			})
			await waitFor(actor, (s) => s.matches('saving'))
			expect(selectLegacyFormView(actor.getSnapshot(), false).activity).toEqual({
				kind: 'operating'
			})
			gate.resolve()
			await waitFor(actor, (s) => s.matches('success'))
			expect(selectLegacyFormView(actor.getSnapshot(), false)).toMatchObject({
				content: { kind: 'success', value: undefined },
				activity: { kind: 'idle' },
				canSubmit: true
			})
			actor.send({ type: 'OPEN' })
			expect(selectLegacyFormView(actor.getSnapshot(), false).content.kind).toBe('fields')
		} finally {
			gate.resolve()
			actor.stop()
		}
	})

	it('preserves validation issues and raw legacy failure details for existing snippets', async () => {
		const error = new Error('Write failed')
		const actor = createActor(
			createFormMachine(
				schema,
				async () => {
					throw error
				},
				context
			)
		).start()
		try {
			actor.send({ type: 'SUBMIT', values: { name: '' } })
			await waitFor(actor, (s) => s.matches('invalid'))
			expect(selectLegacyFormView(actor.getSnapshot(), false).issues).toEqual([
				expect.objectContaining({ path: ['name'], code: 'too_small' })
			])
			actor.send({ type: 'SUBMIT', values: { name: 'Home' } })
			await waitFor(actor, (s) => s.matches('error'))
			const failed = selectLegacyFormView(actor.getSnapshot(), false)
			expect(failed.state.context.error).toBe(error)
			expect(failed.content.kind).toBe('fields')
			expect(failed.issues).toEqual([])
			expect(failed.canSubmit).toBe(true)
		} finally {
			actor.stop()
		}
	})
})
