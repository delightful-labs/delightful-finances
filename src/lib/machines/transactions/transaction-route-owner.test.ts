import { afterEach, expect, it, vi } from 'vitest'
import { createActor, initialTransition, toPromise, waitFor } from 'xstate'
import {
	createTransactionRouteOwnerMachine,
	selectTransactionRouteView,
	selectTransactionTextReply
} from './transaction-route-owner.js'
import { creationFixture, creationFacts, creationValues } from './transaction-create.fixture.js'
import {
	createTransactionEntryFormOptions,
	createTransactionEditFormOptions
} from './transaction-entry.js'
import { createTransactionSubmissionMachine } from './transaction-submission.js'
const roots = new Set<
	ReturnType<typeof createActor<ReturnType<typeof createTransactionRouteOwnerMachine>>>
>()
afterEach(() => {
	for (const root of roots) root.stop()
	roots.clear()
})
const expense = {
	kind: 'expense',
	pathname: '/expenses/new'
} satisfies import('../../contracts/transaction-route-contract.js').TransactionCreateRoute
const income = {
	kind: 'income',
	pathname: '/income/new'
} satisfies import('../../contracts/transaction-route-contract.js').TransactionCreateRoute
const draft = {
	accountId: creationValues.accountId,
	categoryId: creationValues.categoryId,
	amount: '1.00',
	bookedOn: '2026-10-18',
	tags: []
}
function fixture() {
	const persistence = creationFixture()
	const settled = Promise.withResolvers<void>()
	persistence.wait.mockImplementation(() => settled.promise)
	const navigate = vi.fn(async () => {})
	const root = createActor(
		createTransactionRouteOwnerMachine({
			db: persistence.db,
			observe: (kind) => ({ ...creationFacts(persistence.db), kind }),
			navigate
		})
	).start()
	roots.add(root)
	const view = () => selectTransactionRouteView(root.getSnapshot())
	return { root, view, navigate, persistence, settled }
}
async function ready(f: ReturnType<typeof fixture>) {
	await waitFor(f.root, (snapshot) => selectTransactionRouteView(snapshot).form?.canSubmit === true)
	return f.view().generation
}
it('keeps canonical validation and rejects an obsolete controller before opening a transaction', async () => {
	const f = fixture()
	f.root.send({ type: 'ROUTE', route: expense })
	const generation = await ready(f)
	f.root.send({
		type: 'FORM',
		generation,
		command: { type: 'SUBMIT', values: { ...draft, amount: 'wrong' } }
	})
	await vi.waitFor(() => {
		const feedback = f.view().form?.feedback
		expect(
			feedback?.kind === 'result' &&
				feedback.result.outcome === 'invalid' &&
				feedback.result.issues.some((issue) => issue.path[0] === 'amount')
		).toBe(true)
	})
	expect(f.persistence.beginTransaction).not.toHaveBeenCalled()
	f.root.send({ type: 'ROUTE', route: null })
	await waitFor(f.root, (snapshot) => snapshot.matches('idle'))
	f.root.send({ type: 'ROUTE', route: expense })
	const next = await ready(f)
	expect(next).toBeGreaterThan(generation)
	f.root.send({ type: 'FORM', generation, command: { type: 'SUBMIT', values: draft } })
	expect(f.persistence.beginTransaction).not.toHaveBeenCalled()
	f.root.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
})
it('retains an admitted save through A→B→A and suppresses its late completion navigation', async () => {
	const f = fixture()
	f.root.send({ type: 'ROUTE', route: expense })
	const generation = await ready(f)
	f.root.send({ type: 'FORM', generation, command: { type: 'SUBMIT', values: draft } })
	await vi.waitFor(() => expect(f.persistence.wait).toHaveBeenCalledOnce())
	f.root.send({ type: 'ROUTE', route: income })
	f.root.send({ type: 'ROUTE', route: expense })
	expect(f.view()).toMatchObject({ mode: 'draining', generation, form: undefined })
	f.root.send({ type: 'FORM', generation, command: { type: 'SUBMIT', values: draft } })
	expect(f.persistence.commit).toHaveBeenCalledOnce()
	f.settled.resolve()
	const next = await ready(f)
	expect(next).toBeGreaterThan(generation)
	expect(f.view().route).toEqual(expense)
	expect(f.navigate).not.toHaveBeenCalled()
	expect(f.persistence.commit).toHaveBeenCalledOnce()
	f.root.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
})
it('does not acknowledge global shutdown while the native commit settlement is pending', async () => {
	const f = fixture()
	f.root.send({ type: 'ROUTE', route: expense })
	const generation = await ready(f)
	f.root.send({ type: 'FORM', generation, command: { type: 'SUBMIT', values: draft } })
	await vi.waitFor(() => expect(f.persistence.wait).toHaveBeenCalledOnce())
	f.root.send({ type: 'SHUTDOWN' })
	expect(f.root.getSnapshot().status).toBe('active')
	expect(f.view().mode).toBe('draining')
	f.root.send({ type: 'ROUTE', route: income })
	f.settled.resolve()
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
	expect(f.navigate).not.toHaveBeenCalled()
})
it('binds only the validated attachment selection to the admitted submission', () => {
	const f = creationFixture()
	const original = new File(['original'], 'original.png', { type: 'image/png' })
	const replacement = new File(['replacement'], 'replacement.png', { type: 'image/png' })
	const files = [original]
	const observe = () => creationFacts(f.db)
	const options = createTransactionEntryFormOptions({ db: f.db, binding: f.db, observe })
	const values = options.schema.parse({ ...draft, attachments: files })
	files[0] = replacement
	expect(values.selectedAttachments).toEqual([original])
	const [snapshot] = initialTransition(
		createTransactionSubmissionMachine(f.db, observe),
		f.input(values)
	)
	expect(snapshot.context.files).toEqual([original])
})
it('validates the complete native file count while only transferring bounded file handles', () => {
	const f = creationFixture()
	const options = createTransactionEntryFormOptions({
		db: f.db,
		binding: f.db,
		observe: () => creationFacts(f.db)
	})
	const file = new File(['receipt'], 'receipt.png', { type: 'image/png' })
	const limited = options.schema.safeParse({
		...draft,
		attachments: Array.from({ length: 5 }, () => file),
		attachmentCount: 6
	})
	expect(limited.success).toBe(false)
	if (!limited.success)
		expect(limited.error.issues.some((issue) => issue.path[0] === 'attachments')).toBe(true)
	const empty = options.schema.parse({
		...draft,
		attachments: [new File([], '', { type: 'application/octet-stream' })],
		attachmentCount: 1
	})
	expect(empty.selectedAttachments).toEqual([])
	const corrupt = options.schema.safeParse({ ...draft, attachments: [file], attachmentCount: 0 })
	expect(corrupt.success).toBe(false)
	expect(f.beginTransaction).not.toHaveBeenCalled()
})
it('joins the selected edit controller before re-entering a creation route', async () => {
	const f = creationFixture()
	const unavailable = (): never => {
		throw new Error('No persistence is admitted while edit data is loading')
	}
	const db = { ...f.db, one: unavailable, transaction: unavailable, delete: unavailable }
	const id = crypto.randomUUID()
	const root = createActor(
		createTransactionRouteOwnerMachine({
			db,
			observe: (kind) => ({
				...creationFacts(db),
				kind,
				loading: true,
				transactionId: id,
				transaction: null
			}),
			edit: { db, trackWrite: vi.fn(), gateway: { send: vi.fn() } }
		})
	).start()
	roots.add(root)
	root.send({
		type: 'ROUTE',
		route: { kind: 'expense', pathname: `/expenses/${id}`, transactionId: id }
	})
	await waitFor(root, (snapshot) => selectTransactionRouteView(snapshot).mode === 'active')
	const first = selectTransactionRouteView(root.getSnapshot()).generation
	expect(root.getSnapshot().children.edit).toBeDefined()
	root.send({ type: 'ROUTE', route: income })
	await waitFor(
		root,
		(snapshot) =>
			selectTransactionRouteView(snapshot).route?.pathname === income.pathname &&
			selectTransactionRouteView(snapshot).generation > first
	)
	expect(root.getSnapshot().children.edit).toBeUndefined()
	expect(root.getSnapshot().children.form).toBeDefined()
	root.send({ type: 'FORM', generation: first, command: { type: 'SUBMIT', values: draft } })
	expect(f.beginTransaction).not.toHaveBeenCalled()
	root.send({ type: 'SHUTDOWN' })
	expect(await toPromise(root)).toEqual({ outcome: 'released' })
})

