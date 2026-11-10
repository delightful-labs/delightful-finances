import {
	selectWorkspaceNameTextReply,
	type NameFormSlot
} from '../../machines/forms/workspace-forms.js'
import type { NativeTextCommand } from '../../contracts/native-text-transfer.js'
import { selectWorkspaceTransactionTextReply } from '../../machines/forms/workspace-forms.js'
import { WorkerTransactionTransferObservation } from './transaction-transfer-observation.js'
import { selectWorkspaceTransactionTransferObservationState } from '../../machines/forms/workspace-forms.js'
import { selectedTransactionFacts } from './transaction-observation.js'
import {
	transactionRoute,
	transactionEditRoute
} from '../../contracts/transaction-route-contract.js'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import { selectWorkspaceTransactionRoute } from '../../machines/forms/workspace-forms.js'
import { projectTransactionRoute } from './transaction-route-read.js'
import type { TransactionRouteIntent, TransactionEditIntent } from './transaction-route-protocol.js'
import type { OverviewCommand } from './overview-protocol.js'
import { WorkerLedgerObservation } from './ledger-observation.js'
import type { LedgerCommand } from './ledger-protocol.js'
import { selectWorkspaceAccountActions } from '../../machines/forms/workspace-forms.js'
import type { ArchiveObservation } from '../../machines/accounts/account-archive-operation.js'
import type { DeleteGrantObservation } from '../../machines/accounts/account-delete-grants.js'
import { canManageAccountDeleteGrants } from '../../machines/accounts/account-delete-grants.js'
import { projectAccountActions, type AccountActionsIntent } from './account-actions-protocol.js'
import type { ManagementObservation } from '../../contracts/management-contract.js'
import {
	selectWorkspaceManagementForms,
	type ManagementFormSlot,
	type ManagementFormCommand
} from '../../machines/forms/workspace-forms.js'
import { projectManagementData } from './management-read.js'
import { emptyManagementView, projectManagementForms } from './management-protocol.js'
import { selectedResourceFormsActor } from '../../machines/runtime/workspace-selected-resources.js'
import {
	selectWorkspaceAccountForm,
	type AccountFormCommand
} from '../../machines/forms/workspace-forms.js'
import type { AccountCreationObservation } from '../../contracts/account-creation-contract.js'
import { projectAccountForm } from './form-protocol.js'
import type { ActorRefFrom } from 'xstate'
import type { Db, schema } from 'jazz-tools'
import type { JazzClient, JazzSession } from 'jazz-tools/client'
import {
	app,
	transactionSummaryQuery,
	transactionDetailQuery,
	type TransactionDetail,
	type Category,
	type Tag,
	type AccountMembership,
	type Account,
	type Organization,
	type OrganizationMember
} from '../../schema.js'
import { organizationMembershipQuery } from '../../domain/organization-membership-query.js'
import { calculateAccountBalances } from '../../domain/account-balances.js'
import { workspaceRoute } from '../../domain/workspace-routes.js'
import {
	selectAttachedWorkspace,
	captureTransferMutationScope,
	type createApplicationReadinessMachine
} from '../../machines/runtime/application-readiness.js'
import {
	selectWorkspaceView,
	type WorkspaceAttachment,
	type WorkspaceCoordinatorActor,
	type ReadinessObservation
} from '../../machines/runtime/readiness.js'
import {
	bankData,
	type BankSource,
	type BankObservationEvent,
	type Connection
} from '../../machines/bank-sync/types.js'
import { sameWorkspaceLease } from '../../contracts/workspace-selected-resources.js'
import type { WorkspaceLease } from 'delightful-local-first/workspace/contracts'
import { m } from '../../paraglide/messages.js'
import { WorkerQuery } from './query-observation.js'
import {
	CATALOG_PAGE_SIZE,
	emptyWorkspaceView,
	type PublicWorkspaceView,
	type WorkspaceCommand
} from './workspace-protocol.js'
import type { RouteObservation } from './application-protocol.js'

type Application = ActorRefFrom<ReturnType<typeof createApplicationReadinessMachine>>
type Session = JazzSession<JazzClient>
type Summary = schema.RowOf<typeof transactionSummaryQuery>
type Link = schema.RowOf<typeof app.simplefinAccountLinks>
function sameFacts(left: readonly unknown[] | undefined, right: readonly unknown[]) {
	return left?.length === right.length && right.every((value, index) => value === left[index])
}
function publicOrganization(row: Organization) {
	return {
		id: row.id,
		name: row.name.slice(0, 4096),
		kind: row.kind,
		defaultCurrency: row.defaultCurrency,
		ownerId: row.ownerId
	}
}
export type WorkspaceObservationOptions = {
	textScope?: string
	route: () => RouteObservation
	navigate: WorkspaceAttachment['navigate']
	changed: () => void
	failed: () => void
}

/** Integration resource owner only: it binds SDK subscriptions and forwards
 * copied facts to the existing application/workspace/domain statecharts. */
