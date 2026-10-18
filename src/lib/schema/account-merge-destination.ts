import type { Organization, OrganizationMember } from '../schema.js'
import type { AccountMergeMappingInput } from './account-merge-mapping.js'

export type MergeDestination = AccountMergeMappingInput['destination']
export type MergeDestinationSession = {
	ready: boolean
	identityId: string | null
	organizationId: string | null
	// Exact client/Db binding supplied by integration, never an authentication token.
	binding: object | null
}
export type MergeDestinationOrganization = Pick<Organization, 'id' | 'kind' | 'ownerId'>
export type MergeDestinationMembership = Pick<
	OrganizationMember,
	'organizationId' | 'userId' | 'role'
>
export type MergeObservationCallbacks<Value> = {
	next: (value: Value) => void
	error: () => void
}
// Integration owns Jazz subscriptions. Organization/membership bindings must use
// tier: 'remote', scope their queries to this destination, and forward terminal
// errors. Their disposers must release subscriptions synchronously; acquisition
// failures must clean up any resources obtained before throwing.
export type MergeDestinationDependencies = {
	binding: object
	session: (callbacks: MergeObservationCallbacks<MergeDestinationSession>) => () => void
	organization: (
		destination: MergeDestination,
		callbacks: MergeObservationCallbacks<readonly MergeDestinationOrganization[]>
	) => () => void
	membership: (
		destination: MergeDestination,
		callbacks: MergeObservationCallbacks<readonly MergeDestinationMembership[]>
	) => () => void
}
export type MergeDestinationError =
	| 'invalid-input'
	| 'session-unavailable'
	| 'identity-changed'
	| 'workspace-changed'
	| 'binding-changed'
	| 'not-owned-personal'
	| 'membership-required'
	| 'invalid-observation'
	| 'remote-read-failed'
	| 'session-observation-failed'
	| 'timeout'
export type MergeDestinationResult =
	| { outcome: 'eligible'; destination: MergeDestination }
	| { outcome: 'failed'; code: MergeDestinationError }
	| { outcome: 'cancelled' | 'closed' }
