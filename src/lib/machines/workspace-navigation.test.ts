import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { createWorkspaceNavigationMachine } from './workspace-navigation.js'
import type {
	NavigationStatusEvent,
	WorkspaceNavigationFacts
} from '../contracts/workspace-orchestration-contract.js'
import { workspaceReports } from './workspace-reports.fixture.js'
import { scope, records } from './workspace-integrity.fixture.js'
import {
	switchedWorkspaceHref,
	workspaceHref,
	workspaceLabel,
	workspaceRoute
} from '../domain/workspace-routes.js'
const actors: { stop: () => void }[] = []
afterEach(() => actors.splice(0).forEach((actor) => actor.stop()))
const facts: WorkspaceNavigationFacts = {
	pathname: '/',
	search: '',
	hash: '',
	generation: 0,
	userId: scope.userId,
	ready: true,
	loading: false,
	error: undefined,
	access: 'ready',
	organizations: records().organizations
}
function fixture(input: WorkspaceNavigationFacts = facts) {
	const one = vi.fn().mockResolvedValue(null)
	const navigate = vi.fn(
		async (_url: string, _signal: AbortSignal, _href: string, _replace: boolean) => {}
	)
	const recipient = workspaceReports<NavigationStatusEvent>()
	const actor = createActor(createWorkspaceNavigationMachine({ one }, navigate), {
		input: { facts: input, recipient }
	}).start()
	actors.push(actor, recipient)
	return { actor, one, navigate, reports: () => recipient.getSnapshot().context }
}
describe('workspace navigation public contract', () => {
	it('uses the coordinator access decision even when a workspace row is retained', () => {
		const input = { ...facts, pathname: '/expenses', search: `?workspace=${scope.organizationId}` }
		const f = fixture(input)
		expect(f.actor.getSnapshot().matches('scoped')).toBe(true)
		f.actor.send({ type: 'OBSERVED', facts: { ...input, generation: 1, access: 'denied' } })
		expect(f.reports().at(-1)?.report).toEqual({ generation: 1, status: 'unavailable' })
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it.each(['waiting', 'failed'] satisfies constAccess[])(
		'renders %s access without inventing another authorization policy',
		(access) => {
			const f = fixture({ ...facts, search: `?workspace=${scope.organizationId}`, access })
			expect(f.reports().at(-1)?.report.status).toBe(access)
		}
	)
	it('canonicalizes a sole workspace on the native route and preserves unrelated parameters', async () => {
		const f = fixture({ ...facts, pathname: '/expenses', search: '?page=2', hash: '#row' })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate).toHaveBeenCalledWith(
			`/expenses?page=2&workspace=${scope.organizationId}#row`,
			expect.any(AbortSignal),
			'/expenses?page=2#row',
			true
		)
	})
	it('sends ambiguous workspace-less entry to the sole management URL', async () => {
		const workspace = records().organizations[0]
		if (!workspace) throw new Error('Missing workspace')
		const f = fixture({
			...facts,
			organizations: [workspace, { ...workspace, id: scope.profileId }]
		})
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe('/settings/workspace')
	})
	it('never redirects a denied explicit scope to another workspace', () => {
		const f = fixture({
			...facts,
			pathname: '/expenses',
			search: `?workspace=${scope.profileId}`,
			access: 'denied'
		})
		expect(f.reports().at(-1)?.report.status).toBe('unavailable')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it.each(['/settings/workspace', '/account', '/login'])(
		'keeps %s independent of ledger selection',
		(pathname) => {
			const f = fixture({ ...facts, pathname, access: 'denied' })
			expect(f.reports().at(-1)?.report.status).toBe(
				pathname === '/settings/workspace' ? 'directory' : 'global'
			)
			expect(f.navigate).not.toHaveBeenCalled()
		}
	)
	it.each(['/settings/workspace', '/account', '/login'])(
		'keeps %s available during catalog loading or failure, but requires identity readiness',
		(pathname) => {
			const f = fixture({ ...facts, pathname, loading: true, organizations: [], access: 'waiting' })
			const status = pathname === '/settings/workspace' ? 'directory' : 'global'
			expect(f.reports().at(-1)?.report.status).toBe(status)
			f.actor.send({
				type: 'OBSERVED',
				facts: {
					...facts,
					pathname,
					generation: 1,
					error: new Error('Catalog failed'),
					access: 'failed'
				}
			})
			expect(f.reports().at(-1)?.report).toEqual({ generation: 1, status })
			f.actor.send({ type: 'OBSERVED', facts: { ...facts, pathname, generation: 2, ready: false } })
			expect(f.reports().at(-1)?.report.status).toBe('waiting')
			expect(f.navigate).not.toHaveBeenCalled()
			expect(f.one).not.toHaveBeenCalled()
		}
	)
	it('keeps ledger routes gated by catalog loading and failure', () => {
		const input = { ...facts, pathname: '/expenses', search: `?workspace=${scope.organizationId}` }
		const f = fixture({ ...input, loading: true })
		expect(f.reports().at(-1)?.report.status).toBe('waiting')
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...input, generation: 1, error: new Error('Catalog failed') }
		})
		expect(f.reports().at(-1)?.report.status).toBe('failed')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('records manual switches in history and leaves unfinished transaction entry', async () => {
		const f = fixture({
			...facts,
			pathname: '/expenses/new',
			search: `?workspace=${scope.organizationId}&page=4&filter=recent`,
			hash: '#form'
		})
		f.actor.send({ type: 'SELECT', workspaceId: scope.profileId })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate).toHaveBeenCalledWith(
			`/expenses?workspace=${scope.profileId}&filter=recent`,
			expect.any(AbortSignal),
			`/expenses/new?workspace=${scope.organizationId}&page=4&filter=recent#form`,
			false
		)
	})
	it('resolves a legacy detail through its readable owning workspace', async () => {
		const pending = Promise.withResolvers<{ organizationId: string } | null>()
		const f = fixture({ ...facts, ready: false, pathname: '/income/entry' })
		f.one.mockReturnValue(pending.promise)
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 1, pathname: '/income/entry' }
		})
		pending.resolve({ organizationId: scope.organizationId })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe(workspaceHref(scope.organizationId, '/income/entry'))
	})
	it('discards legacy lookup results after a query-only scope change', async () => {
		const pending = Promise.withResolvers<{ organizationId: string } | null>()
		const f = fixture({ ...facts, ready: false, pathname: '/expenses/entry' })
		f.one.mockReturnValue(pending.promise)
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 1, pathname: '/expenses/entry' }
		})
		f.actor.send({
			type: 'OBSERVED',
			facts: {
				...facts,
				generation: 2,
				pathname: '/expenses/entry',
				search: `?workspace=${scope.profileId}`,
				access: 'denied'
			}
		})
		pending.resolve({ organizationId: scope.organizationId })
		await pending.promise
		await Promise.resolve()
		expect(f.reports().at(-1)?.report).toEqual({ generation: 2, status: 'unavailable' })
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('refreshes in-flight reports without restarting the same lookup', async () => {
		const pending = Promise.withResolvers<{ organizationId: string } | null>()
		const f = fixture({ ...facts, ready: false, pathname: '/expenses/entry' })
		f.one.mockReturnValue(pending.promise)
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 1, pathname: '/expenses/entry' }
		})
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 2, pathname: '/expenses/entry' }
		})
		expect(f.reports().at(-1)?.report).toEqual({ generation: 2, status: 'waiting' })
		expect(f.one).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'SHUTDOWN' })
		pending.resolve({ organizationId: scope.organizationId })
		await pending.promise
		expect(f.actor.getSnapshot().status).toBe('done')
		expect(f.navigate).not.toHaveBeenCalled()
	})
})
type constAccess = 'waiting' | 'failed'