it('does not mark an unchanged edit dirty for an empty native file-picker placeholder', () => {
	const f = creationFixture()
	const options = createTransactionEditFormOptions({
		db: f.db,
		binding: f.db,
		observe: () => creationFacts(f.db)
	})
	const values = {
		...draft,
		paymentMethod: undefined,
		checkId: undefined,
		checkDate: undefined,
		description: undefined,
		memo: undefined,
		attachments: [new File([], '', { type: 'application/octet-stream' })]
	}
	if (!('valuesEqual' in options) || typeof options.valuesEqual !== 'function')
		throw new Error('Expected edit equality policy')
	expect(options.valuesEqual(values, creationValues)).toBe(true)
	expect(
		options.valuesEqual(
			{ ...values, attachments: [new File(['receipt'], 'receipt.png', { type: 'image/png' })] },
			creationValues
		)
	).toBe(false)
})

it('owns text references through reset and route changes before canonical validation', async () => {
	const f = fixture()
	f.root.send({ type: 'ROUTE', route: expense })
	const generation = await ready(f)
	const requestId = '550e8400-e29b-41d4-a716-446655440000'
	const draftRevision = f.view().form?.draftRevision ?? -1
	const text = 'long memo 😀'.repeat(1000)
	const command = (
		command: import('../../contracts/native-text-transfer.js').NativeTextCommand,
		revision = draftRevision
	) => f.root.send({ type: 'TEXT', generation, draftRevision: revision, command })
	command({ type: 'START', requestId, field: 'memo' })
	let index = 0
	for (let offset = 0; offset < text.length; offset += 4096)
		command({ type: 'CHUNK', requestId, index: index++, text: text.slice(offset, offset + 4096) })
	command({ type: 'COMMIT', requestId, parts: index })
	const reply = selectTransactionTextReply(f.root.getSnapshot())
	expect(reply?.status).toBe('ready')
	const reference = {
		kind: 'text',
		textScope: reply?.textScope,
		reference: reply?.reference,
		version: reply?.version
	}
	f.root.send({
		type: 'FORM',
		generation,
		command: { type: 'CHANGE', values: { ...draft, memo: reference } }
	})
	await vi.waitFor(() => expect(f.view().form?.canReset).toBe(true))
	f.root.send({ type: 'FORM', generation, command: { type: 'RESET' } })
	await vi.waitFor(() => expect(f.view().form?.draftRevision).toBeGreaterThan(draftRevision))
	command({ type: 'START', requestId, field: 'memo' })
	expect(selectTransactionTextReply(f.root.getSnapshot())).toBeUndefined()
	f.root.send({
		type: 'FORM',
		generation,
		command: { type: 'SUBMIT', values: { ...draft, memo: reference } }
	})
	expect(f.persistence.beginTransaction).not.toHaveBeenCalled()
	f.root.send({ type: 'ROUTE', route: null })
	await waitFor(f.root, (snapshot) => snapshot.matches('idle'))
	f.root.send({ type: 'ROUTE', route: expense })
	const nextGeneration = await ready(f)
	command({ type: 'START', requestId, field: 'memo' })
	expect(selectTransactionTextReply(f.root.getSnapshot())).toBeUndefined()
	const nextRevision = f.view().form?.draftRevision ?? -1
	const nextCommand = (
		command: import('../../contracts/native-text-transfer.js').NativeTextCommand
	) =>
		f.root.send({ type: 'TEXT', generation: nextGeneration, draftRevision: nextRevision, command })
	nextCommand({ type: 'START', requestId, field: 'memo' })
	nextCommand({ type: 'CHUNK', requestId, index: 0, text: text.slice(0, 4096) })
	nextCommand({ type: 'CHUNK', requestId, index: 1, text: text.slice(4096, 8192) })
	nextCommand({ type: 'CHUNK', requestId, index: 2, text: text.slice(8192) })
	nextCommand({ type: 'COMMIT', requestId, parts: 3 })
	const current = selectTransactionTextReply(f.root.getSnapshot())
	expect(current?.textScope).not.toBe(reference.textScope)
	f.root.send({
		type: 'FORM',
		generation: nextGeneration,
		command: { type: 'SUBMIT', values: { ...draft, memo: reference } }
	})
	expect(f.persistence.beginTransaction).not.toHaveBeenCalled()
	f.root.send({
		type: 'FORM',
		generation: nextGeneration,
		command: {
			type: 'SUBMIT',
			values: {
				...draft,
				memo: {
					kind: 'text',
					reference: current?.reference,
					version: current?.version,
					textScope: current?.textScope
				}
			}
		}
	})
	await vi.waitFor(() => expect(f.persistence.insert).toHaveBeenCalled())
	expect(
		f.persistence.insert.mock.calls.some((args) =>
			args.some(
				(value) => value && typeof value === 'object' && 'memo' in value && value.memo === text
			)
		)
	).toBe(true)
	f.settled.resolve()
	await vi.waitFor(() => expect(f.view().form?.canOpen).toBe(true))
	f.root.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
})

