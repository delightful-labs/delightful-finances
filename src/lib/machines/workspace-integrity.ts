import { assign, fromPromise, sendTo, setup, stateIn } from 'xstate'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { app } from '../schema.js'
import {
	workspaceIntegrityAssessment,
	type IntegrityAssessment,
	type IntegrityRecords,
	type IntegrityScope,
	type IntegrityIssue
} from './workspace-integrity-assessment.js'
import {
	workspaceIntegrityTransaction,
	type IntegrityEvent,
	type IntegrityResult
} from './workspace-integrity-transaction.js'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction' | 'getConfig'>
type Input = IntegrityScope & { db: Db }
const prepare = fromPromise(async ({ input }: { input: Input }) => {
	z.uuid().parse(input.userId)
	z.uuid().parse(input.profileId)
	z.uuid().parse(input.organizationId)
})
const discover = fromPromise(
	async ({
		input
	}: {
		input: Input & { tier: typeof ReadTier.LocalFirst | typeof ReadTier.Remote }
	}): Promise<IntegrityRecords> => {
		const { db, tier, organizationId, userId } = input
		const [profiles, organizations, memberships] = await Promise.all([
			db.all(app.profiles.where({ userId }), { tier }),
			db.all(app.organizations.where({ id: organizationId }), { tier }),
			db.all(app.organizationMembers.where({ organizationId, userId }), { tier })
		])
		return { profiles, organizations, memberships }
	}
)
type Context = Input & {
	records: IntegrityRecords | undefined
	assessment: IntegrityAssessment | undefined
	result: IntegrityResult | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing workspace integrity observation')
	return value
}

/** Fixed to one identity/workspace/database binding. Its owner must drain it before replacement. */
export const workspaceIntegrity = setup<
	Context,
	IntegrityEvent,
	{
		prepare: typeof prepare
		discover: typeof discover
		assess: typeof workspaceIntegrityAssessment
		transaction: typeof workspaceIntegrityTransaction
	},
	{},
	{},
	{ closing: undefined; cancelling: undefined },
	never,
	string,
	Input,
	IntegrityResult
