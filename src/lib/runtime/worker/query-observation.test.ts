import { expect, it, vi } from 'vitest'
import {
	schema,
	ReadTier,
	type DbSubscriptionCallbacks,
	type QueryBuilder,
	type QueryOptions
} from 'jazz-tools'
import { WorkerQuery, type WorkerQuerySource } from './query-observation.js'

const app = schema.defineApp(
	{ facts: schema.table({ name: schema.string() }, {}) },
	{ migrations: 'none' }
)
type Row = schema.RowOf<typeof app.facts>
class Source implements WorkerQuerySource<Row> {
	subscriptions: { callbacks: DbSubscriptionCallbacks<Row>; stopped: boolean }[] = []
	immediate: ((callbacks: DbSubscriptionCallbacks<Row>) => void) | undefined
	subscribe = vi.fn(
		(
			_query: QueryBuilder<Row>,
			callbacks: DbSubscriptionCallbacks<Row>,
			_options: QueryOptions
		) => {
			const subscription = { callbacks, stopped: false }
			this.subscriptions.push(subscription)
			this.immediate?.(callbacks)
			return () => {
				subscription.stopped = true
			}
		}
	)
	update(index: number, rows: Row[]) {
		this.subscriptions[index]?.callbacks.onUpdate(rows, { splices: new Map() })
	}
}
function fixture() {
	const source = new Source(),
		changed = vi.fn()
	return { source, changed, slot: new WorkerQuery(source, changed) }
}
it('keeps pending knowledge distinct from an observed empty local result', () => {
	const f = fixture()
	f.slot.set('all', app.facts)
	expect(f.slot.one).toBeUndefined()
	expect(f.slot.isLoading).toBe(true)
	f.source.update(0, [])
	expect(f.slot.one).toBeNull()
	expect(f.slot.isLoading).toBe(false)
	expect(f.source.subscribe).toHaveBeenCalledWith(
		app.facts,
		expect.objectContaining({ onUpdate: expect.any(Function) }),
		{ tier: ReadTier.LocalFirst }
	)
	f.slot.clear()
})
it('copies SDK arrays and rows before they can be frozen in actor observations', () => {
	const f = fixture(),
		rows = [{ id: crypto.randomUUID(), name: 'first' }]
	f.slot.set('all', app.facts)
	f.source.update(0, rows)
	Object.freeze(f.slot.current)
	Object.freeze(f.slot.one)
	rows[0]!.name = 'updated'
	rows.push({ id: crypto.randomUUID(), name: 'second' })
	expect(f.slot.one?.name).toBe('first')
	f.source.update(0, rows)
	expect(f.slot.current).toHaveLength(2)
	expect(f.slot.one?.name).toBe('updated')
	f.slot.clear()
})
it('rejects late updates and errors after a query binding is replaced', () => {
	const f = fixture()
	f.slot.set('first', app.facts)
	f.slot.set('second', app.facts.where({ name: 'second' }))
	expect(f.source.subscriptions[0]?.stopped).toBe(true)
	f.source.update(0, [{ id: crypto.randomUUID(), name: 'obsolete' }])
	f.source.subscriptions[0]?.callbacks.onError?.(new Error('obsolete private error'))
	expect(f.slot.one).toBeUndefined()
	expect(f.slot.error).toBeUndefined()
	f.source.update(1, [{ id: crypto.randomUUID(), name: 'second' }])
	expect(f.slot.one?.name).toBe('second')
	f.slot.clear()
})
it('does not reacquire an unchanged query when domain snapshots change', () => {
	const f = fixture()
	f.slot.set('same', app.facts)
	f.slot.set('same', app.facts.orderBy('name'))
	expect(f.source.subscribe).toHaveBeenCalledOnce()
	f.slot.clear()
})
it('retains the replacement when a native initial callback rebinds synchronously', () => {
	const source = new Source()
	let replaced = false
	const slot = new WorkerQuery(source, () => {
		if (!replaced) {
			replaced = true
			slot.set('second', app.facts.where({ name: 'second' }))
		}
	})
	source.immediate = (callbacks) =>
		callbacks.onUpdate([{ id: crypto.randomUUID(), name: String(source.subscriptions.length) }], {
			splices: new Map()
		})
	slot.set('first', app.facts)
	expect(source.subscriptions[0]?.stopped).toBe(true)
	expect(source.subscriptions[1]?.stopped).toBe(false)
	expect(slot.one?.name).toBe('2')
	slot.clear()
	expect(source.subscriptions[1]?.stopped).toBe(true)
})
it('exposes acquisition failure as unavailable facts without carrying the private native error', () => {
	const f = fixture()
	f.source.subscribe.mockImplementation(() => {
		throw new Error('PRIVATE SDK ERROR')
	})
	f.slot.set('all', app.facts)
	expect(f.slot.error).toBe(true)
	expect(f.slot.current).toBeUndefined()
	expect(f.slot.isLoading).toBe(false)
	expect(f.changed).toHaveBeenCalledOnce()
})
