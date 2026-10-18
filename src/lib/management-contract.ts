import type { Category, Tag, OrganizationMember } from './schema.js'
import type { ScopedFormView } from './form-contract.js'
export type ManagementScope = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
}
export type ManagementReason =
	| 'sessionUnavailable'
	| 'selectWorkspace'
	| 'loading'
	| 'loadFailed'
	| 'readOnly'
	| 'unavailableReference'
	| 'protectedRecord'
export type ManagementObservation = ManagementScope & {
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	loading: boolean
	failed: boolean
	categories: readonly Category[]
	tags: readonly Tag[]
	intent?:
		| { kind: 'archiveCategory'; id: string; organizationId: string }
		| { kind: 'archiveTag'; id: string; organizationId: string }
		| { kind: 'createTag'; categoryId: string | null }
}
export type ManagementView<Result> = ScopedFormView<Result, ManagementReason>
