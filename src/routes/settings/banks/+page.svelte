<script lang="ts">
	import { getContext, onDestroy } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { setup, assign, fromPromise } from 'xstate'
	import { useMachine } from '@xstate/svelte'
	import { createBankTrace, type BankTrace } from '#lib/integrations/diagnostics.js'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import {
		createPasskey,
		encryptPasskeySample,
		verifyPasskeySample,
		unlockCredential,
		type PasskeyDescriptor,
		type PasskeySample,
		type CredentialSealer
	} from '#lib/integrations/passkey.js'
	import {
		claimToken,
		validateSetupToken,
		fetchAccounts,
		providerAccountIdentity
	} from '#lib/integrations/simplefin.js'
	import { providerTransactionSchema, type CredentialScope } from '#lib/validation/integrations.js'
	import { appAccountSchema } from '#lib/validation/accounts.js'
	import { appTransactionSchema } from '#lib/validation/transactions.js'
	import { parseAmountMinor } from '#lib/domain/money.js'
	import { stableUuid } from '#lib/data.js'
	import { m } from '#lib/paraglide/messages.js'
	import BankSync from '#lib/components/BankSync.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const db = getDb()
	const session = fromStore(getJazzSession())
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const organizationId = $derived(filters.activeOrganizationId)
	const userId = $derived(session.current.account?.id)
	const membershipQuery = new QuerySubscriptionOne(() =>
		organizationId && userId ? app.organizationMembers.where({ organizationId, userId }) : undefined
	)
	const connectionQuery = new QuerySubscription(() =>
		organizationId && userId
			? app.simplefinConnections.where({ organizationId, ownerId: userId })
			: undefined
	)
	const accountQuery = new QuerySubscription(() =>
		organizationId
			? app.accounts.where({ organizationId, archivedAt: { isNull: true } })
			: undefined
	)
	const linkQuery = new QuerySubscription(() =>
		organizationId ? app.simplefinAccountLinks.where({ organizationId }) : undefined
	)
	const connection = $derived(
		connectionQuery.current?.find((row) => row.status === 'active') ?? connectionQuery.current?.[0]
	)
	const allowed = $derived(
		membershipQuery.current?.organizationId === organizationId &&
			(membershipQuery.current?.role === 'owner' || membershipQuery.current?.role === 'admin')
	)
	const connected = $derived(
		Boolean(
			connection?.status === 'active' &&
			connection.ciphertext &&
			connection.credentialId &&
			connection.prfSalt &&
			connection.iv &&
			connection.credentialVersion === 1
		)
	)
	const accounts = $derived(accountQuery.current ?? [])
	const mappings = $derived(
		new Map((linkQuery.current ?? []).map((link) => [link.simplefinAccountId, link.accountId]))
	)

	type Command =
		| { type: 'DISCOVER' }
		| { type: 'SYNC' }
		| { type: 'MAP'; providerId: string; accountId: string }
		| { type: 'CREATE_ACCOUNT'; providerId: string }
		| { type: 'DISCONNECT' }
	type Event =
		| Command
		| { type: 'CONNECT'; token: string }
		| { type: 'TEST_ENCRYPTION' }
		| { type: 'VERIFY_DECRYPTION' }
		| { type: 'SAVE_CONNECTION' }
		| { type: 'CANCEL' }
		| { type: 'RESET' }
	type SetupBase = {
		scope: CredentialScope
		token: string
		baselineCiphertext: string | null
		baselineStatus: 'active' | 'error' | 'revoked' | null
	}
	type CreatedSetup = SetupBase & { stage: 'created'; passkey: PasskeyDescriptor }
	type EncryptedSetup = SetupBase & { stage: 'encrypted'; sample: PasskeySample }
	type VerifiedSetup = SetupBase & { stage: 'verified'; seal: CredentialSealer }
	type SetupFlow = CreatedSetup | EncryptedSetup | VerifiedSetup
	type ProviderSummary = { id: string; name: string; currency: string }
	let discovered = $state<ProviderSummary[]>([])

	async function authorize(
		trace: BankTrace,
		scope: CredentialScope,
		signal: AbortSignal,
		requireConnection = true,
		expectedCiphertext?: string
	) {
		return trace.step('authorization', async () => {
			trace.log('authorization.snapshot', {
				allowed,
				hasUser: Boolean(userId),
				hasOrganization: Boolean(organizationId)
			})
			signal.throwIfAborted()
			if (
				!allowed ||
				userId !== scope.ownerId ||
				organizationId !== scope.organizationId ||
				session.current.status !== 'ready'
			)
				throw new Error('unauthorized')
			const memberships = await db.all(
				app.organizationMembers.where({
					organizationId: scope.organizationId,
					userId: scope.ownerId
				})
			)
			if (!memberships.some((row) => row.role === 'owner' || row.role === 'admin'))
				throw new Error('unauthorized')
			if (requireConnection) {
				const rows = await db.all(
					app.simplefinConnections.where({
						id: scope.connectionId,
						ownerId: scope.ownerId,
						organizationId: scope.organizationId,
						status: 'active'
					})
				)
				if (
					!rows[0]?.ciphertext ||
					(expectedCiphertext && rows[0].ciphertext !== expectedCiphertext)
				)
					throw new Error('disconnected')
			}
			signal.throwIfAborted()
			if (userId !== scope.ownerId || organizationId !== scope.organizationId)
				throw new Error('unauthorized')
		})
	}

	async function operate(
		command: Command,
		signal: AbortSignal,
		trace: BankTrace
	): Promise<ProviderSummary[] | undefined> {
		if (!organizationId || !userId || !allowed) throw new Error('unauthorized')
		const current = connection
		const scope = {
			organizationId,
			ownerId: userId,
			connectionId: current?.id ?? (await stableUuid(userId, `simplefin:${organizationId}`))
		}
		await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
		if (!current) throw new Error('disconnected')
		if (command.type === 'DISCONNECT') {
			await db
				.update(app.simplefinConnections, current.id, {
					status: 'revoked',
					ciphertext: null,
					credentialId: null,
					prfSalt: null,
					iv: null,
					credentialVersion: null,
					accessUrl: ''
				})
				.wait({ tier: 'local' })
			return []
		}
		if (command.type === 'CREATE_ACCOUNT') {
			const provider = discovered.find((account) => account.id === command.providerId)
			if (!provider) throw new Error('mapping')
			const values = appAccountSchema.parse({
				organizationId: scope.organizationId,
				name: provider.name,
				kind: 'bank',
				currency: provider.currency
			})
			const accountId = await stableUuid(scope.organizationId, `simplefin-account:${provider.id}`)
			const linkId = await stableUuid(scope.organizationId, `simplefin-link:${provider.id}`)
			// Hydrate before the transaction so a cold snapshot cannot recreate rows.
			await trace.step('account.hydrate', () =>
				Promise.all([
					db.all(app.accounts.where({ id: accountId })),
					db.all(
						app.simplefinAccountLinks.where({ organizationId: scope.organizationId, accountId })
					),
					db.all(
						app.simplefinAccountLinks.where({
							organizationId: scope.organizationId,
							simplefinAccountId: provider.id
						})
					)
				])
			)
			await authorize(trace, scope, signal, true, current.ciphertext ?? undefined)
			await trace.step('account.create-and-link', async () => {
				const result = await db.transaction(async (tx) => {
					const links = await tx.all(
						app.simplefinAccountLinks.where({
							organizationId: scope.organizationId,
							simplefinAccountId: provider.id
						})
					)
					if (links.length > 1) throw new Error('mapping')
					// Preserve a mapping already created on this or another device.
					if (links.length) return
					const destinationLinks = await tx.all(
						app.simplefinAccountLinks.where({ organizationId: scope.organizationId, accountId })
					)
					if (destinationLinks.some((link) => link.simplefinAccountId !== provider.id))
						throw new Error('account_already_linked')
					const rows = await tx.all(app.accounts.where({ id: accountId }))
					const account = rows[0]
					if (
						account &&
						(account.organizationId !== scope.organizationId ||
							account.archivedAt ||
							account.currency !== provider.currency)
					)
						throw new Error('mapping')
					signal.throwIfAborted()
					if (!account) tx.insert(app.accounts, values, { id: accountId })
					tx.insert(
						app.simplefinAccountLinks,
						{
							organizationId: scope.organizationId,
							connectionId: current.id,
							simplefinAccountId: provider.id,
							accountId
						},
						{ id: linkId }
					)
				})
				await result.wait({ tier: 'local' })
			})
			return
		}
		if (command.type === 'MAP') {
			if (!discovered.some((account) => account.id === command.providerId))
				throw new Error('mapping')
			const links = await db.all(
				app.simplefinAccountLinks.where({
					organizationId: scope.organizationId,
					simplefinAccountId: command.providerId
				})
			)
			if (!command.accountId) {
				for (const link of links) {
					await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
					await db.delete(app.simplefinAccountLinks, link.id).wait({ tier: 'local' })
				}
				return
			}
			const account = (
				await db.all(
					app.accounts.where({
						id: command.accountId,
						organizationId: scope.organizationId,
						archivedAt: { isNull: true }
					})
				)
			)[0]
			if (!account) throw new Error('mapping')
			await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
			const values = {
				organizationId: scope.organizationId,
				connectionId: current.id,
				simplefinAccountId: command.providerId,
				accountId: account.id
			}
			const id = await stableUuid(scope.organizationId, `simplefin-link:${command.providerId}`)
			// Refresh destination links before opening the transaction; recheck in
			// its snapshot so another local write cannot bypass the UI filter.
			await db.all(
				app.simplefinAccountLinks.where({
					organizationId: scope.organizationId,
					accountId: account.id
				})
			)
			await authorize(trace, scope, signal, true, current.ciphertext ?? undefined)
			const result = await db.transaction(async (tx) => {
				const destinationLinks = await tx.all(
					app.simplefinAccountLinks.where({
						organizationId: scope.organizationId,
						accountId: account.id
					})
				)
				if (destinationLinks.some((link) => link.simplefinAccountId !== command.providerId))
					throw new Error('account_already_linked')
				if (links.length > 1) throw new Error('mapping')
				signal.throwIfAborted()
				if (links[0]) tx.update(app.simplefinAccountLinks, links[0].id, values)
				else tx.insert(app.simplefinAccountLinks, values, { id })
			})
			await result.wait({ tier: 'local' })
			return
		}
		let accessUrl: string | undefined
		const attemptAt = new Date()
		let imported = 0,
			existing = 0,
			omitted = 0
		try {
			try {
				accessUrl = await unlockCredential(
					{
						version: current.credentialVersion,
						ownerId: current.ownerId,
						organizationId: current.organizationId,
						connectionId: current.id,
						credentialId: current.credentialId,
						prfSalt: current.prfSalt,
						iv: current.iv,
						ciphertext: current.ciphertext
					},
					scope,
					signal,
					trace
				)
			} catch (error) {
				trace.failed('credential.unlock.failed', error)
				throw new Error('unlock_failure')
			}
			await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
			const response = await fetchAccounts(
				accessUrl,
				command.type === 'DISCOVER',
				signal,
				trace
			).catch(() => {
				throw new Error('provider_failure')
			})
			accessUrl = undefined
			trace.log('provider.response.validated', {
				count: response.accounts.length,
				providerErrors: response.errors.length
			})
			await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
			if (command.type === 'DISCOVER') {
				if (response.errors.length) throw new Error('provider_failure')
				return response.accounts.map((account) => ({
					id: providerAccountIdentity(account),
					name: account.name,
					currency: account.currency
				}))
			}
			const links = await db.all(
				app.simplefinAccountLinks.where({ organizationId: scope.organizationId })
			)
			if (
				links.some((link) =>
					links.some(
						(other) =>
							other.accountId === link.accountId &&
							other.simplefinAccountId !== link.simplefinAccountId
					)
				)
			)
				throw new Error('account_already_linked')
			const categories = await db.all(
				app.categories.where({
					organizationId: scope.organizationId,
					isSystem: true,
					archivedAt: { isNull: true }
				})
			)
			trace.log('import.mappings.loaded', { count: links.length })
			trace.log('import.categories.loaded', { count: categories.length })
			for (const provider of response.accounts) {
				const identity = providerAccountIdentity(provider)
				const matchingLinks = links.filter((link) => link.simplefinAccountId === identity)
				const link = matchingLinks[0]
				const transactions = provider.transactions ?? []
				trace.log('import.account.mapping', { count: matchingLinks.length })
				if (!link) {
					omitted += transactions.length
					continue
				}
				if (matchingLinks.length !== 1) throw new Error('mapping')
				const account = (
					await db.all(
						app.accounts.where({
							id: link.accountId,
							organizationId: scope.organizationId,
							archivedAt: { isNull: true }
						})
					)
				)[0]
				if (!account) throw new Error('mapping')
				for (const raw of transactions) {
					const parsed = providerTransactionSchema.safeParse(raw)
					if (
						!parsed.success ||
						parsed.data.pending ||
						provider.currency !== 'USD' ||
						account.currency !== provider.currency
					) {
						omitted++
						continue
					}
					const transaction = parsed.data
					const amount = parseAmountMinor(transaction.amount.replace(/^-/, ''))
					if (amount.kind !== 'valid') {
						omitted++
						continue
					}
					const kind = transaction.amount.startsWith('-') ? 'expense' : 'income'
					const category = categories.find((row) => row.kind === kind)
					if (!category) throw new Error('mapping')
					const date = new Date(transaction.posted * 1000)
					if (!Number.isFinite(date.getTime())) {
						omitted++
						continue
					}
					const externalId = JSON.stringify([identity, transaction.id])
					const input = appTransactionSchema.safeParse({
						organizationId: scope.organizationId,
						accountId: account.id,
						categoryId: category.id,
						kind,
						bookedOn: date.toISOString().slice(0, 10),
						money: { amountMinor: amount.amountMinor, currency: provider.currency },
						memo: transaction.description,
						source: { source: 'simplefin', externalId }
					})
					if (!input.success) {
						omitted++
						continue
					}
					const id = await stableUuid(scope.organizationId, `simplefin-transaction:${externalId}`)
					await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
					const present = await db.all(app.transactions.where({ id }))
					if (present.length) {
						existing++
						continue
					}
					await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
					await db
						.insert(
							app.transactions,
							{
								organizationId: scope.organizationId,
								accountId: account.id,
								categoryId: category.id,
								kind,
								bookedOn: input.data.bookedOn,
								amountMinor: amount.amountMinor,
								currency: provider.currency,
								memo: transaction.description,
								source: 'simplefin',
								externalId
							},
							{ id }
						)
						.wait({ tier: 'local' })
					imported++
				}
			}
			await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
			await db
				.update(app.simplefinConnections, current.id, {
					lastSyncAt: attemptAt,
					lastOutcome: omitted || response.errors.length ? 'partial' : 'succeeded',
					importedCount: imported,
					existingCount: existing,
					omittedCount: omitted,
					lastError: null
				})
				.wait({ tier: 'local' })
			trace.log('import.result.persisted', { imported, existing, omitted })
		} catch (error) {
			trace.failed('provider-operation.failed', error)
			if (command.type === 'SYNC' && !signal.aborted) {
				await authorize(trace, scope, signal, true, current?.ciphertext ?? undefined)
				await db
					.update(app.simplefinConnections, current.id, {
						lastSyncAt: attemptAt,
						lastOutcome: 'failed',
						lastError: 'operation-failed',
						importedCount: imported,
						existingCount: existing,
						omittedCount: omitted
					})
					.wait({ tier: 'local' })
			}
			throw error
		} finally {
			accessUrl = undefined
			trace.log('credential.references-released', { aborted: signal.aborted })
		}
	}

	type Context = {
		command: Command | undefined
		message: string
		setupToken: string | undefined
		setup: SetupFlow | undefined
	}
	function contextTypes(): Context {
		return { command: undefined, message: 'idle', setupToken: undefined, setup: undefined }
	}
	function eventTypes(): Event {
		return { type: 'RESET' }
	}
	async function runLocked<T>(
		operation: string,
		signal: AbortSignal,
		work: (trace: BankTrace) => Promise<T>
	) {
		const trace = createBankTrace(operation)
		trace.log('operation.received', {
			hasUser: Boolean(userId),
			hasOrganization: Boolean(organizationId),
			allowed,
			connected,
			webLocksAvailable: Boolean(navigator.locks)
		})
		const abort = () => trace.log('operation.aborted')
		signal.addEventListener('abort', abort, { once: true })
		try {
			if (!navigator.locks || !organizationId || !userId) throw new Error('locking_unavailable')
			return await trace.step('operation', () =>
				navigator.locks.request(
					`simplefin:${userId}:${organizationId}`,
					{ ifAvailable: true },
					async (lock) => {
						if (!lock) throw new Error('other_tab')
						trace.log('operation.lock-acquired')
						signal.throwIfAborted()
						return work(trace)
					}
				)
			)
		} catch (error) {
			trace.failed('operation.failed', error)
			throw error
		} finally {
			signal.removeEventListener('abort', abort)
			trace.log('operation.finished', { aborted: signal.aborted })
		}
	}

	async function runOperation(command: Command, signal: AbortSignal) {
		return runLocked(command.type, signal, (trace) => operate(command, signal, trace))
	}
	async function assertSetup(flow: SetupBase, signal: AbortSignal, trace: BankTrace) {
		await authorize(trace, flow.scope, signal, false)
		const current = (
			await db.all(app.simplefinConnections.where({ id: flow.scope.connectionId }))
		)[0]
		if (
			(current?.ciphertext ?? null) !== flow.baselineCiphertext ||
			(current?.status ?? null) !== flow.baselineStatus
		)
			throw new Error('disconnected')
		signal.throwIfAborted()
		return current
	}
	async function startSetup(token: string, signal: AbortSignal): Promise<CreatedSetup> {
		return runLocked('CONNECT.create-passkey', signal, async (trace) => {
			if (!organizationId || !userId) throw new Error('unauthorized')
			const scope = {
				organizationId,
				ownerId: userId,
				connectionId: connection?.id ?? (await stableUuid(userId, `simplefin:${organizationId}`))
			}
			const base: SetupBase = {
				scope,
				token,
				baselineCiphertext: connection?.ciphertext ?? null,
				baselineStatus: connection?.status ?? null
			}
			await assertSetup(base, signal, trace)
			try {
				await validateSetupToken(token, trace)
			} catch {
				throw new Error('invalid_setup_token')
			}
			try {
				const passkey = await createPasskey(scope, signal, m['app.name'](), trace)
				return { ...base, stage: 'created', passkey }
			} catch {
				throw new Error('passkey_failure')
			}
		})
	}
	async function encryptSetup(flow: CreatedSetup, signal: AbortSignal): Promise<EncryptedSetup> {
		return runLocked('CONNECT.encrypt-sample', signal, async (trace) => {
			await assertSetup(flow, signal, trace)
			try {
				const sample = await encryptPasskeySample(flow.scope, flow.passkey, signal, trace)
				return {
					stage: 'encrypted',
					scope: flow.scope,
					token: flow.token,
					baselineCiphertext: flow.baselineCiphertext,
					baselineStatus: flow.baselineStatus,
					sample
				}
			} catch {
				throw new Error('passkey_failure')
			}
		})
	}
	async function verifySetup(flow: EncryptedSetup, signal: AbortSignal): Promise<VerifiedSetup> {
		return runLocked('CONNECT.verify-sample', signal, async (trace) => {
			await assertSetup(flow, signal, trace)
			try {
				const seal = await verifyPasskeySample(flow.scope, flow.sample, signal, trace)
				return {
					stage: 'verified',
					scope: flow.scope,
					token: flow.token,
					baselineCiphertext: flow.baselineCiphertext,
					baselineStatus: flow.baselineStatus,
					seal
				}
			} catch {
				throw new Error('passkey_failure')
			}
		})
	}
	async function saveSetup(flow: VerifiedSetup, signal: AbortSignal) {
		return runLocked('CONNECT.save', signal, async (trace) => {
			const current = await assertSetup(flow, signal, trace)
			let accessUrl: string | undefined
			try {
				accessUrl = await trace.step('setup.claim', () => claimToken(flow.token, signal, trace))
			} catch {
				throw new Error('claim_failure')
			}
			try {
				const encrypted = await trace.step('setup.encrypt-credential', () => {
					if (!accessUrl) throw new Error('invalid-credential')
					return flow.seal(accessUrl, signal)
				})
				accessUrl = undefined
				await assertSetup(flow, signal, trace)
				const values = {
					organizationId: flow.scope.organizationId,
					ownerId: flow.scope.ownerId,
					accessUrl: '',
					credentialVersion: encrypted.version,
					credentialId: encrypted.credentialId,
					prfSalt: encrypted.prfSalt,
					iv: encrypted.iv,
					ciphertext: encrypted.ciphertext,
					status: 'active',
					claimedAt: new Date()
				} satisfies {
					organizationId: string
					ownerId: string
					accessUrl: string
					credentialVersion: number
					credentialId: string
					prfSalt: string
					iv: string
					ciphertext: string
					status: 'active'
					claimedAt: Date
				}
				await trace.step('setup.persist', async () => {
					if (current)
						await db.update(app.simplefinConnections, current.id, values).wait({ tier: 'local' })
					else
						await db
							.insert(app.simplefinConnections, values, { id: flow.scope.connectionId })
							.wait({ tier: 'local' })
				})
			} catch (error) {
				trace.failed('setup.persist.failed', error)
				throw new Error('save_failure')
			} finally {
				accessUrl = undefined
			}
		})
	}
	function setupErrorMessage(error: unknown) {
		return error instanceof Error &&
			[
				'passkey_failure',
				'invalid_setup_token',
				'claim_failure',
				'save_failure',
				'other_tab',
				'locking_unavailable'
			].includes(error.message)
			? error.message
			: 'failure'
	}

	const machine = setup({
		types: { context: contextTypes(), events: eventTypes() },
		actors: {
			createSetup: fromPromise(({ input, signal }: { input: string; signal: AbortSignal }) =>
				startSetup(input, signal)
			),
			encryptSetup: fromPromise(({ input, signal }: { input: CreatedSetup; signal: AbortSignal }) =>
				encryptSetup(input, signal)
			),
			verifySetup: fromPromise(
				({ input, signal }: { input: EncryptedSetup; signal: AbortSignal }) =>
					verifySetup(input, signal)
			),
			saveSetup: fromPromise(({ input, signal }: { input: VerifiedSetup; signal: AbortSignal }) =>
				saveSetup(input, signal)
			),
			operation: fromPromise(async ({ input, signal }: { input: Command; signal: AbortSignal }) =>
				runOperation(input, signal)
			)
		}
	}).createMachine({
		id: 'bank',
		initial: 'idle',
		context: contextTypes(),
		on: {
			RESET: {
				target: '.idle',
				actions: assign({
					command: undefined,
					setup: undefined,
					setupToken: undefined,
					message: 'idle'
				})
			},
			CANCEL: {
				target: '.idle',
				actions: assign({
					command: undefined,
					setup: undefined,
					setupToken: undefined,
					message: 'cancelled'
				})
			}
		},
		states: {
			idle: {
				on: {
					CONNECT: { target: 'setup', actions: assign({ setupToken: ({ event }) => event.token }) },
					DISCOVER: { target: 'running', actions: assign({ command: ({ event }) => event }) },
					SYNC: { target: 'running', actions: assign({ command: ({ event }) => event }) },
					MAP: { target: 'running', actions: assign({ command: ({ event }) => event }) },
					CREATE_ACCOUNT: { target: 'running', actions: assign({ command: ({ event }) => event }) },
					DISCONNECT: { target: 'running', actions: assign({ command: ({ event }) => event }) }
				}
			},
			setup: {
				initial: 'creating',
				exit: assign({ setup: undefined, setupToken: undefined }),
				states: {
					creating: {
						invoke: {
							src: 'createSetup',
							input: ({ context }) => {
								if (!context.setupToken) throw new Error('missing-command')
								return context.setupToken
							},
							onDone: {
								target: 'readyToEncrypt',
								actions: assign({ setup: ({ event }) => event.output, setupToken: undefined })
							},
							onError: {
								target: '#bank.idle',
								actions: assign({ message: ({ event }) => setupErrorMessage(event.error) })
							}
						}
					},
					readyToEncrypt: { on: { TEST_ENCRYPTION: 'encrypting' } },
					encrypting: {
						invoke: {
							src: 'encryptSetup',
							input: ({ context }) => {
								if (context.setup?.stage !== 'created') throw new Error('missing-command')
								return context.setup
							},
							onDone: {
								target: 'readyToVerify',
								actions: assign({ setup: ({ event }) => event.output })
							},
							onError: {
								target: '#bank.idle',
								actions: assign({ message: ({ event }) => setupErrorMessage(event.error) })
							}
						}
					},
					readyToVerify: { on: { VERIFY_DECRYPTION: 'verifying' } },
					verifying: {
						invoke: {
							src: 'verifySetup',
							input: ({ context }) => {
								if (context.setup?.stage !== 'encrypted') throw new Error('missing-command')
								return context.setup
							},
							onDone: {
								target: 'readyToSave',
								actions: assign({ setup: ({ event }) => event.output })
							},
							onError: {
								target: '#bank.idle',
								actions: assign({ message: ({ event }) => setupErrorMessage(event.error) })
							}
						}
					},
					readyToSave: { on: { SAVE_CONNECTION: 'saving' } },
					saving: {
						invoke: {
							src: 'saveSetup',
							input: ({ context }) => {
								if (context.setup?.stage !== 'verified') throw new Error('missing-command')
								return context.setup
							},
							onDone: { target: '#bank.idle', actions: assign({ message: 'success' }) },
							onError: {
								target: '#bank.idle',
								actions: assign({ message: ({ event }) => setupErrorMessage(event.error) })
							}
						}
					}
				}
			},
			running: {
				invoke: {
					src: 'operation',
					input: ({ context }) => {
						if (!context.command) throw new Error('missing-command')
						return context.command
					},
					onDone: {
						target: 'idle',
						actions: [
							({ event }) => {
								if (event.output) discovered = event.output
							},
							assign({ command: undefined, message: 'success' })
						]
					},
					onError: {
						target: 'idle',
						actions: assign({
							command: undefined,
							message: ({ event }) =>
								event.error instanceof Error &&
								[
									'passkey_failure',
									'claim_failure',
									'invalid_setup_token',
									'account_already_linked',
									'save_failure',
									'other_tab',
									'locking_unavailable',
									'unlock_failure',
									'provider_failure',
									'mapping'
								].includes(event.error.message)
									? event.error.message
									: 'failure'
						})
					}
				}
			}
		}
	})
	const { snapshot, send } = useMachine(machine)
	const bankState = fromStore(snapshot)
	const setupView = $derived(
		bankState.current.matches({ setup: 'creating' })
			? 'creating'
			: bankState.current.matches({ setup: 'readyToEncrypt' })
				? 'test-encryption'
				: bankState.current.matches({ setup: 'encrypting' })
					? 'encrypting'
					: bankState.current.matches({ setup: 'readyToVerify' })
						? 'test-decryption'
						: bankState.current.matches({ setup: 'verifying' })
							? 'verifying'
							: bankState.current.matches({ setup: 'readyToSave' })
								? 'save'
								: bankState.current.matches({ setup: 'saving' })
									? 'saving'
									: null
	)
	const workflowTrace = createBankTrace('workflow')
	function dispatch(event: Event) {
		workflowTrace.log('event', {
			event: event.type,
			state: setupView ?? (bankState.current.matches('running') ? 'running' : 'idle')
		})
		send(event)
	}
	$effect(() => {
		workflowTrace.log('state', {
			state: setupView ?? (bankState.current.matches('running') ? 'running' : 'idle'),
			allowed,
			connected
		})
	})
	$effect(() => {
		workflowTrace.log('queries', {
			loading: [membershipQuery, connectionQuery, accountQuery, linkQuery].some(
				(query) => query.isLoading
			),
			failed: [membershipQuery, connectionQuery, accountQuery, linkQuery].some((query) =>
				Boolean(query.error)
			)
		})
		for (const [label, error] of [
			['membership', membershipQuery.error],
			['connection', connectionQuery.error],
			['accounts', accountQuery.error],
			['mappings', linkQuery.error]
		]) {
			if (error) workflowTrace.failed(`query.${label}.failed`, error)
		}
	})
	const busy = $derived(!bankState.current.matches('idle'))
	const statusMessages = $derived<Record<string, string>>({
		idle:
			connection?.status === 'active'
				? connected
					? m['bank.locked']()
					: m['bank.waiting']()
				: m['bank.idle'](),
		success: m['bank.success'](),
		failure: m['bank.failure'](),
		passkey_failure: m['bank.passkey_failure'](),
		claim_failure: m['bank.claim_failure'](),
		invalid_setup_token: m['bank.invalid_setup_token'](),
		save_failure: m['bank.save_failure'](),
		cancelled: m['bank.cancelled'](),
		other_tab: m['bank.other_tab'](),
		locking_unavailable: m['bank.locking_unavailable'](),
		unlock_failure: m['bank.unlock_failure'](),
		provider_failure: m['bank.provider_failure'](),
		mapping: m['bank.mapping_failure'](),
		account_already_linked: m['bank.account_already_linked']()
	})
	const status = $derived(
		busy
			? m['bank.working']()
			: (statusMessages[bankState.current.context.message] ?? m['bank.failure']())
	)
	const outcome = $derived(
		connection?.lastSyncAt && connection.lastOutcome
			? m['bank.result']({
					time: connection.lastSyncAt.toLocaleString(),
					outcome:
						connection.lastOutcome === 'succeeded'
							? m['bank.succeeded']()
							: connection.lastOutcome === 'partial'
								? m['bank.partial']()
								: m['bank.failed'](),
					imported: connection.importedCount ?? 0,
					existing: connection.existingCount ?? 0,
					omitted: connection.omittedCount ?? 0
				})
			: ''
	)
	let previousScope = ''
	$effect(() => {
		const key = `${userId}:${organizationId}:${allowed}`
		if (key !== previousScope) {
			previousScope = key
			workflowTrace.log('scope.changed')
			dispatch({ type: 'RESET' })
			discovered = []
		}
	})
	let previousEnvelope = ''
	$effect(() => {
		const fingerprint = `${connection?.id}:${connection?.status}:${connection?.ciphertext}`
		if (fingerprint !== previousEnvelope) {
			previousEnvelope = fingerprint
			const command = bankState.current.context.command
			if (
				command?.type === 'SYNC' ||
				command?.type === 'DISCOVER' ||
				(bankState.current.matches('setup') && !bankState.current.matches({ setup: 'saving' }))
			) {
				workflowTrace.log('connection.changed.cancel')
				dispatch({ type: 'CANCEL' })
			}
		}
	})
	onDestroy(() => dispatch({ type: 'CANCEL' }))