class WorkspaceScope {
	private readonly ledger: WorkerLedgerObservation
	private readonly transferRead: WorkerTransactionTransferObservation
	readonly attachment: WorkspaceAttachment
	readonly memberships: WorkerQuery<OrganizationMember>
	readonly organizations: WorkerQuery<Organization>
	readonly categories: WorkerQuery<Category>
	readonly tags: WorkerQuery<Tag>
	readonly ownGrants: WorkerQuery<AccountMembership>
	readonly actionGrants: WorkerQuery<AccountMembership>
	readonly members: WorkerQuery<OrganizationMember>
	readonly accounts: WorkerQuery<Account>
	readonly transactions: WorkerQuery<Summary>
	readonly transactionDetail: WorkerQuery<TransactionDetail>
	readonly connections: WorkerQuery<Connection>
	readonly links: WorkerQuery<Link>
	private forms: ReturnType<typeof selectedResourceFormsActor>
	private formsSubscription: { unsubscribe: () => void } | undefined
	private formSubscriptions: { unsubscribe: () => void }[] = []
	private transactionRouteFacts: readonly unknown[] | undefined
	private transactionController = 0
	private transactionOffsets = { accounts: 0, categories: 0, tags: 0, transfers: 0, savedTags: 0 }
	private managementFacts: readonly unknown[] | undefined
	private managementData: ReturnType<typeof projectManagementData> | undefined
	private formFacts: readonly unknown[] | undefined
	private actor: WorkspaceCoordinatorActor | undefined
	private subscription: { unsubscribe: () => void } | undefined
	private readinessFacts: readonly unknown[] | undefined
	private connectionFacts: readonly unknown[] | undefined
	private historyFacts: readonly unknown[] | undefined
	private mappingFacts: readonly unknown[] | undefined
	private balanceFacts: readonly unknown[] | undefined
	private balances: ReadonlyMap<string, bigint> | null = null
	private observedLease: WorkspaceLease | undefined
	private observedOrganization: string | null | undefined
	generation: number
	organizationOffset = 0
	accountOffset = 0
	private actionAccountId: string | null = null
	private permissionOffset = 0
	categoryOffset = 0
	tagOffset = 0
	categoryFilter: 'active' | 'archived' | 'all' = 'active'
	tagFilter: 'active' | 'archived' | 'all' = 'active'
	categoryOptionsKind: 'expense' | 'income' = 'expense'
	categoryOptionsOffset = 0
	constructor(
		readonly application: Application,
		readonly session: Session,
		readonly db: Db,
		readonly revision: number,
		private readonly options: WorkspaceObservationOptions,
		private readonly schedule: () => void,
		private readonly nextGeneration: () => number
	) {
		this.ledger = new WorkerLedgerObservation(db)
		this.transferRead = new WorkerTransactionTransferObservation(db, schedule)
		this.generation = nextGeneration()
		this.memberships = new WorkerQuery<OrganizationMember>(db, schedule)
		this.organizations = new WorkerQuery<Organization>(db, schedule)
		this.categories = new WorkerQuery<Category>(db, schedule)
		this.tags = new WorkerQuery<Tag>(db, schedule)
		this.ownGrants = new WorkerQuery<AccountMembership>(db, schedule)
		this.actionGrants = new WorkerQuery<AccountMembership>(db, schedule)
		this.members = new WorkerQuery<OrganizationMember>(db, schedule)
		this.accounts = new WorkerQuery<Account>(db, schedule)
		this.transactions = new WorkerQuery<Summary>(db, schedule)
		this.transactionDetail = new WorkerQuery<TransactionDetail>(db, schedule)
		this.connections = new WorkerQuery<Connection>(db, schedule)
		this.links = new WorkerQuery<Link>(db, schedule)
		this.attachment = {
			forms: {
				textScope: () => `${this.options.textScope ?? 'unbound'}/${this.generation}`,
				transaction: {
					textScope: () => `${this.options.textScope ?? 'unbound'}/${this.generation}`,
					db,
					edit: {
						db,
						observeTransfers: (kind, generation, searchEnabled) =>
							this.transferRead.observe(
								this.transactionObservation(kind),
								generation,
								searchEnabled
							),
						trackWrite: (write) => application.send({ type: 'TRANSFER_WRITE_TRACKED', write }),
						gateway: {
							captureScope: (request) =>
								captureTransferMutationScope(application.getSnapshot(), request),
							send: (event) => application.send(event)
						}
					},
					observe: (kind) => this.transactionObservation(kind),
					navigate: (destination, signal, route) => {
						signal.throwIfAborted()
						const current = selectWorkspaceTransactionRoute(this.currentForms()?.getSnapshot())
						const location = this.options.route()
						if (
							current.mode !== 'active' ||
							current.route?.pathname !== route.pathname ||
							location.pathname !== route.pathname
						)
							throw new Error('Transaction route is obsolete')
						return this.options.navigate(
							destination,
							signal,
							`${location.pathname}${location.search}${location.hash}`,
							true
						)
					}
				},
				account: () => this.accountObservation(),
				archive: () => this.archiveObservation(),
				deleteGrants: () => this.deleteGrantObservation(),
				management: (kind) => this.managementObservation(kind)
			},
			environment: JSON.stringify([db.getConfig().appId, db.getConfig().serverUrl ?? '']),
			dependencies: { db, read: () => this.source(), passkeyName: () => m['app.name']() },
			read: () => this.readiness(),
			navigate: options.navigate
		}
		this.bindQueries(false)
	}
	get organizationId() {
		return workspaceRoute(this.options.route().search).workspaceId
	}
	private transactionObservation(kind: 'expense' | 'income'): TransactionEntryObservation {
		const account = this.accountObservation()
		const editRoute = transactionEditRoute(this.options.route().pathname)
		const selected = editRoute?.kind === kind ? editRoute : null
		const queries = [
			this.memberships,
			this.accounts,
			this.categories,
			this.tags,
			this.ownGrants,
			...(selected ? [this.transactionDetail] : [])
		]
		return {
			identityId: account.identityId,
			organizationId: account.organizationId,
			binding: account.binding,
			sessionReady: account.sessionReady,
			kind,
			...selectedTransactionFacts(
				selected,
				kind,
				account.organizationId,
				this.transactionDetail.one
			),
			membership: account.membership,
			grants: this.ownGrants.current ?? [],
			accounts: this.accounts.current ?? [],
			categories: this.categories.current ?? [],
			tags: this.tags.current ?? [],
			loading: queries.some((query) => query.isLoading),
			failed: queries.some((query) => !!query.error)
		}
	}
	private accountObservation(): AccountCreationObservation {
		const session = this.session.getSnapshot()
		return {
			identityId: session.account?.id ?? null,
			organizationId: this.organizationId,
			binding: session.client?.db ?? null,
			sessionReady: session.status === 'ready',
			membership: this.memberships.one,
			accounts: this.accounts.current ?? [],
			loading:
				this.memberships.isLoading || this.accounts.isLoading || this.organizations.isLoading,
			error: this.memberships.error ?? this.accounts.error ?? this.organizations.error
		}
	}

