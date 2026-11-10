import type { TransactionRouteDependencies } from '../transactions/transaction-route-owner.js'
import {
	creationFixture,
	creationFacts,
	creationValues
} from '../transactions/transaction-create.fixture.js'
import { selectWorkspaceNameTextReply, type NameFormSlot } from './workspace-forms.js'
import { selectWorkspaceTransactionRoute } from './workspace-forms.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import {
	createWorkspaceFormsMachine,
	selectWorkspaceAccountForm,
	selectWorkspaceManagementForms,
	selectWorkspaceAccountActions
} from './workspace-forms.js'
import {
	createAccount,
	createCategory,
	createTag,
	archiveCategory,
	archiveTag,
	archiveAccount,
	persistAccountDeleteGrant
} from '../../data.js'
import type { AccountCreationObservation } from '../../contracts/account-creation-contract.js'
import { account, source, id } from '../bank-sync/test-fixtures.js'
import type { ManagementObservation } from '../../contracts/management-contract.js'
import type { Account, Category, Tag } from '../../schema.js'

vi.mock('../../data.js', async (original) => ({
	...(await original<typeof import('../../data.js')>()),
	createAccount: vi.fn(),
	createCategory: vi.fn(),
	createTag: vi.fn(),
	archiveCategory: vi.fn(),
	archiveTag: vi.fn(),
	archiveAccount: vi.fn(),
	persistAccountDeleteGrant: vi.fn()
}))
class Binding {
	update(): never {
		throw new Error('Unexpected direct write')
	}
	insert(): never {
		throw new Error('Unexpected direct write')
	}
}
const roots = new Set<
	ReturnType<typeof createActor<ReturnType<typeof createWorkspaceFormsMachine>>>