</script>

<svelte:head><title>{m['bank.title']()} · {m['app.name']()}</title></svelte:head>
<QueryContent
	queries={[membershipQuery, connectionQuery, accountQuery, linkQuery]}
	loadingMessage={m['status.loading']({ subject: m['bank.title']() })}
	errorMessage={m['errors.load']({ subject: m['bank.title']() })}
>
	{#key `${userId}:${organizationId}`}
		<BankSync
			{status}
			{setupView}
			onTestEncryption={() => dispatch({ type: 'TEST_ENCRYPTION' })}
			onVerifyDecryption={() => dispatch({ type: 'VERIFY_DECRYPTION' })}
			onSaveConnection={() => dispatch({ type: 'SAVE_CONNECTION' })}
			{busy}
			{allowed}
			{connected}
			{accounts}
			providerAccounts={discovered}
			{mappings}
			{outcome}
			onConnect={(token) => dispatch({ type: 'CONNECT', token })}
			onDiscover={() => dispatch({ type: 'DISCOVER' })}
			onSync={() => dispatch({ type: 'SYNC' })}
			onMap={(providerId, accountId) => dispatch({ type: 'MAP', providerId, accountId })}
			onCreateAccount={(providerId) => dispatch({ type: 'CREATE_ACCOUNT', providerId })}
			onDisconnect={() => dispatch({ type: 'DISCONNECT' })}
			onCancel={() => dispatch({ type: 'CANCEL' })}
		/>
	{/key}
</QueryContent>