	private archiveObservation(): ArchiveObservation {
		const facts = this.accountObservation()
		const queries = [this.memberships, this.accounts, this.ownGrants]
		return {
			...facts,
			loading: queries.some((query) => query.isLoading),
			failed: queries.some((query) => !!query.error),
			grants: this.ownGrants.current ?? []
		}
	}
	private deleteGrantObservation(): DeleteGrantObservation {
		const facts = this.accountObservation()
		const queries = [this.memberships, this.accounts, this.members, this.actionGrants]
		return {
			...facts,
			loading: queries.some((query) => query.isLoading),
			failed: queries.some((query) => !!query.error),
			members: this.members.current ?? [],
			grants: this.actionGrants.current ?? []
		}
	}

	private managementObservation(kind: 'category' | 'tag'): ManagementObservation {
		const account = this.accountObservation()
		const queries = [
			this.memberships,
			this.categories,
			this.tags,
			...(kind === 'category' ? [this.transactions] : [])
		]
		return {
			identityId: account.identityId,
			organizationId: account.organizationId,
			binding: account.binding,
			sessionReady: account.sessionReady,
			membership: account.membership,
			categories: this.categories.current ?? [],
			tags: this.tags.current ?? [],
			loading: queries.some((query) => query.isLoading),
			failed: queries.some((query) => !!query.error)
		}
	}