>()
afterEach(() => {
	for (const root of roots) root.stop()
	roots.clear()
	vi.clearAllMocks()
})
function fixture(transaction?: TransactionRouteDependencies) {
	const db = new Binding()
	let facts: AccountCreationObservation = {
		identityId: id(1),
		organizationId: id(2),
		binding: db,
		sessionReady: true,
		membership: source.membership,
		accounts: [],
		loading: false,
		error: undefined
	}
	const pending = Promise.withResolvers<Account>()
	const pendingArchive = Promise.withResolvers<void>()
	const pendingGrant = Promise.withResolvers<void>()
	vi.mocked(archiveAccount).mockImplementation(() => pendingArchive.promise)
	vi.mocked(persistAccountDeleteGrant).mockImplementation(() => pendingGrant.promise)
	const pendingCategory = Promise.withResolvers<Category>()
	const pendingTag = Promise.withResolvers<Tag>()
	vi.mocked(createCategory).mockImplementation(() => pendingCategory.promise)
	vi.mocked(createTag).mockImplementation(() => pendingTag.promise)
	vi.mocked(archiveCategory).mockResolvedValue(undefined)
	vi.mocked(archiveTag).mockResolvedValue(undefined)
	let management: ManagementObservation = { ...facts, categories: [], tags: [], failed: false }
	let categoryFailed = false
	vi.mocked(createAccount).mockImplementation(() => pending.promise)
	const root = createActor(
		createWorkspaceFormsMachine(db, {
			...(transaction ? { transaction } : {}),
			account: () => facts,
			deleteGrants: () => ({
				...facts,
				accounts: [account],
				failed: false,
				members: [{ ...source.membership!, id: id(42), userId: id(43), role: 'member' }],
				grants: []
			}),
			management: (kind) => ({
				...management,
				failed: kind === 'category' ? categoryFailed || management.failed : management.failed
			})
		})
	).start()
	roots.add(root)
	return {
		root,
		pending,
		pendingArchive,
		pendingGrant,
		actionsView: () => selectWorkspaceAccountActions(root.getSnapshot()),
		pendingCategory,
		pendingTag,
		managementView: () => selectWorkspaceManagementForms(root.getSnapshot()),
		changeManagement: (patch: Partial<ManagementObservation>, failCategory = false) => {
			management = { ...management, ...patch }
			categoryFailed = failCategory
			root.send({ type: 'OBSERVE' })
		},
		db,
		view: () => selectWorkspaceAccountForm(root.getSnapshot()),
		change: (patch: Partial<AccountCreationObservation>) => {
			facts = { ...facts, ...patch }
			root.send({ type: 'OBSERVE' })
		}
	}
}
it('keeps authorization and validation in the existing worker form before starting a save', async () => {
	const f = fixture()
	await vi.waitFor(() => expect(f.view()?.canSubmit).toBe(true))
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'SUBMIT', values: { name: '', kind: 'cash', currency: 'USD' } }
	})
	await vi.waitFor(() => expect(f.view()?.feedback.kind).toBe('result'))
	expect(f.view()?.feedback).toMatchObject({ kind: 'result', result: { outcome: 'invalid' } })
	expect(createAccount).not.toHaveBeenCalled()
	f.change({ membership: { ...source.membership!, role: 'viewer' } })
	await vi.waitFor(() =>
		expect(f.view()?.readiness).toEqual({ kind: 'blocked', reason: 'readOnly' })
	)
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'SUBMIT', values: { name: 'Cash', kind: 'cash', currency: 'USD' } }
	})
	expect(createAccount).not.toHaveBeenCalled()
})
it('waits for actual financial settlement before acknowledging shutdown and rejects further drafts', async () => {
	const f = fixture()
	await vi.waitFor(() => expect(f.view()?.canSubmit).toBe(true))
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'SUBMIT', values: { name: 'Cash', kind: 'cash', currency: 'USD' } }
	})
	await vi.waitFor(() => expect(createAccount).toHaveBeenCalledOnce())
	f.root.send({ type: 'SHUTDOWN' })
	expect(f.root.getSnapshot().matches({ owning: { control: 'draining' } })).toBe(true)
	expect(f.root.getSnapshot().status).toBe('active')
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'SUBMIT', values: { name: 'Ignored', kind: 'cash', currency: 'USD' } }
	})
	f.pending.resolve(account)
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
	expect(createAccount).toHaveBeenCalledOnce()
})
it('projects the actual persisted account outcome and detects duplicate names in worker observations', async () => {
	const f = fixture()
	await vi.waitFor(() => expect(f.view()?.canSubmit).toBe(true))
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'SUBMIT', values: { name: 'Checking', kind: 'bank', currency: 'USD' } }
	})
	await vi.waitFor(() => expect(createAccount).toHaveBeenCalledOnce())
	f.pending.resolve(account)
	await vi.waitFor(() => expect(f.view()?.content).toEqual({ kind: 'success', value: account }))
	expect(f.view()?.feedback).toMatchObject({
		kind: 'result',
		result: { outcome: 'succeeded', settlement: 'locallyPersisted', value: account }
	})
	f.root.send({ type: 'ACCOUNT', command: { type: 'RESET' } })
	f.change({ accounts: [account] })
	await vi.waitFor(() => expect(f.view()?.canSubmit).toBe(true))
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'SUBMIT', values: { name: ' checking ', kind: 'bank', currency: 'USD' } }
	})
	await vi.waitFor(() =>
		expect(f.view()?.feedback).toMatchObject({
			kind: 'result',
			result: { outcome: 'unavailable', reason: 'duplicateName' }
		})
	)
	expect(createAccount).toHaveBeenCalledOnce()
})