it('rechecks fresh authorization before exposing the next text chunk even before OBSERVE arrives', async () => {
	const persistence = creationFixture()
	let facts = creationFacts(persistence.db)
	const root = createActor(
		createTransactionRouteOwnerMachine({ db: persistence.db, observe: () => facts })
	).start()
	roots.add(root)
	root.send({ type: 'ROUTE', route: expense })
	await waitFor(root, (snapshot) => selectTransactionRouteView(snapshot).form?.canSubmit === true)
	const view = selectTransactionRouteView(root.getSnapshot())
	const requestId = '550e8400-e29b-41d4-a716-446655440000'
	const command = (command: import('../../contracts/native-text-transfer.js').NativeTextCommand) =>
		root.send({
			type: 'TEXT',
			generation: view.generation,
			draftRevision: view.form?.draftRevision ?? -1,
			command
		})
	command({ type: 'START', requestId, field: 'memo' })
	command({ type: 'CHUNK', requestId, index: 0, text: 'a'.repeat(4096) })
	command({ type: 'CHUNK', requestId, index: 1, text: 'private tail' })
	command({ type: 'COMMIT', requestId, parts: 2 })
	command({ type: 'READ', requestId, field: 'memo' })
	expect(selectTransactionTextReply(root.getSnapshot())?.text).toHaveLength(4096)
	facts = {
		...facts,
		membership: facts.membership ? { ...facts.membership, role: 'viewer' } : null
	}
	command({ type: 'NEXT', requestId, offset: 4096 })
	expect(selectTransactionTextReply(root.getSnapshot())?.status).toBe('unavailable')
	expect(selectTransactionTextReply(root.getSnapshot())?.text).toBe('')
	expect(persistence.beginTransaction).not.toHaveBeenCalled()
	root.send({ type: 'SHUTDOWN' })
	expect(await toPromise(root)).toEqual({ outcome: 'released' })
})

