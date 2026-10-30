import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import { assign, setup } from 'xstate'
import type { schema } from 'jazz-tools'
import { app, type Organization, type OrganizationMember } from '../../schema.js'

export type IntegrityScope = { userId: string; organizationId: string; profileId: string }
export type IntegrityRecords = {
	profiles: schema.RowOf<typeof app.profiles>[]
	organizations: Organization[]
	memberships: OrganizationMember[]
}
export type IntegrityIssue = 'profileLink'
export type IntegrityPlan = {
	profileLink: { membershipId: string; profileId: string }
}
export type IntegrityAssessment =
	| { outcome: 'complete' }
	| { outcome: 'partial'; issues: IntegrityIssue[] }
	| { outcome: 'repair'; plan: IntegrityPlan }
	| { outcome: 'unavailable'; reason: 'profileMissing' | 'accessUnavailable' }
	| {
			outcome: 'conflict'
			reason: 'profileAmbiguous' | 'membershipAmbiguous' | 'repairPlanChanged'
	  }
export type IntegrityAssessmentInput = IntegrityScope & {
	records: IntegrityRecords
}

type Context = IntegrityAssessmentInput & {
	plan: IntegrityPlan | undefined
	issues: IntegrityIssue[]
	result: IntegrityAssessment | undefined
}

function requiredPlan(plan: IntegrityPlan | undefined): IntegrityPlan {
	if (!plan) throw new Error('Missing profile-link repair plan')
	return plan
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
		plan: undefined,
		issues: [],
		result: undefined
	}),
	initial: 'checkingProfile',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing integrity assessment')
		return context.result
	},
	states: {
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
				{ target: 'choosingProfileRepair' }
			]
		},
		choosingProfileRepair: {
			always: [
				{
					guard: ({ context }) => context.records.memberships[0]?.profileId === context.profileId,
					target: 'classifying'
				},
				{
					guard: ({ context }) =>
						[ORGANIZATION_ROLE.OWNER, ORGANIZATION_ROLE.ADMIN].some(
							(role) => role === context.records.memberships[0]?.role
						),
					target: 'classifying',
					actions: assign({
						plan: ({ context }) => {
							const membership = context.records.memberships[0]
							if (!membership) throw new Error('Missing assessed membership')
							return {
								profileLink: { membershipId: membership.id, profileId: context.profileId }
							}
						}
					})
				},
				{ target: 'classifying', actions: assign({ issues: ['profileLink'] }) }
			]
		},
		classifying: {
			always: [
				{
					guard: ({ context }) => context.plan !== undefined,
					target: 'repair',
					actions: assign({
						result: ({ context }): IntegrityAssessment => ({
							outcome: 'repair',
							plan: requiredPlan(context.plan)
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