const category: Category = {
	id: id(20),
	organizationId: id(2),
	name: 'Bills',
	kind: 'expense',
	isSystem: false,
	archivedAt: null
}
const tag: Tag = {
	id: id(21),
	organizationId: id(2),
	name: 'Recurring',
	kind: 'expense',
	categoryId: category.id,
	archivedAt: null
}
it('joins category and tag persistence independently before releasing the form owner', async () => {
	const f = fixture()
	await vi.waitFor(() =>
		expect(f.managementView().category?.canSubmit && f.managementView().tag?.canSubmit).toBe(true)
	)
	f.root.send({
		type: 'MANAGEMENT',
		form: 'category',
		command: { type: 'SUBMIT', values: { name: 'Bills', kind: 'expense' } }
	})
	f.root.send({
		type: 'MANAGEMENT',
		form: 'tag',
		command: { type: 'SUBMIT', values: { name: 'Recurring', kind: 'expense', categoryId: null } }
	})
	await vi.waitFor(() => {
		expect(createCategory).toHaveBeenCalledOnce()
		expect(createTag).toHaveBeenCalledOnce()
	})
	f.root.send({ type: 'SHUTDOWN' })
	f.pendingCategory.resolve(category)
	await vi.waitFor(() =>
		expect(f.root.getSnapshot().context.results.category).toEqual({ outcome: 'released' })
	)
	expect(f.root.getSnapshot().status).toBe('active')
	f.pendingTag.resolve(tag)
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
})
it('preserves protected-record and reference authorization before archive or tag writes', async () => {
	const f = fixture()
	f.changeManagement({
		categories: [
			{ ...category, isSystem: true },
			{ ...category, id: id(22), kind: 'income' }
		],
		tags: [tag]
	})
	await vi.waitFor(() => expect(f.managementView().categoryArchive?.canSubmit).toBe(true))
	f.root.send({
		type: 'MANAGEMENT',
		form: 'categoryArchive',
		command: { type: 'SUBMIT', values: { categoryId: category.id, organizationId: id(2) } }
	})
	await vi.waitFor(() =>
		expect(f.managementView().categoryArchive?.feedback).toMatchObject({
			kind: 'result',
			result: { outcome: 'denied', reason: 'protectedRecord' }
		})
	)
	f.root.send({
		type: 'MANAGEMENT',
		form: 'tag',
		command: { type: 'SUBMIT', values: { name: 'Wrong kind', kind: 'expense', categoryId: id(22) } }
	})
	await vi.waitFor(() =>
		expect(f.managementView().tag?.feedback).toMatchObject({
			kind: 'result',
			result: { outcome: 'unavailable', reason: 'unavailableReference' }
		})
	)
	expect(archiveCategory).not.toHaveBeenCalled()
	expect(createTag).not.toHaveBeenCalled()
})
it('detects normalized duplicate names and returns the assessed archive display name after settlement', async () => {
	const f = fixture()
	f.changeManagement({ categories: [category], tags: [tag] })
	await vi.waitFor(() => expect(f.managementView().category?.canSubmit).toBe(true))
	f.root.send({
		type: 'MANAGEMENT',
		form: 'category',
		command: { type: 'SUBMIT', values: { name: ' bills ', kind: 'expense' } }
	})
	await vi.waitFor(() =>
		expect(f.managementView().category?.feedback).toMatchObject({
			kind: 'result',
			result: { outcome: 'unavailable', reason: 'duplicateName' }
		})
	)
	expect(createCategory).not.toHaveBeenCalled()
	f.root.send({
		type: 'MANAGEMENT',
		form: 'tagArchive',
		command: { type: 'SUBMIT', values: { tagId: tag.id, organizationId: id(2) } }
	})
	await vi.waitFor(() =>
		expect(f.managementView().tagArchive?.feedback).toMatchObject({
			kind: 'result',
			result: { outcome: 'succeeded', value: tag.name, settlement: 'locallyPersisted' }
		})
	)
	expect(archiveTag).toHaveBeenCalledWith(f.db, tag.id)
})
it('keeps tag availability independent of transaction-history query failures', async () => {
	const f = fixture()
	f.changeManagement({}, true)
	await vi.waitFor(() =>
		expect(f.managementView().category?.readiness).toEqual({
			kind: 'blocked',
			reason: 'loadFailed'
		})
	)
	expect(f.managementView().tag?.readiness).toEqual({ kind: 'ready' })
})

