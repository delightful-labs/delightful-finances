import {
	ReadTier,
	type QueryBuilder,
	type DbSubscriptionCallbacks,
	type QueryOptions
} from 'jazz-tools'
import { observeRows } from '../observations.js'

export type WorkerQuerySource<Row extends { id: string }> = {
	subscribe: (
		query: QueryBuilder<Row>,
		callbacks: DbSubscriptionCallbacks<Row>,
		options: QueryOptions
	) => () => void
}

/** One native subscription lease. Rows are copied before actor observations;
 * late callbacks from a replaced query cannot update the current binding. */
export class WorkerQuery<Row extends { id: string }> {
	current: readonly Row[] | undefined
	isLoading = false
	error: true | undefined
	private key: string | undefined
	private binding: object | undefined
	private unsubscribe: (() => void) | undefined
	constructor(
		private readonly db: WorkerQuerySource<Row>,
		private readonly changed: () => void
	) {}
	get one(): Row | null | undefined {
		return this.current === undefined ? undefined : (this.current[0] ?? null)
	}
	set(key: string, query: QueryBuilder<Row> | undefined) {
		if (key === this.key) return
		this.clear()
		this.key = key
		if (!query) return
		const binding = {}
		this.binding = binding
		this.isLoading = true
		try {
			const unsubscribe = this.db.subscribe(
				query,
				{
					onUpdate: (rows) => {
						if (this.binding !== binding) return
						try {
							this.current = observeRows(rows)
							this.isLoading = false
							this.error = undefined
						} catch {
							this.current = undefined
							this.isLoading = false
							this.error = true
						}
						this.changed()
					},
					onError: () => {
						if (this.binding !== binding) return
						this.current = undefined
						this.isLoading = false
						this.error = true
						this.changed()
					}
				},
				{ tier: ReadTier.LocalFirst }
			)
			if (this.binding === binding) this.unsubscribe = unsubscribe
			else unsubscribe()
		} catch {
			if (this.binding !== binding) return
			this.current = undefined
			this.isLoading = false
			this.error = true
			this.changed()
		}
	}
	clear() {
		const unsubscribe = this.unsubscribe
		this.binding = undefined
		this.unsubscribe = undefined
		this.key = undefined
		this.current = undefined
		this.isLoading = false
		this.error = undefined
		unsubscribe?.()
	}
}
