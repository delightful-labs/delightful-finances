import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '../schema.js'
import {
	workspaceIntegrityAssessment,
	type IntegrityAssessment,
	type IntegrityAssessmentInput,
	type IntegrityPlan,
	type IntegrityRecords
} from './workspace-integrity-assessment.js'
import { createJazzTransactionActors } from './jazz-transaction-actors.js'

export type IntegrityEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type IntegrityResult =
	| (Exclude<IntegrityAssessment, { outcome: 'repair' }> & {
			settlement: 'notStarted' | 'locallyPersisted'
	  })
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }
type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
type Input = Omit<IntegrityAssessmentInput, 'records'> & { db: Db; expected: IntegrityPlan }

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing integrity transaction resource')
	return value
}
const transactionActors = createJazzTransactionActors(
	(db: Db) => db.beginTransaction(),
	(write: ReturnType<Transaction['commit']>) => write.wait({ tier: 'local' })
)
const { open, commit, settle, rollback } = transactionActors
const read = fromPromise(
	async ({ input }: { input: { tx: Transaction; scope: Input } }): Promise<IntegrityRecords> => {
		const { tx, scope } = input
		const [profiles, organizations, memberships] = await Promise.all([
			tx.all(app.profiles.where({ userId: scope.userId })),
			tx.all(app.organizations.where({ id: scope.organizationId })),
			tx.all(
				app.organizationMembers.where({
					organizationId: scope.organizationId,
					userId: scope.userId
				})
			)
		])
		return { profiles, organizations, memberships }
	}
)
const linkProfile = fromPromise(
	async ({ input }: { input: { tx: Transaction; link: IntegrityPlan['profileLink'] } }) =>
		input.tx.update(app.organizationMembers, input.link.membershipId, {
			profileId: input.link.profileId
		})
)
type Context = Input & {
	tx: Transaction | undefined
	records: IntegrityRecords | undefined
	assessment: IntegrityAssessment | undefined
	plan: IntegrityPlan | undefined
	write: OutputFrom<typeof commit> | undefined
	result: IntegrityResult | undefined
}

/** One resource owner: reads/checks/staging/commit are states, never a transaction callback. */
export const workspaceIntegrityTransaction = setup<
	Context,
	IntegrityEvent,
	{
		open: typeof transactionActors.open
		read: typeof read
		assess: typeof workspaceIntegrityAssessment
		linkProfile: typeof linkProfile
		commit: typeof transactionActors.commit
		settle: typeof transactionActors.settle
		rollback: typeof transactionActors.rollback
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
		open,
		read,
		assess: workspaceIntegrityAssessment,
		linkProfile,
		commit,
		settle,
		rollback
	},
	guards: {
		closing: stateIn({ running: { control: 'closing' } }),
		cancelling: stateIn({ running: { control: 'cancelling' } })
	}
}).createMachine({
	id: 'workspace-integrity-transaction',
	context: ({ input }) => ({
		...input,
		tx: undefined,
		records: undefined,
		assessment: undefined,
		plan: undefined,
		write: undefined,
		result: undefined
	}),
	initial: 'running',
	output: ({ context }) => required(context.result),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: { on: { CANCEL: 'cancelling', SHUTDOWN: 'closing' } },
						cancelling: { on: { CANCEL: {}, SHUTDOWN: 'closing' } },
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.db,
								onDone: {
									target: 'checkingAfterOpen',
									actions: assign({ tx: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
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
						checkingAfterOpen: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'reading' }
							]
						},
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({ tx: required(context.tx), scope: context }),
								onDone: {
									target: 'checkingAfterRead',
									actions: assign({ records: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
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
						checkingAfterRead: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'assessing' }
							]
						},
						assessing: {
							invoke: {
								src: 'assess',
								input: ({ context }) => ({ ...context, records: required(context.records) }),
								onDone: {
									target: 'checkingPlan',
									actions: assign({ assessment: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
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
						checkingPlan: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{
									guard: ({ context }) =>
										context.assessment !== undefined && context.assessment.outcome !== 'repair',
									target: 'rollingBack',
									actions: assign({
										result: ({ context }): IntegrityResult => {
											const assessment = required(context.assessment)
											if (assessment.outcome === 'repair')
												throw new Error('Expected terminal assessment')
											return { ...assessment, settlement: 'notStarted' }
										}
									})
								},
								{
									guard: ({ context }) =>
										context.assessment?.outcome === 'repair' &&
										context.assessment.plan.profileLink.membershipId ===
											context.expected.profileLink.membershipId &&
										context.assessment.plan.profileLink.profileId ===
											context.expected.profileLink.profileId,
									target: 'stagingProfileLink',
									actions: assign(({ context }) => {
										const assessment = required(context.assessment)
										if (assessment.outcome !== 'repair') throw new Error('Expected repair payload')
										return { plan: assessment.plan }
									})
								},
								{
									target: 'rollingBack',
									actions: assign({
										result: {
											outcome: 'conflict',
											reason: 'repairPlanChanged',
											settlement: 'notStarted'
										}
									})
								}
							]
						},
						stagingProfileLink: {
							invoke: {
								src: 'linkProfile',
								input: ({ context }) => ({
									tx: required(context.tx),
									link: required(context.plan?.profileLink)
								}),
								onDone: 'checkingBeforeCommit',
								onError: {
									target: 'rollingBack',
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
						checkingBeforeCommit: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'committing' }
							]
						},
						committing: {
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'settling',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): IntegrityResult => ({
											outcome: 'failed',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: 'classifyingSuccess',
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): IntegrityResult => ({
											outcome: 'failed',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						classifyingSuccess: {
							always: {
								target: 'finishing',
								actions: assign({ result: { outcome: 'complete', settlement: 'locallyPersisted' } })
							}
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: [
									{ guard: ({ event }) => event.output, target: 'finishing' },
									{
										target: 'finishing',
										actions: assign({
											result: {
												outcome: 'failed',
												settlement: 'unresolved',
												error: new Error('Integrity rollback was not confirmed')
											}
										})
									}
								],
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): IntegrityResult => ({
											outcome: 'failed',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						finishing: {
							entry: assign({
								tx: undefined,
								write: undefined,
								records: undefined,
								plan: undefined
							}),
							always: [
								{ guard: 'closing', target: '#workspace-integrity-transaction.closed' },
								{ guard: 'cancelling', target: '#workspace-integrity-transaction.cancelled' },
								{
									guard: ({ context }) => context.result?.outcome === 'complete',
									target: '#workspace-integrity-transaction.complete'
								},
								{
									guard: ({ context }) => context.result?.outcome === 'partial',
									target: '#workspace-integrity-transaction.partial'
								},
								{
									guard: ({ context }) => context.result?.outcome === 'unavailable',
									target: '#workspace-integrity-transaction.unavailable'
								},
								{
									guard: ({ context }) => context.result?.outcome === 'conflict',
									target: '#workspace-integrity-transaction.conflict'
								},
								{
									guard: ({ context }) => context.result?.settlement === 'unresolved',
									target: '#workspace-integrity-transaction.unresolved'
								},
								{ target: '#workspace-integrity-transaction.failed' }
							]
						}
					}
				}
			}
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