it('owns a long new-tag draft, rejects a bad patch before persistence, and saves the complete private name', async () => {
	const f = fixture()
	f.root.send({ type: 'ROUTE', route: expense })
	const generation = await ready(f),
		draftRevision = f.view().form?.draftRevision ?? -1
	const requestId = '550e8400-e29b-41d4-a716-446655440000',
		name = 'Private long tag '.repeat(400) + 'Tail'
	const text = (command: import('../../contracts/native-text-transfer.js').NativeTextCommand) =>
		f.root.send({ type: 'TEXT', generation, draftRevision, command })
	text({ type: 'START', requestId, field: 'name' })
	let index = 0
	for (let offset = 0; offset < name.length; offset += 4096)
		text({ type: 'CHUNK', requestId, index: index++, text: name.slice(offset, offset + 4096) })
	text({ type: 'COMMIT', requestId, parts: index })
	const reply = selectTransactionTextReply(f.root.getSnapshot())
	expect(reply?.status).toBe('ready')
	f.root.send({
		type: 'FORM',
		generation,
		command: {
			type: 'SUBMIT',
			values: {
				...draft,
				tags: undefined,
				tagComposer: true,
				tagPatch: { type: 'SELECT', tagId: requestId }
			}
		}
	})
	expect(f.persistence.beginTransaction).not.toHaveBeenCalled()
	expect(f.view().newTags?.feedback?.kind).toBe('unavailable')
	f.root.send({
		type: 'FORM',
		generation,
		command: {
			type: 'CHANGE',
			values: {
				...draft,
				tags: undefined,
				tagComposer: true,
				tagPatch: {
					type: 'ADD',
					name: {
						kind: 'text',
						textScope: reply?.textScope,
						reference: reply?.reference,
						version: reply?.version
					}
				}
			}
		}
	})
	await vi.waitFor(() => expect(f.view().form?.canReset).toBe(true))
	expect(f.view().newTags?.items).toEqual([{ id: 0, name }])
	f.root.send({
		type: 'FORM',
		generation,
		command: { type: 'SUBMIT', values: { ...draft, tags: undefined, tagComposer: true } }
	})
	await vi.waitFor(() => expect(f.persistence.wait).toHaveBeenCalledOnce())
	expect(
		f.persistence.insert.mock.calls.some((args) =>
			args.some(
				(value) => value && typeof value === 'object' && 'name' in value && value.name === name
			)
		)
	).toBe(true)
	f.root.send({ type: 'SHUTDOWN' })
	expect(f.root.getSnapshot().status).toBe('active')
	f.settled.resolve()
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
	expect(f.root.getSnapshot().context.newTags.items).toEqual([])
})