	private source(): BankSource {
		return {
			organizationId: this.organizationId,
			userId: this.session.getSnapshot().account?.id,
			sessionReady: this.session.getSnapshot().status === 'ready',
			membership: this.memberships.one,
			connections: this.connections.current ?? [],
			accounts: this.accounts.current ?? [],
			links: this.links.current ?? []
		}
	}
	private readiness(): ReadinessObservation {
		const source = this.source()
		return {
			source: {
				organizationId: source.organizationId,
				userId: source.userId,
				membership: source.membership
			},
			sessionStatus: this.session.getSnapshot().status,
			membershipLoading: this.memberships.isLoading,
			membershipError: this.memberships.error,
			organizations: this.organizations.current,
			organizationsLoading: this.organizations.isLoading,
			organizationsError: this.organizations.error,
			route: this.options.route()
		}
	}
	private ledgerActive() {
		const pathname = this.options.route().pathname
		return (
			pathname === '/expenses' ||
			pathname.startsWith('/expenses/') ||
			pathname === '/income' ||
			pathname.startsWith('/income/')
		)
	}
	private bindQueries(ready: boolean) {
		this.ledger.bind(
			this.organizationId,
			ready && (this.ledgerActive() || this.options.route().pathname === '/'),
			this.options.route().pathname === '/',
			this.schedule
		)
		const organizationId = this.organizationId,
			userId = this.session.getSnapshot().account?.id
		this.memberships.set(
			JSON.stringify([organizationId, userId]),
			organizationMembershipQuery(organizationId, userId)
		)
		this.organizations.set(String(ready), ready ? app.organizations.orderBy('name') : undefined)
		const scoped = ready && organizationId
		const selected = transactionEditRoute(this.options.route().pathname)
		this.transferRead.bind(scoped && selected ? scoped : null)
		this.transactionDetail.set(
			JSON.stringify([scoped, selected?.kind, selected?.transactionId]),
			scoped && selected
				? transactionDetailQuery.where({
						organizationId: scoped,
						id: selected.transactionId,
						kind: selected.kind
					})
				: undefined
		)
		this.ownGrants.set(
			JSON.stringify([scoped, userId]),
			scoped && userId
				? app.accountMemberships.where({ organizationId: scoped, userId })
				: undefined
		)
		const actionAccount =
			scoped &&
			this.actionAccountId &&
			canManageAccountDeleteGrants(this.deleteGrantObservation()) &&
			this.accounts.current?.some((row) => row.id === this.actionAccountId)
				? this.actionAccountId
				: null
		this.members.set(
			JSON.stringify([scoped, !!actionAccount]),
			actionAccount && scoped
				? app.organizationMembers.where({ organizationId: scoped }).orderBy('id')
				: undefined
		)
		this.actionGrants.set(
			JSON.stringify([scoped, actionAccount]),
			actionAccount && scoped
				? app.accountMemberships.where({ organizationId: scoped, accountId: actionAccount })
				: undefined
		)
		this.categories.set(
			JSON.stringify(scoped),
			scoped ? app.categories.where({ organizationId: scoped }).orderBy('name') : undefined
		)
		this.tags.set(
			JSON.stringify(scoped),
			scoped ? app.tags.where({ organizationId: scoped }).orderBy('name') : undefined
		)
		this.accounts.set(
			JSON.stringify(scoped),
			scoped
				? app.accounts
						.where({ organizationId: scoped, archivedAt: { isNull: true } })
						.orderBy('name')
				: undefined
		)
		this.transactions.set(
			JSON.stringify(scoped),
			scoped ? transactionSummaryQuery.where({ organizationId: scoped }) : undefined
		)
		this.connections.set(
			JSON.stringify([scoped, userId]),
			scoped && userId
				? app.simplefinConnections.where({ organizationId: scoped, ownerId: userId })
				: undefined
		)
		this.links.set(
			JSON.stringify(scoped),
			scoped ? app.simplefinAccountLinks.where({ organizationId: scoped }) : undefined
		)
	}
	refresh() {
		const actor = selectAttachedWorkspace(this.application.getSnapshot(), this.attachment)
		if (actor !== this.actor) {
			this.subscription?.unsubscribe()
			this.actor = actor
			this.subscription = actor?.subscribe({ next: this.schedule, error: this.options.failed })
		}
		const view = selectWorkspaceView(actor?.getSnapshot())
		const organizationId = this.organizationId
		if (
			organizationId !== this.observedOrganization ||
			(view.resourceLease
				? !this.observedLease || !sameWorkspaceLease(view.resourceLease, this.observedLease)
				: this.observedLease !== undefined)
		) {
			this.observedOrganization = organizationId
			this.observedLease = view.resourceLease
			this.ledger.reset()
			this.generation = this.nextGeneration()
			this.accountOffset = 0
			this.actionAccountId = null
			this.permissionOffset = 0
			this.categoryOffset = 0
			this.tagOffset = 0
			this.categoryFilter = 'active'
			this.tagFilter = 'active'
			this.categoryOptionsKind = 'expense'
			this.categoryOptionsOffset = 0
		}
		const forms = selectedResourceFormsActor(
			actor?.getSnapshot().context.resourceActor?.getSnapshot()
		)
		if (forms !== this.forms) {
			this.formsSubscription?.unsubscribe()
			for (const subscription of this.formSubscriptions) subscription.unsubscribe()
			this.forms = forms
			this.formsSubscription = forms?.subscribe({ next: this.schedule, error: this.options.failed })
			this.formSubscriptions = [
				forms?.getSnapshot().children.transaction,
				forms?.getSnapshot().children.accountArchive,
				forms?.getSnapshot().children.deleteGrants,
				forms?.getSnapshot().children.account,
				forms?.getSnapshot().children.category,
				forms?.getSnapshot().children.tag,
				forms?.getSnapshot().children.categoryArchive,
				forms?.getSnapshot().children.tagArchive
			].flatMap((child) =>
				child ? [child.subscribe({ next: this.schedule, error: this.options.failed })] : []
			)
		}
		this.bindQueries(view.ready)
		const route = this.options.route(),
			session = this.session.getSnapshot()
		const readiness = [
			actor,
			session.status,
			session.account?.id,
			organizationId,
			this.memberships.current,
			this.memberships.isLoading,
			this.memberships.error,
			this.organizations.current,
			this.organizations.isLoading,
			this.organizations.error,
			route.pathname,
			route.search,
			route.hash
		]
		if (actor && !sameFacts(this.readinessFacts, readiness)) {
			this.readinessFacts = readiness
			this.application.send({
				type: 'WORKSPACE_SELECTION_OBSERVED',
				attachment: this.attachment,
				observation: this.readiness()
			})
		}
		const managementQueryFacts = [
			...readiness,
			this.categories.current,
			this.categories.isLoading,
			this.categories.error,
			this.tags.current,
			this.tags.isLoading,
			this.tags.error,
			this.transactions.current,
			this.transactions.isLoading,
			this.transactions.error
		]
		const managementFacts = [
			...managementQueryFacts,
			this.categoryOffset,
			this.tagOffset,
			this.categoryFilter,
			this.tagFilter,
			this.categoryOptionsKind,
			this.categoryOptionsOffset
		]
		if (!sameFacts(this.managementFacts, managementFacts)) {
			this.managementFacts = managementFacts
			this.managementData = projectManagementData({
				category: this.managementObservation('category'),
				tag: this.managementObservation('tag'),
				transactions: this.transactions.current ?? [],
				binding: this.db,
				categoryOffset: this.categoryOffset,
				tagOffset: this.tagOffset,
				categoryFilter: this.categoryFilter,
				tagFilter: this.tagFilter,
				categoryOptionsKind: this.categoryOptionsKind,
				categoryOptionsOffset: this.categoryOptionsOffset
			})
		}
		const transactionRouteFacts = [forms, this.options.route().pathname]
		if (forms && !sameFacts(this.transactionRouteFacts, transactionRouteFacts)) {
			this.transactionRouteFacts = transactionRouteFacts
			forms.send({
				type: 'TRANSACTION_ROUTE',
				route: transactionRoute(this.options.route().pathname)
			})
		}
		const transaction = selectWorkspaceTransactionRoute(forms?.getSnapshot())
		if (transaction.generation !== this.transactionController) {
			this.transactionController = transaction.generation
			this.transactionOffsets = { accounts: 0, categories: 0, tags: 0, transfers: 0, savedTags: 0 }
		}
		const editTransferState = selectWorkspaceTransactionTransferObservationState(
			forms?.getSnapshot()
		)
		const formFacts = [
			forms,
			editTransferState.scopeGeneration,
			editTransferState.searchEnabled,
			...this.transferRead.facts(),
			this.options.route().pathname,
			this.transactionDetail.current,
			this.transactionDetail.isLoading,
			this.transactionDetail.error,
			...managementQueryFacts,
			this.accounts.current,
			this.accounts.isLoading,
			this.accounts.error,
			this.ownGrants.current,
			this.ownGrants.isLoading,
			this.ownGrants.error,
			this.members.current,
			this.members.isLoading,
			this.members.error,
			this.actionGrants.current,
			this.actionGrants.isLoading,
			this.actionGrants.error
		]
		if (forms && !sameFacts(this.formFacts, formFacts)) {
			this.formFacts = formFacts
			forms.send({ type: 'OBSERVE' })
		}
		const revision = view.bankRevision,
			userId = session.account?.id
		if (actor && revision !== undefined) {
			const connections = (this.connections.current ?? []).filter(
				(row) => row.organizationId === organizationId && row.ownerId === userId
			)
			const scope = { organizationId, userId }
			const connectionFacts = [actor, revision, organizationId, userId, this.connections.current]
			if (!sameFacts(this.connectionFacts, connectionFacts)) {
				this.connectionFacts = connectionFacts
				const event: BankObservationEvent = {
					type: 'CONNECTIONS_CHANGED',
					revision,
					connections: connections.map(
						({
							id,
							organizationId,
							ownerId,
							status,
							ciphertext,
							credentialId,
							prfSalt,
							iv,
							credentialVersion
						}) => ({
							id,
							organizationId,
							ownerId,
							status,
							ciphertext,
							credentialId,
							prfSalt,
							iv,
							credentialVersion
						})
					)
				}
				actor.send({ type: 'BANK_OBSERVED', ...scope, event })
			}
			if (!sameFacts(this.historyFacts, connectionFacts)) {
				this.historyFacts = connectionFacts
				const event: BankObservationEvent = {
					type: 'HISTORY_CHANGED',
					revision,
					records: connections.map(
						({ id, lastSyncAt, lastOutcome, importedCount, existingCount, omittedCount }) => ({
							id,
							lastSyncAt,
							lastOutcome,
							importedCount,
							existingCount,
							omittedCount
						})
					)
				}
				actor.send({ type: 'BANK_OBSERVED', ...scope, event })
			}
			const mappingFacts = [
				actor,
				revision,
				organizationId,
				userId,
				this.accounts.current,
				this.links.current
			]
			if (!sameFacts(this.mappingFacts, mappingFacts)) {
				this.mappingFacts = mappingFacts
				const event: BankObservationEvent = {
					type: 'MAPPING_DATA_CHANGED',
					revision,
					data: bankData({
						organizationId,
						accounts: this.accounts.current ?? [],
						links: this.links.current ?? []
					})
				}
				actor.send({ type: 'BANK_OBSERVED', ...scope, event })
			}
		}
		const balanceFacts = [
			view.ready,
			this.accounts.current,
			this.accounts.isLoading,
			this.accounts.error,
			this.transactions.current,
			this.transactions.isLoading,
			this.transactions.error
		]
		if (!sameFacts(this.balanceFacts, balanceFacts)) {
			this.balanceFacts = balanceFacts
			this.balances =
				!view.ready ||
				this.accounts.isLoading ||
				this.accounts.error ||
				this.transactions.isLoading ||
				this.transactions.error
					? null
					: calculateAccountBalances(this.accounts.current ?? [], this.transactions.current ?? [])
		}
	}
	command(generation: number, command: WorkspaceCommand) {
		if (generation !== this.generation || !this.currentBinding()) return
		if (this.actor?.getSnapshot().status === 'active') this.actor.send(command)
	}
	private currentBinding() {
		return (
			this.application.getSnapshot().matches({ running: 'ready' }) &&
			this.application.getSnapshot().context.attachmentRevision === this.revision &&
			this.session.getSnapshot().status === 'ready' &&
			this.session.getSnapshot().client?.db === this.db &&
			this.observedOrganization === this.organizationId
		)
	}
	private currentForms() {
		if (!this.currentBinding()) return undefined
		const snapshot = this.actor?.getSnapshot()
		const lease = selectWorkspaceView(snapshot).resourceLease
		if (
			!lease ||
			!this.observedLease ||
			lease.request.workspaceId !== this.organizationId ||
			!sameWorkspaceLease(lease, this.observedLease)
		)
			return undefined
		return selectedResourceFormsActor(snapshot?.context.resourceActor?.getSnapshot())
	}
	nameText(
		generation: number,
		form: NameFormSlot,
		draftRevision: number,
		command: NativeTextCommand
	) {
		if (generation !== this.generation) return undefined
		const forms = this.currentForms()
		if (!forms) return undefined
		const view =
			form === 'account'
				? selectWorkspaceAccountForm(forms.getSnapshot())
				: selectWorkspaceManagementForms(forms.getSnapshot())[form]
		if (view?.draftRevision !== draftRevision) return undefined
		const before = selectWorkspaceNameTextReply(forms.getSnapshot(), form)
		forms.send({ type: 'NAME_TEXT', form, draftRevision, command })
		const reply = selectWorkspaceNameTextReply(forms.getSnapshot(), form)
		return reply !== before && reply?.requestId === command.requestId ? reply : undefined
	}
	accountCommand(generation: number, command: AccountFormCommand, draftRevision: number) {
		if (generation !== this.generation) return
		const forms = this.currentForms()
		if (selectWorkspaceAccountForm(forms?.getSnapshot())?.draftRevision !== draftRevision) return
		forms?.send({ type: 'ACCOUNT', command })
	}