describe('workspace query URLs', () => {
	it('reads query scope and fails closed for malformed, empty and duplicate parameters', () => {
		expect(workspaceRoute(`?workspace=${scope.organizationId}`)).toMatchObject({
			workspaceId: scope.organizationId,
			scoped: true
		})
		for (const search of [
			'?workspace=not-a-uuid',
			'?workspace=',
			`?workspace=${scope.organizationId}&workspace=${scope.organizationId}`
		]) {
			expect(workspaceRoute(search)).toMatchObject({ workspaceId: null, scoped: true })
		}
		expect(workspaceRoute('?page=2').scoped).toBe(false)
	})
	it('switches detail routes to lists while removing pagination and obsolete fragments', () => {
		expect(
			switchedWorkspaceHref(
				scope.profileId,
				'/income/entry',
				`?workspace=${scope.organizationId}&page=3&tag=food`,
				'#entry'
			)
		).toBe(`/income?workspace=${scope.profileId}&tag=food`)
		expect(switchedWorkspaceHref(scope.profileId, '/expenses/new')).toBe(
			workspaceHref(scope.profileId, '/expenses')
		)
	})
	it.each(['/settings/workspace', '/account', '/login', '/expenses', '/settings/categories'])(
		'preserves %s when switching workspace through the shared URL policy',
		(pathname) => {
			expect(
				switchedWorkspaceHref(
					scope.profileId,
					pathname,
					`?workspace=${scope.organizationId}&page=3&tag=food`,
					'#section'
				)
			).toBe(`${pathname}?workspace=${scope.profileId}&tag=food#section`)
		}
	)
	it('disambiguates duplicate names with their workspace IDs', () => {
		expect(
			workspaceLabel({ id: scope.organizationId, name: 'Same' }, [
				{ name: 'Same' },
				{ name: 'Same' }
			])
		).toContain(scope.organizationId)
	})
})
