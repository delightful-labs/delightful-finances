import { assign, fromPromise, setup } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { stableUuid } from '#lib/data.js'
import type { appAccountSchema } from '#lib/validation/accounts.js'
import { createAuthorizationMachine } from './authorization.js'
import { required } from './identity.js'
import {
	credentialAuthorization,
	type Dependencies,
	type OperationWork,
	type ProviderSummary,
	type Result
} from './types.js'

type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Account = schema.RowOf<typeof app.accounts>
export type AccountWrite = { work: OperationWork; provider: ProviderSummary; accountId: string } & (
	{ kind: 'create'; values: ReturnType<typeof appAccountSchema.parse> } | { kind: 'map' }
)
type Context = {
	request: AccountWrite
	links: Link[]
	destination: Link[]
	account: Account | undefined
	linkId: string | undefined
	error: unknown
}

export function createAccountWriteMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		providerLinks: fromPromise(({ input }: { input: AccountWrite }) =>
			db.all(
				app.simplefinAccountLinks.where({
					organizationId: input.work.scope.organizationId,
					simplefinAccountId: input.provider.id
				})
			)
		),
		account: fromPromise(({ input }: { input: AccountWrite }) =>
			db.all(app.accounts.where({ id: input.accountId }))
		),
		destinationLinks: fromPromise(({ input }: { input: AccountWrite }) =>
			db.all(
				app.simplefinAccountLinks.where({
					organizationId: input.work.scope.organizationId,
					accountId: input.accountId
				})
			)
		),
		linkId: fromPromise(({ input }: { input: AccountWrite }) =>
			stableUuid(input.work.scope.organizationId, `simplefin-link:${input.provider.id}`)
		),
		authorize: createAuthorizationMachine(dependencies),
		// Recheck inside the atomic write: preflight states cannot prevent concurrent changes.
		commit: fromPromise<void, { request: AccountWrite; linkId: string }>(
			async ({ input, signal }) => {
				const { request, linkId } = input
				const { work, provider, accountId } = request
				const result = await db.transaction(async (tx) => {
					const links = await tx.all(
						app.simplefinAccountLinks.where({
							organizationId: work.scope.organizationId,
							simplefinAccountId: provider.id
						})
					)
					if (links.length > 1) throw new Error('mapping')
					if (request.kind === 'create' && links.length) return
					const destination = await tx.all(
						app.simplefinAccountLinks.where({
							organizationId: work.scope.organizationId,
							accountId
						})
					)
					if (destination.some((link) => link.simplefinAccountId !== provider.id))
						throw new Error('account_already_linked')
					const account = (await tx.all(app.accounts.where({ id: accountId })))[0]
					if (
						account &&
						(account.organizationId !== work.scope.organizationId ||
							account.archivedAt ||
							(request.kind === 'create' && account.currency !== provider.currency))
					)
						throw new Error('mapping')
					if (request.kind === 'map' && !account) throw new Error('mapping')
					signal.throwIfAborted()
					if (request.kind === 'create' && !account)
						tx.insert(app.accounts, request.values, { id: accountId })
					const values = {
						organizationId: work.scope.organizationId,
						connectionId: work.current.id,
						simplefinAccountId: provider.id,
						accountId
					}
					if (links[0]) tx.update(app.simplefinAccountLinks, links[0].id, values)
					else tx.insert(app.simplefinAccountLinks, values, { id: linkId })
				})
				await result.wait({ tier: 'local' })
			}
		)
	}
	return setup<
		Context,
		{ type: 'WRITE' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		AccountWrite,
		Result<undefined>
	>({ actors }).createMachine({
		id: 'bank-account-write',
		context: ({ input }) => ({
			request: input,
			links: [],
			destination: [],
			account: undefined,
			linkId: undefined,
			error: undefined
		}),
		initial: 'loadingProviderLinks',
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			loadingProviderLinks: {
				invoke: {
					src: 'providerLinks',
					input: ({ context }) => context.request,
					onDone: {
						target: 'checkingProviderLinks',
						actions: assign({ links: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingProviderLinks: {
				always: [
					{ guard: ({ context }) => context.links.length > 1, target: 'invalidMapping' },
					{
						guard: ({ context }) => context.request.kind === 'create',
						target: 'checkingExistingCreation'
					},
					{ target: 'loadingAccount' }
				]
			},
			checkingExistingCreation: {
				always: [
					{
						guard: ({ context }) => context.links.length === 1,
						target: 'authorizingExistingCreation'
					},
					{ target: 'loadingAccount' }
				]
			},
			authorizingExistingCreation: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.request.work),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'complete' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			loadingAccount: {
				invoke: {
					src: 'account',
					input: ({ context }) => context.request,
					onDone: {
						target: 'checkingAccountPresence',
						actions: assign({ account: ({ event }) => event.output[0] })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingAccountPresence: {
				always: [
					{
						guard: ({ context }) => Boolean(context.account),
						target: 'checkingAccountOrganization'
					},
					{ guard: ({ context }) => context.request.kind === 'map', target: 'invalidMapping' },
					{ target: 'loadingDestinationLinks' }
				]
			},
			checkingAccountOrganization: {
				always: [
					{
						guard: ({ context }) =>
							context.account?.organizationId !== context.request.work.scope.organizationId,
						target: 'invalidMapping'
					},
					{ target: 'checkingAccountArchive' }
				]
			},
			checkingAccountArchive: {
				always: [
					{
						guard: ({ context }) => Boolean(context.account?.archivedAt),
						target: 'invalidMapping'
					},
					{
						guard: ({ context }) => context.request.kind === 'create',
						target: 'checkingAccountCurrency'
					},
					{ target: 'loadingDestinationLinks' }
				]
			},
			checkingAccountCurrency: {
				always: [
					{
						guard: ({ context }) => context.account?.currency !== context.request.provider.currency,
						target: 'invalidMapping'
					},
					{ target: 'loadingDestinationLinks' }
				]
			},
			loadingDestinationLinks: {
				invoke: {
					src: 'destinationLinks',
					input: ({ context }) => context.request,
					onDone: {
						target: 'checkingDestinationLinks',
						actions: assign({ destination: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingDestinationLinks: {
				always: [
					{
						guard: ({ context }) =>
							context.destination.some(
								(link) => link.simplefinAccountId !== context.request.provider.id
							),
						target: 'accountConflict'
					},
					{ target: 'generatingLinkId' }
				]
			},
			generatingLinkId: {
				invoke: {
					src: 'linkId',
					input: ({ context }) => context.request,
					onDone: {
						target: 'authorizingWrite',
						actions: assign({ linkId: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			authorizingWrite: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.request.work),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'committing' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			committing: {
				invoke: {
					src: 'commit',
					input: ({ context }) => ({ request: context.request, linkId: required(context.linkId) }),
					onDone: 'complete',
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			complete: { type: 'final' },
			invalidMapping: { type: 'final', entry: assign({ error: () => new Error('mapping') }) },
			accountConflict: {
				type: 'final',
				entry: assign({ error: () => new Error('account_already_linked') })
			},
			failed: { type: 'final' }
		}
	})
}