	managementCommand(
		generation: number,
		form: ManagementFormSlot,
		command: ManagementFormCommand,
		draftRevision: number
	) {
		if (generation !== this.generation) return
		const forms = this.currentForms()
		if (selectWorkspaceManagementForms(forms?.getSnapshot())[form]?.draftRevision !== draftRevision)
			return
		forms?.send({ type: 'MANAGEMENT', form, command })
	}

	managementFilter(
		generation: number,
		catalog: 'categories' | 'tags',
		filter: 'active' | 'archived' | 'all'
	) {
		if (generation !== this.generation || !this.currentForms()) return
		if (catalog === 'categories') {
			this.categoryFilter = filter
			this.categoryOffset = 0
		} else {
			this.tagFilter = filter
			this.tagOffset = 0
		}
		this.schedule()
	}
	managementOptions(generation: number, kind: 'expense' | 'income', offset: number) {
		if (generation !== this.generation || !this.currentForms()) return
		this.categoryOptionsKind = kind
		this.categoryOptionsOffset = offset
		this.schedule()
	}

	overviewCommand(generation: number, command: OverviewCommand) {
		if (
			generation !== this.generation ||
			!this.currentBinding() ||
			!selectWorkspaceView(this.actor?.getSnapshot()).ready ||
			this.options.route().pathname !== '/'
		)
			return
		this.ledger.overviewCommand(command)
	}
	ledgerCommand(generation: number, command: LedgerCommand) {
		if (
			generation !== this.generation ||
			!this.currentForms() ||
			!(this.ledgerActive() || this.options.route().pathname === '/')
		)
			return
		this.ledger.command(command, this.accounts.current ?? [])
	}
	transactionText(
		generation: number,
		formGeneration: number,
		draftRevision: number,
		command: NativeTextCommand
	) {
		if (generation !== this.generation) return undefined
		const forms = this.currentForms()
		const route = selectWorkspaceTransactionRoute(forms?.getSnapshot())
		if (
			!forms ||
			route.mode !== 'active' ||
			route.generation !== formGeneration ||
			route.form?.draftRevision !== draftRevision ||
			route.route?.pathname !== this.options.route().pathname
		)
			return undefined
		const previous = selectWorkspaceTransactionTextReply(forms.getSnapshot())
		forms.send({ type: 'TRANSACTION_TEXT', generation: formGeneration, draftRevision, command })
		const reply = selectWorkspaceTransactionTextReply(forms.getSnapshot())
		return reply !== previous && reply?.requestId === command.requestId ? reply : undefined
	}
	transactionCommand(
		generation: number,
		formGeneration: number,
		command: TransactionRouteIntent,
		draftRevision: number
	) {
		if (generation !== this.generation) return
		const forms = this.currentForms()
		const route = selectWorkspaceTransactionRoute(forms?.getSnapshot())
		if (
			!forms ||
			route.mode !== 'active' ||
			route.generation !== formGeneration ||
			route.form?.draftRevision !== draftRevision ||
			route.route?.pathname !== this.options.route().pathname
		)
			return
		forms.send({ type: 'TRANSACTION_FORM', generation: formGeneration, command })
	}
	transactionEditCommand(
		generation: number,
		formGeneration: number,
		command: TransactionEditIntent
	) {
		if (generation !== this.generation) return
		const forms = this.currentForms(),
			route = selectWorkspaceTransactionRoute(forms?.getSnapshot())
		if (
			!forms ||
			route.mode !== 'active' ||
			route.generation !== formGeneration ||
			route.route?.pathname !== this.options.route().pathname ||
			!('transactionId' in route.route)
		)
			return
		forms.send({ type: 'TRANSACTION_EDIT', generation: formGeneration, command })
	}