it('joins issued archive and delete-access writes before releasing the workspace', async () => {
	const f = fixture()
	f.change({ accounts: [account] })
	await vi.waitFor(() => expect(f.actionsView().archive?.rows[0]?.action).toBe('available'))
	f.root.send({ type: 'ARCHIVE_ACCOUNT', accountId: account.id })
	f.root.send({ type: 'SET_DELETE', accountId: account.id, userId: id(43), canDelete: true })
	await vi.waitFor(() => {
		expect(archiveAccount).toHaveBeenCalledOnce()
		expect(persistAccountDeleteGrant).toHaveBeenCalledOnce()
	})
	f.root.send({ type: 'SHUTDOWN' })
	f.pendingArchive.resolve()
	await vi.waitFor(() =>
		expect(f.root.getSnapshot().context.results.accountArchive).toEqual({ outcome: 'released' })
	)
	expect(f.root.getSnapshot().status).toBe('active')
	f.root.send({ type: 'SET_DELETE', accountId: account.id, userId: id(43), canDelete: false })
	f.pendingGrant.resolve()
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
	expect(persistAccountDeleteGrant).toHaveBeenCalledOnce()
})

it('joins a pending transaction save before releasing the workspace form owner', async () => {
	const transaction = creationFixture()
	const settled = Promise.withResolvers<void>()
	transaction.wait.mockImplementation(() => settled.promise)
	const f = fixture({
		db: transaction.db,
		observe: (kind) => ({ ...creationFacts(transaction.db), kind })
	})
	f.root.send({ type: 'TRANSACTION_ROUTE', route: { kind: 'expense', pathname: '/expenses/new' } })
	await vi.waitFor(() =>
		expect(selectWorkspaceTransactionRoute(f.root.getSnapshot()).form?.canSubmit).toBe(true)
	)
	const generation = selectWorkspaceTransactionRoute(f.root.getSnapshot()).generation
	f.root.send({
		type: 'TRANSACTION_FORM',
		generation,
		command: {
			type: 'SUBMIT',
			values: {
				accountId: creationValues.accountId,
				categoryId: creationValues.categoryId,
				amount: '1.00',
				bookedOn: '2026-10-18',
				tags: []
			}
		}
	})
	await vi.waitFor(() => expect(transaction.wait).toHaveBeenCalledOnce())
	f.root.send({ type: 'SHUTDOWN' })
	expect(f.root.getSnapshot().status).toBe('active')
	expect(f.root.getSnapshot().output).toBeUndefined()
	settled.resolve()
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
})

