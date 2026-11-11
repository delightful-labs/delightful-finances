import type { Account, AccountMembership, OrganizationMember } from '../schema.js'

export type AccountArchiveNotice = {
	key:
		| 'status.archived_subject_name'
		| 'accounts.archive_interrupted_saved'
		| 'accounts.archive_scope_changed'
		| 'accounts.archive_restricted'
		| 'errors.archive_subject'
	variant: 'success' | 'error'
	name: string
}
export type AccountGrantNotice = {
	key: 'permissions.updated' | 'permissions.update_failed' | 'permissions.manage_restricted'
	variant: 'success' | 'error'
	accountId: string | null
}
export type AccountArchivePresentation = {
	kind: 'sessionUnavailable' | 'selectWorkspace' | 'loading' | 'loadFailed' | 'ready' | 'closed'
	rows: readonly {
		account: Account
		action: 'available' | 'unavailable' | 'archiving' | 'disabled'
	}[]
	feedback:
		| {
				outcome:
					| 'succeeded'
					| 'invalid'
					| 'denied'
					| 'unavailable'
					| 'failed'
					| 'scopeChanged'
					| 'cancelled'
					| 'closed'
				settlement: 'locallyPersisted' | 'notStarted' | 'rejected' | 'unknown'
				request: { accountId: string; name: string }
		  }
		| null
		| undefined
	notice?: AccountArchiveNotice | null | undefined
}
export type AccountDeletePresentation = {
	permissionAccountId?: string | null | undefined
	busy: boolean
	result:
		| {
				outcome: 'succeeded' | 'denied' | 'failed'
				request: { accountId: string } | null | undefined
		  }
		| null
		| undefined
	notice?: AccountGrantNotice | null | undefined
}
export type AccountPermissionControl = { id: string; userId: string; canDelete: boolean }

export type AccountGrantWrite =
	| { kind: 'update'; grantId: string; canDelete: boolean }
	| {
			kind: 'insert'
			organizationId: string
			accountId: string
			userId: string
			canDelete: boolean
	  }

/** Projection inputs contain data only; protocol types never import actor logic. */
export type AccountPermissionSource = {
	organizationId: string | null
	accounts: readonly Account[]
	members: readonly OrganizationMember[]
	grants: readonly AccountMembership[]
	loading: boolean
	failed: boolean
}