	transactionOptions(
		generation: number,
		formGeneration: number,
		catalog: 'accounts' | 'categories' | 'tags' | 'transfers' | 'savedTags',
		offset: number
	) {
		if (generation !== this.generation) return
		const route = selectWorkspaceTransactionRoute(this.currentForms()?.getSnapshot())
		if (
			route.mode !== 'active' ||
			route.generation !== formGeneration ||
			route.route?.pathname !== this.options.route().pathname
		)
			return
		this.transactionOffsets[catalog] = offset
		this.schedule()
	}
	accountAction(generation: number, command: AccountActionsIntent) {
		if (generation !== this.generation) return
		const forms = this.currentForms()
		if (!forms) return
		if (command.type === 'ARCHIVE_ACCOUNT') forms.send(command)
		if (command.type === 'SET_DELETE' && this.actionAccountId === command.accountId)
			forms.send(command)
		if (command.type === 'ACCOUNT_ACTIONS') {
			if (!command.open && command.accountId !== this.actionAccountId) return
			this.actionAccountId = command.open ? command.accountId : null
			this.permissionOffset = 0
			this.schedule()
		}
		if (command.type === 'ACCOUNT_PERMISSIONS_PAGE' && this.actionAccountId) {
			this.permissionOffset = command.offset
			this.schedule()
		}
	}