function stageName(f: ReturnType<typeof fixture>, form: NameFormSlot, name: string) {
	const revision = (form === 'account' ? f.view() : f.managementView()[form])?.draftRevision
	if (revision === undefined) throw new Error('Missing form revision')
	const requestId = id(91)
	const send = (command: import('../../contracts/native-text-transfer.js').NativeTextCommand) =>
		f.root.send({ type: 'NAME_TEXT', form, draftRevision: revision, command })
	send({ type: 'START', requestId, field: 'name' })
	let index = 0
	for (let offset = 0; offset < name.length; offset += 4096)
		send({ type: 'CHUNK', requestId, index: index++, text: name.slice(offset, offset + 4096) })
	send({ type: 'COMMIT', requestId, parts: index })
	const reply = selectWorkspaceNameTextReply(f.root.getSnapshot(), form)
	expect(reply?.status).toBe('ready')
	return {
		kind: 'text',
		reference: reply?.reference,
		version: reply?.version,
		textScope: reply?.textScope
	}
}
it('validates full private account names and joins name cleanup with financial settlement', async () => {
	const f = fixture(),
		name = 'Long account '.repeat(600) + 'Tail'
	await vi.waitFor(() => expect(f.view()?.canSubmit).toBe(true))
	const reference = stageName(f, 'account', name)
	if (!reference.reference || reference.version === undefined || !reference.textScope)
		throw new Error('Missing reference')
	f.root.send({
		type: 'ACCOUNT',
		command: {
			type: 'SUBMIT',
			values: {
				name: {
					kind: 'text',
					reference: reference.reference,
					version: reference.version,
					textScope: reference.textScope
				},
				kind: 'cash',
				currency: 'USD'
			}
		}
	})
	await vi.waitFor(() =>
		expect(createAccount).toHaveBeenCalledWith(f.db, id(2), name, 'cash', 'USD')
	)
	f.root.send({ type: 'SHUTDOWN' })
	expect(f.root.getSnapshot().status).toBe('active')
	f.pending.resolve({ ...account, name })
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
	expect(f.root.getSnapshot().context.results.accountText).toEqual({ outcome: 'released' })
})
it('keeps category and tag names isolated while validating their full private drafts', async () => {
	const f = fixture(),
		categoryName = 'Long category '.repeat(600),
		tagName = 'Long tag '.repeat(800)
	await vi.waitFor(() =>
		expect(f.managementView().category?.canSubmit && f.managementView().tag?.canSubmit).toBe(true)
	)
	const categoryReference = stageName(f, 'category', categoryName),
		tagReference = stageName(f, 'tag', tagName)
	f.root.send({
		type: 'MANAGEMENT',
		form: 'tag',
		command: {
			type: 'SUBMIT',
			values: { name: categoryReference, kind: 'expense', categoryId: null }
		}
	})
	expect(createTag).not.toHaveBeenCalled()
	f.root.send({
		type: 'MANAGEMENT',
		form: 'category',
		command: { type: 'SUBMIT', values: { name: categoryReference, kind: 'expense' } }
	})
	f.root.send({
		type: 'MANAGEMENT',
		form: 'tag',
		command: { type: 'SUBMIT', values: { name: tagReference, kind: 'expense', categoryId: null } }
	})
	await vi.waitFor(() => {
		expect(createCategory).toHaveBeenCalledWith(f.db, id(2), categoryName.trim(), 'expense')
		expect(createTag).toHaveBeenCalledWith(f.db, id(2), tagName.trim(), 'expense', null)
	})
	f.root.send({ type: 'SHUTDOWN' })
	f.pendingCategory.resolve({ ...category, name: categoryName.trim() })
	f.pendingTag.resolve({ ...tag, name: tagName.trim(), categoryId: null })
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
})

it('invalidates staged native names immediately on an admitted form reset', async () => {
	const f = fixture(),
		name = 'Reset name '.repeat(700)
	await vi.waitFor(() => expect(f.view()?.canSubmit).toBe(true))
	const reference = stageName(f, 'account', name)
	if (!reference.reference || reference.version === undefined || !reference.textScope)
		throw new Error('Missing reference')
	const old = {
		kind: 'text',
		reference: reference.reference,
		version: reference.version,
		textScope: reference.textScope
	} satisfies import('../../contracts/native-text-transfer.js').NativeTextReference
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'CHANGE', values: { name: old, kind: 'cash', currency: 'USD' } }
	})
	await vi.waitFor(() => expect(f.view()?.canReset).toBe(true))
	f.root.send({ type: 'ACCOUNT', command: { type: 'RESET' } })
	f.root.send({
		type: 'ACCOUNT',
		command: { type: 'SUBMIT', values: { name: old, kind: 'cash', currency: 'USD' } }
	})
	expect(createAccount).not.toHaveBeenCalled()
	await vi.waitFor(() => expect(f.view()?.canSubmit).toBe(true))
	const current = stageName(f, 'account', name + 'new tail')
	if (!current.reference || current.version === undefined || !current.textScope)
		throw new Error('Missing current reference')
	expect(current.version).toBeGreaterThan(old.version)
	f.root.send({
		type: 'ACCOUNT',
		command: {
			type: 'SUBMIT',
			values: {
				name: {
					kind: 'text',
					reference: current.reference,
					version: current.version,
					textScope: current.textScope
				},
				kind: 'cash',
				currency: 'USD'
			}
		}
	})
	await vi.waitFor(() =>
		expect(createAccount).toHaveBeenCalledWith(f.db, id(2), name + 'new tail', 'cash', 'USD')
	)
	f.pending.resolve({ ...account, name: name + 'new tail' })
	f.root.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.root)).toEqual({ outcome: 'released' })
})
