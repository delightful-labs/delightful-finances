import { fromPromise } from 'xstate'

type Transaction<Write> = {
	commit(): Write
	rollback(): Promise<boolean>
}

/** Shared Jazz transaction resource actors; callers retain workflow and outcome ownership. */
export function createJazzTransactionActors<Db, Tx extends Transaction<Write>, Write>(
	begin: (db: Db) => Tx,
	settleWrite: (write: Write) => Promise<unknown>
) {
	const open = fromPromise(({ input }: { input: Db }) => Promise.resolve(begin(input)))
	const commit = fromPromise(({ input }: { input: Tx }) => Promise.resolve(input.commit()))
	const settle = fromPromise(({ input }: { input: Write }) => settleWrite(input))
	const rollback = fromPromise(({ input }: { input: Tx }) => input.rollback())
	return { open, commit, settle, rollback }
}