	project(): PublicWorkspaceView {
		if (!this.currentBinding()) return emptyWorkspaceView(this.generation)
		const view = selectWorkspaceView(this.actor?.getSnapshot())
		const organizations = this.organizations.current ?? []
		const accounts =
			view.navigation === 'scoped' &&
			view.resourceLease?.request.workspaceId === this.organizationId
				? (this.accounts.current ?? [])
				: []
		const organizationOffset = Math.min(
			this.organizationOffset,
			Math.max(0, Math.floor((organizations.length - 1) / CATALOG_PAGE_SIZE) * CATALOG_PAGE_SIZE)
		)
		const accountOffset = Math.min(
			this.accountOffset,
			Math.max(0, Math.floor((accounts.length - 1) / CATALOG_PAGE_SIZE) * CATALOG_PAGE_SIZE)
		)
		const transaction = selectWorkspaceTransactionRoute(this.currentForms()?.getSnapshot())
		return {
			transaction: projectTransactionRoute({
				view: transaction,
				pathname: this.options.route().pathname,
				observation: transaction.route
					? this.transactionObservation(transaction.route.kind)
					: undefined,
				accountOffset: this.transactionOffsets.accounts,
				categoryOffset: this.transactionOffsets.categories,
				tagOffset: this.transactionOffsets.tags,
				transferOffset: this.transactionOffsets.transfers,
				transferLabels: (id) => this.transferRead.labels(id),
				savedTagOffset: this.transactionOffsets.savedTags,
				isSelected: this.ledger.isAccountSelected
			}),
			overview: this.ledger.projectOverview({
				route: this.options.route(),
				active: view.ready && this.options.route().pathname === '/',
				categories: this.categories.current ?? [],
				tags: this.tags.current ?? [],
				loading: this.categories.isLoading || this.tags.isLoading,
				failed: !!this.categories.error || !!this.tags.error
			}),
			ledger: this.ledger.project({
				route: this.options.route(),
				active: view.ready && this.ledgerActive(),
				categories: this.categories.current ?? [],
				tags: this.tags.current ?? [],
				loading: this.categories.isLoading || this.tags.isLoading,
				failed: !!this.categories.error || !!this.tags.error
			}),
			management: {
				...(this.managementData ?? emptyManagementView()),
				forms: projectManagementForms(
					selectWorkspaceManagementForms(this.currentForms()?.getSnapshot())
				)
			},
			accountActions: projectAccountActions({
				...selectWorkspaceAccountActions(this.currentForms()?.getSnapshot()),
				observation: this.deleteGrantObservation(),
				selectedAccountId: this.actionAccountId,
				accountOffset,
				permissionOffset: this.permissionOffset,
				balancesReady: this.balances !== null
			}),
			accountDefaultCurrency:
				organizations.find((row) => row.id === this.organizationId)?.defaultCurrency === 'TZS'
					? 'TZS'
					: 'USD',
			accountForm: projectAccountForm(
				selectWorkspaceAccountForm(this.currentForms()?.getSnapshot())
			),
			generation: this.generation,
			organizationId: this.organizationId,
			ready: view.ready,
			failed: view.failed,
			canRetry: view.canRetry,
			canSync: view.canSync,
			navigation: view.navigation,
			integrity: view.integrity,
			creation: {
				...view.creation,
				name: view.creation.name.slice(0, 4096),
				workspace: view.creation.workspace ? publicOrganization(view.creation.workspace) : null
			},
			organizations: organizations
				.slice(organizationOffset, organizationOffset + CATALOG_PAGE_SIZE)
				.map(publicOrganization),
			accounts: accounts.slice(accountOffset, accountOffset + CATALOG_PAGE_SIZE).map((row) => ({
				id: row.id,
				organizationId: row.organizationId,
				name: row.name.slice(0, 4096),
				kind: row.kind,
				currency: row.currency,
				archivedAt: row.archivedAt,
				balanceMinor: this.balances?.get(row.id) ?? null
			})),
			organizationPage: {
				offset: organizationOffset,
				total: organizations.length,
				hasMore: organizationOffset + CATALOG_PAGE_SIZE < organizations.length
			},
			accountPage: {
				offset: accountOffset,
				total: accounts.length,
				hasMore: accountOffset + CATALOG_PAGE_SIZE < accounts.length
			},
			queries: {
				organizationsLoading: this.organizations.isLoading,
				organizationsFailed: !!this.organizations.error,
				accountsLoading: this.accounts.isLoading,
				accountsFailed: !!this.accounts.error,
				balancesLoading: this.transactions.isLoading,
				balancesFailed: !!this.transactions.error
			}
		}
	}
	close() {
		this.ledger.close()
		this.transferRead.close()
		this.formsSubscription?.unsubscribe()
		for (const subscription of this.formSubscriptions) subscription.unsubscribe()
		this.subscription?.unsubscribe()
		for (const slot of [
			this.categories,
			this.tags,
			this.ownGrants,
			this.actionGrants,
			this.members,
			this.memberships,
			this.organizations,
			this.accounts,
			this.transactions,
			this.transactionDetail,
			this.connections,
			this.links
		])
			slot.clear()
		this.application.send({ type: 'DETACH_WORKSPACE', attachment: this.attachment })
	}
}

