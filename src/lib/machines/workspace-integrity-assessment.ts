import { assign, setup } from 'xstate'
import type { schema } from 'jazz-tools'
import { app, type Category, type Organization, type OrganizationMember } from '../schema.js'
import { workspaceCreationAttemptSchema } from '../validation/identity.js'
import type { prepareWorkspaceSystemCategories } from '../domain/workspace-system-categories.js'

export type IntegrityScope = { userId: string; organizationId: string; profileId: string }
export type RequiredCategory = Awaited<ReturnType<typeof prepareWorkspaceSystemCategories>>[number]
export type IntegrityRecords = {
	profiles: schema.RowOf<typeof app.profiles>[]
	organizations: Organization[]
	memberships: OrganizationMember[]
	categories: Category[]
}
export type IntegrityIssue = 'profileLink' | Category['kind']
export type IntegrityPlan = {
	profileLink: { membershipId: string; profileId: string } | undefined
	categories: RequiredCategory[]
}
export type IntegrityAssessment =
	| { outcome: 'complete' }
	| { outcome: 'partial'; issues: IntegrityIssue[] }
	| { outcome: 'repair'; plan: IntegrityPlan; remaining: IntegrityIssue[] }
	| { outcome: 'unavailable'; reason: 'profileMissing' | 'accessUnavailable' }
	| { outcome: 'conflict'; reason: 'profileAmbiguous' | 'membershipAmbiguous' | 'systemCategories' }
export type IntegrityAssessmentInput = IntegrityScope & {
	records: IntegrityRecords
	systemCategories: RequiredCategory[]
}

type Context = IntegrityAssessmentInput & {
	plan: IntegrityPlan
	issues: IntegrityIssue[]
	result: IntegrityAssessment | undefined
}

// Pure set selection only. Eligibility and outcome classification belong to the chart.
function missingCategories(context: IntegrityAssessmentInput) {
	return context.systemCategories.filter(
		(required) =>
			!context.records.categories.some((row) => row.isSystem && row.kind === required.kind)
	)
}

/** Current-policy adapter: never uses workspace creator/kind as authority. */
export const workspaceIntegrityAssessment = setup<
	Context,
	{ type: 'ASSESS' },
	{},
	{},
	{},
	{},
	never,
	string,
	IntegrityAssessmentInput,
	IntegrityAssessment
>({}).createMachine({
	id: 'workspace-integrity-assessment',
	context: ({ input }) => ({
		...input,
		plan: { profileLink: undefined, categories: [] },
		issues: [],
		result: undefined
	}),
	initial: 'checkingDefinitions',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing integrity assessment')
		return context.result
	},
	states: {
		checkingDefinitions: {
			always: [
				{
					guard: ({ context }) =>
						context.systemCategories.length === 2 &&
						context.systemCategories.every((row) => row.isSystem) &&
						workspaceCreationAttemptSchema.shape.categories.safeParse(context.systemCategories)
							.success,
					target: 'checkingProfile'
				},
				{
					target: 'conflict',
					actions: assign({ result: { outcome: 'conflict', reason: 'systemCategories' } })
				}
			]
		},
		checkingProfile: {
			always: [
				{
					guard: ({ context }) => context.records.profiles.length === 0,
					target: 'unavailable',
					actions: assign({ result: { outcome: 'unavailable', reason: 'profileMissing' } })
				},
				{
					guard: ({ context }) =>
						context.records.profiles.length !== 1 ||
						context.records.profiles[0]?.id !== context.profileId ||
						context.records.profiles[0]?.userId !== context.userId,
					target: 'conflict',
					actions: assign({ result: { outcome: 'conflict', reason: 'profileAmbiguous' } })
				},
				{ target: 'checkingMembership' }
			]
		},
		checkingMembership: {
			always: [
				{
					guard: ({ context }) =>
						context.records.organizations.length !== 1 ||
						context.records.organizations[0]?.id !== context.organizationId ||
						context.records.memberships.length === 0,
					target: 'unavailable',
					actions: assign({ result: { outcome: 'unavailable', reason: 'accessUnavailable' } })
				},
				{
					guard: ({ context }) =>
						context.records.memberships.length !== 1 ||
						context.records.memberships[0]?.userId !== context.userId ||
						context.records.memberships[0]?.organizationId !== context.organizationId,
					target: 'conflict',
					actions: assign({ result: { outcome: 'conflict', reason: 'membershipAmbiguous' } })
				},
				{ target: 'checkingSystemCategories' }
			]
		},
		checkingSystemCategories: {
			always: [
				{
					guard: ({ context }) =>
						context.records.categories.some(
							(row) =>
								row.organizationId !== context.organizationId ||
								(row.isSystem && row.archivedAt != null)
						) ||
						context.systemCategories.some(
							(required) =>
								context.records.categories.filter(
									(row) => row.isSystem && row.kind === required.kind
								).length > 1
						) ||
						missingCategories(context).some((required) =>
							context.records.categories.some((row) => row.id === required.id)
						),
					target: 'conflict',
					actions: assign({ result: { outcome: 'conflict', reason: 'systemCategories' } })
				},
				{ target: 'choosingProfileRepair' }
			]
		},
		choosingProfileRepair: {
			always: [
				{
					guard: ({ context }) => context.records.memberships[0]?.profileId === context.profileId,
					target: 'choosingCategoryRepair'
				},
				{
					guard: ({ context }) =>
						['owner', 'admin'].includes(context.records.memberships[0]?.role ?? ''),
					target: 'choosingCategoryRepair',
					actions: assign({
						plan: ({ context }) => {
							const membership = context.records.memberships[0]
							if (!membership) throw new Error('Missing assessed membership')
							return {
								...context.plan,
								profileLink: { membershipId: membership.id, profileId: context.profileId }
							}
						}
					})
				},
				{ target: 'choosingCategoryRepair', actions: assign({ issues: ['profileLink'] }) }
			]
		},
		choosingCategoryRepair: {
			always: [
				{
					guard: ({ context }) =>
						['owner', 'admin', 'member'].includes(context.records.memberships[0]?.role ?? ''),
					target: 'classifying',
					actions: assign({
						plan: ({ context }) => ({ ...context.plan, categories: missingCategories(context) })
					})
				},
				{
					target: 'classifying',
					actions: assign({
						issues: ({ context }) => [
							...context.issues,
							...missingCategories(context).map((row) => row.kind)
						]
					})
				}
			]
		},
		classifying: {
			always: [
				{
					guard: ({ context }) =>
						context.plan.profileLink !== undefined || context.plan.categories.length > 0,
					target: 'repair',
					actions: assign({
						result: ({ context }): IntegrityAssessment => ({
							outcome: 'repair',
							plan: context.plan,
							remaining: context.issues
						})
					})
				},
				{
					guard: ({ context }) => context.issues.length > 0,
					target: 'partial',
					actions: assign({
						result: ({ context }): IntegrityAssessment => ({
							outcome: 'partial',
							issues: context.issues
						})
					})
				},
				{ target: 'complete', actions: assign({ result: { outcome: 'complete' } }) }
			]
		},
		complete: { type: 'final' },
		partial: { type: 'final' },
		repair: { type: 'final' },
		unavailable: { type: 'final' },
		conflict: { type: 'final' }
	}
})
