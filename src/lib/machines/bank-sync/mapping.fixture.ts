import { afterEach, vi } from 'vitest'
import { Transaction, type schema } from 'jazz-tools'
import { createActor, fromCallback, fromPromise, type InputFrom } from 'xstate'
import { app, type Account } from '#lib/schema.js'
import { createAccountWriteMachine, type AccountWrite } from './account-write.js'
import { accountWriteTransaction } from './account-write-transaction.js'
import { createAccountCreationMachine } from './account-create.js'
import { createAccountMappingMachine } from './accounts.js'
import { createAccountUnlinkMachine } from './account-unlink.js'
import { createAuthorizationMachine } from './authorization.js'
import { createBankOperationMachine } from './operation.js'
import { account, connection, dependencies, id, observation, source } from './test-fixtures.js'
import type { BankCommand, LockEvent, OperationWork } from './types.js'
import type { bankLock } from './lock.js'

type Link = schema.RowOf<typeof app.simplefinAccountLinks>
export const provider = { id: 'provider-checking', name: 'Provider Checking', currency: 'USD' }
export const work: OperationWork = {
	command: { type: 'CREATE_ACCOUNT', providerId: provider.id },
	current: connection,
	scope: { ownerId: id(1), organizationId: id(2), connectionId: connection.id },
	trace: { id: 'test', log: vi.fn(), failed: vi.fn(), step: async (_stage, effect) => effect() },
	attemptAt: new Date('2026-10-22T12:00:00Z')
}
export const request: AccountWrite = {
	kind: 'create',
	work,
	provider,
	accountId: account.id,
	values: {
		organizationId: id(2),
		name: provider.name,
		kind: 'bank',
		currency: 'USD',
		archivedAt: null
	}
}
export const link: Link = {
	id: id(6),
	organizationId: id(2),
	connectionId: connection.id,
	simplefinAccountId: provider.id,
	simplefinOrgId: null,
	accountId: account.id
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})

export function mappingFixture() {
	const tx = new Transaction('mergeable', () => {
		throw new Error('Unit fixture must not open a runtime')
	})
	const all = vi.spyOn(tx, 'all')
	const insert = vi.spyOn(tx, 'insert').mockReturnValue(account)
	const update = vi.spyOn(tx, 'update').mockImplementation(() => {})
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const wait = vi.fn(async (_options: { tier: 'local' }) => {})
	// Opaque SDK handle: mock its I/O boundary, while keeping all transaction states real.
	const commit = vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait }))
	const beginTransaction = vi.fn(() => tx)
	const db = { beginTransaction }
	function records(
		providerLinks: Link[] = [],
		destination: Link[] = [],
		current: Account | null = account
	) {
		all
			.mockReset()
			.mockResolvedValue([])
			.mockResolvedValueOnce(providerLinks)
			.mockResolvedValueOnce(destination)
			.mockResolvedValueOnce(current ? [current] : [])
	}
	records()
	function transaction(input = request, machine = accountWriteTransaction) {
		const actor = createActor(machine, { input: { db, request: input, linkId: link.id } })
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	const observe = vi.fn(() => observation)
	const deps = dependencies(observe)
	const authorize = createAuthorizationMachine(deps).provide({
		actors: {
			membership: fromPromise(async () => (source.membership ? [source.membership] : [])),
			connections: fromPromise(async () => [connection]),
			connection: fromPromise(async () => [connection])
		}
	})
	// Compose the real chain. Only storage/platform leaves are replaced.
	const transactionMachine = accountWriteTransaction.provide({
		actors: {
			open: fromPromise(async () => beginTransaction())
		}
	})
	const write = createAccountWriteMachine(deps).provide({
		actors: {
			providerLinks: fromPromise(async (): Promise<Link[]> => []),
			account: fromPromise(async () => [account]),
			destinationLinks: fromPromise(async (): Promise<Link[]> => []),
			linkId: fromPromise(async () => link.id),
			authorize,
			transaction: transactionMachine
		}
	})
	const create = createAccountCreationMachine(deps).provide({
		actors: {
			accountId: fromPromise(async () => account.id),
			write
		}
	})
	const remove = vi.fn(async () => {})
	const unlink = createAccountUnlinkMachine(deps).provide({
		actors: {
			links: fromPromise(async () => [link, { ...link, id: id(7) }]),
			authorize,
			remove: fromPromise(remove)
		}
	})
	const mapping = createAccountMappingMachine(deps).provide({
		actors: {
			mapAccount: write,
			createAccount: create,
			unlinkAccount: unlink
		}
	})
	const releaseLock = vi.fn()
	const acquireLock = vi.fn()
	const operationMachine = createBankOperationMachine(deps).provide({
		actors: {
			authorize,
			mapAccounts: mapping,
			lock: fromCallback<LockEvent, InputFrom<typeof bankLock>>(({ sendBack }) => {
				acquireLock()
				sendBack({ type: 'LOCK_ACQUIRED' })
				return releaseLock
			})
		}
	})
	function operation(command: BankCommand = work.command) {
		const actor = createActor(operationMachine, { input: { command, discovered: [provider] } })
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	return {
		tx,
		all,
		insert,
		update,
		rollback,
		wait,
		commit,
		beginTransaction,
		records,
		transaction,
		transactionMachine,
		write,
		create,
		mapping,
		operationMachine,
		operation,
		authorize,
		remove,
		releaseLock,
		acquireLock,
		deps,
		observe,
		observation
	}
}