export class WorkerWorkspaceObservation {
	private scope: WorkspaceScope | undefined
	private session: Session | undefined
	private sessionSubscription: (() => void) | undefined
	private readonly subscription: { unsubscribe: () => void }
	private generation = 0
	private scheduled = false
	private closed = false
	constructor(
		private readonly application: Application,
		private readonly options: WorkspaceObservationOptions
	) {
		this.subscription = application.subscribe({ next: this.schedule, error: options.failed })
		this.schedule()
	}
	refreshRoute = () => this.schedule()
	private schedule = () => {
		if (this.closed || this.scheduled) return
		this.scheduled = true
		queueMicrotask(() => {
			this.scheduled = false
			if (this.closed) return
			try {
				this.refresh()
				this.options.changed()
			} catch {
				this.options.failed()
			}
		})
	}
	private refresh() {
		const snapshot = this.application.getSnapshot(),
			session = snapshot.context.session,
			client = session?.getSnapshot().client
		if (session !== this.session) {
			this.sessionSubscription?.()
			this.session = session
			this.sessionSubscription = session?.subscribe(this.schedule)
		}
		if (
			this.scope &&
			(this.scope.db !== client?.db ||
				this.scope.session !== session ||
				this.scope.revision !== snapshot.context.attachmentRevision)
		) {
			this.scope.close()
			this.scope = undefined
			this.generation++
		}
		if (
			!this.scope &&
			session &&
			client &&
			snapshot.matches({ running: 'ready' }) &&
			session.getSnapshot().status === 'ready'
		) {
			this.scope = new WorkspaceScope(
				this.application,
				session,
				client.db,
				snapshot.context.attachmentRevision,
				this.options,
				this.schedule,
				() => ++this.generation
			)
			this.application.send({ type: 'ATTACH_WORKSPACE', attachment: this.scope.attachment })
		}
		this.scope?.refresh()
	}
	managementFilter = (
		generation: number,
		catalog: 'categories' | 'tags',
		filter: 'active' | 'archived' | 'all'
	) => this.scope?.managementFilter(generation, catalog, filter)
	managementOptions = (generation: number, kind: 'expense' | 'income', offset: number) =>
		this.scope?.managementOptions(generation, kind, offset)

	managementCommand = (
		generation: number,
		form: ManagementFormSlot,
		command: ManagementFormCommand,
		draftRevision: number
	) => this.scope?.managementCommand(generation, form, command, draftRevision)
	overviewCommand = (generation: number, command: OverviewCommand) =>
		this.scope?.overviewCommand(generation, command)
	ledgerCommand = (generation: number, command: LedgerCommand) =>
		this.scope?.ledgerCommand(generation, command)
	transactionEditCommand = (
		generation: number,
		formGeneration: number,
		command: TransactionEditIntent
	) => this.scope?.transactionEditCommand(generation, formGeneration, command)

	transactionText = (
		generation: number,
		formGeneration: number,
		draftRevision: number,
		command: NativeTextCommand
	) => this.scope?.transactionText(generation, formGeneration, draftRevision, command)
	transactionCommand = (
		generation: number,
		formGeneration: number,
		command: TransactionRouteIntent,
		draftRevision: number
	) => this.scope?.transactionCommand(generation, formGeneration, command, draftRevision)
	transactionOptions = (
		generation: number,
		formGeneration: number,
		catalog: 'accounts' | 'categories' | 'tags' | 'transfers' | 'savedTags',
		offset: number
	) => this.scope?.transactionOptions(generation, formGeneration, catalog, offset)
	accountAction = (generation: number, command: AccountActionsIntent) =>
		this.scope?.accountAction(generation, command)
	nameText = (
		generation: number,
		form: NameFormSlot,
		draftRevision: number,
		command: NativeTextCommand
	) => this.scope?.nameText(generation, form, draftRevision, command)
	accountCommand = (generation: number, command: AccountFormCommand, draftRevision: number) =>
		this.scope?.accountCommand(generation, command, draftRevision)
	project = (): PublicWorkspaceView => this.scope?.project() ?? emptyWorkspaceView(this.generation)
	command = (generation: number, command: WorkspaceCommand) =>
		this.scope?.command(generation, command)
	page = (
		generation: number,
		catalog: 'organizations' | 'accounts' | 'categories' | 'tags',
		offset: number
	) => {
		if (!this.scope || generation !== this.scope.generation) return
		if (catalog === 'organizations') this.scope.organizationOffset = offset
		if (catalog === 'accounts') this.scope.accountOffset = offset
		if (catalog === 'categories') this.scope.categoryOffset = offset
		if (catalog === 'tags') this.scope.tagOffset = offset
		this.schedule()
	}
	dispose = () => {
		if (this.closed) return
		this.closed = true
		this.subscription.unsubscribe()
		this.sessionSubscription?.()
		this.scope?.close()
		this.scope = undefined
	}
}