>({
	actors: {
		prepare,
		discover,
		assess: workspaceIntegrityAssessment,
		transaction: workspaceIntegrityTransaction
	},
	guards: {
		closing: stateIn({ repairing: 'closing' }),
		cancelling: stateIn({ repairing: 'cancelling' })
	}
}).createMachine({
	id: 'workspace-integrity',
	context: ({ input }) => ({
		...input,
		records: undefined,
		assessment: undefined,
		result: undefined
	}),
	initial: 'validatingScope',
	output: ({ context }) => required(context.result),
	on: { CANCEL: '.cancelled', SHUTDOWN: '.closed' },
	states: {
		validatingScope: {
			invoke: {
				src: 'prepare',
				input: ({ context }) => context,
				onDone: 'readingLocal',
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): IntegrityResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		readingLocal: {
			invoke: {
				src: 'discover',
				input: ({ context }) => ({ ...context, tier: ReadTier.LocalFirst }),
				onDone: {
					target: 'assessingLocal',
					actions: assign({ records: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): IntegrityResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		assessingLocal: {
			invoke: {
				src: 'assess',
				input: ({ context }) => ({ ...context, records: required(context.records) }),
				onDone: {
					target: 'choosingLocal',
					actions: assign({ assessment: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): IntegrityResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		choosingLocal: {
			always: [
				{
					guard: ({ context }) => context.assessment?.outcome === 'repair',
					target: 'checkingAuthority'
				},
				{ target: 'acceptingAssessment' }
			]
		},
		checkingAuthority: {
			always: [
				{
					guard: ({ context }) => Boolean(context.db.getConfig().serverUrl),
					target: 'awaitingAuthority'
				},
				{
					target: 'partial',
					actions: assign({
						result: ({ context }): IntegrityResult => {
							const assessment = required(context.assessment)
							if (assessment.outcome !== 'repair') throw new Error('Expected suspected repair')
							const profileIssues: IntegrityIssue[] = assessment.plan.profileLink
								? ['profileLink']
								: []
							return {
								outcome: 'partial',
								settlement: 'notStarted',
								issues: [...assessment.remaining, ...profileIssues]
							}
						}
					})
				}
			]
		},
		awaitingAuthority: {
			invoke: {
				src: 'discover',
				input: ({ context }) => ({ ...context, tier: ReadTier.Remote }),
				onDone: {
					target: 'assessingAuthority',
					actions: assign({ records: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): IntegrityResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		assessingAuthority: {
			invoke: {
				src: 'assess',
				input: ({ context }) => ({ ...context, records: required(context.records) }),
				onDone: {
					target: 'choosingAuthority',
					actions: assign({ assessment: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): IntegrityResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		choosingAuthority: {
			always: [
				{ guard: ({ context }) => context.assessment?.outcome === 'repair', target: 'repairing' },
				{ target: 'acceptingAssessment' }
			]
		},
		acceptingAssessment: {
			entry: assign({
				result: ({ context }): IntegrityResult => {
					const assessment = required(context.assessment)
					if (assessment.outcome === 'repair') throw new Error('Expected terminal assessment')
					return { ...assessment, settlement: 'notStarted' }
				}
			}),
			always: 'finishing'
		},
		repairing: {
			initial: 'active',
			on: {
				CANCEL: { target: '.cancelling', actions: sendTo('transaction', { type: 'CANCEL' }) },
				SHUTDOWN: { target: '.closing', actions: sendTo('transaction', { type: 'SHUTDOWN' }) }
			},
			states: {
				active: {},
				cancelling: { on: { CANCEL: {} } },
				closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
			},
			invoke: {
				id: 'transaction',
				src: 'transaction',
				input: ({ context }) => {
					const assessment = required(context.assessment)
					if (assessment.outcome !== 'repair') throw new Error('Expected authorized repair')
					return { ...context, expected: assessment.plan }
				},
				onDone: [
					{
						guard: 'closing',
						target: 'closed',
						actions: assign({ result: ({ event }) => event.output })
					},
					{
						guard: 'cancelling',
						target: 'cancelled',
						actions: assign({ result: ({ event }) => event.output })
					},
					{ target: 'finishing', actions: assign({ result: ({ event }) => event.output }) }
				],
				onError: [
					{
						guard: 'closing',
						target: 'closed',
						actions: assign({
							result: ({ event }): IntegrityResult => ({
								outcome: 'failed',
								settlement: 'unresolved',
								error: event.error
							})
						})
					},
					{
						guard: 'cancelling',
						target: 'cancelled',
						actions: assign({
							result: ({ event }): IntegrityResult => ({
								outcome: 'failed',
								settlement: 'unresolved',
								error: event.error
							})
						})
					},
					{
						target: 'unresolved',
						actions: assign({
							result: ({ event }): IntegrityResult => ({
								outcome: 'failed',
								settlement: 'unresolved',
								error: event.error
							})
						})
					}
				]
			}
		},
		finishing: {
			always: [
				{ guard: ({ context }) => context.result?.outcome === 'complete', target: 'complete' },
				{ guard: ({ context }) => context.result?.outcome === 'partial', target: 'partial' },
				{
					guard: ({ context }) => context.result?.outcome === 'unavailable',
					target: 'unavailable'
				},
				{ guard: ({ context }) => context.result?.outcome === 'conflict', target: 'conflict' },
				{ guard: ({ context }) => context.result?.outcome === 'cancelled', target: 'cancelled' },
				{ guard: ({ context }) => context.result?.outcome === 'closed', target: 'closed' },
				{
					guard: ({ context }) => context.result?.settlement === 'unresolved',
					target: 'unresolved'
				},
				{ target: 'failed' }
			]
		},
		complete: { type: 'final' },
		partial: { type: 'final' },
		unavailable: { type: 'final' },
		conflict: { type: 'final' },
		failed: { type: 'final' },
		unresolved: { type: 'final' },
		cancelled: {
			type: 'final',
			entry: assign({
				result: ({ context }): IntegrityResult => ({
					outcome: 'cancelled',
					settlement: context.result?.settlement ?? 'notStarted'
				})
			})
		},
		closed: {
			type: 'final',
			entry: assign({
				result: ({ context }): IntegrityResult => ({
					outcome: 'closed',
					settlement: context.result?.settlement ?? 'notStarted'
				})
			})
		}
	}
})
