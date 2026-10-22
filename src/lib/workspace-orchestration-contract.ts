import type { ActorRef, Snapshot } from 'xstate'
import type { Organization } from './schema.js'

export type WorkspaceSessionFacts = {
	userId: string | undefined
	status: 'ready' | 'signed-out' | 'transitioning' | 'error' | 'closed'
}
export type InitializationRequest = WorkspaceSessionFacts & { generation: number }
export type InitializationStatus =
	{ kind: 'waiting' | 'checking' | 'failed' | 'closed' } | { kind: 'ready'; profileId: string }
export type InitializationReport = { request: InitializationRequest; status: InitializationStatus }
export type InitializationStatusEvent = {
	type: 'INITIALIZATION_STATUS'
	report: InitializationReport
}
export type InitializationRecipient = ActorRef<Snapshot<unknown>, InitializationStatusEvent>
export function sameInitializationRequest(
	currentRequest: InitializationRequest,
	incomingRequest: InitializationRequest
) {
	return (
		currentRequest.generation === incomingRequest.generation &&
		currentRequest.userId === incomingRequest.userId &&
		currentRequest.status === incomingRequest.status
	)
}
export type WorkspaceRoute = { pathname: string; search: string; hash: string }
export type NavigationAccess = 'waiting' | 'ready' | 'denied' | 'failed'
export type WorkspaceNavigationFacts = WorkspaceRoute & {
	generation: number
	userId: string | undefined
	ready: boolean
	loading: boolean
	error: unknown
	organizations: readonly Organization[]
	access: NavigationAccess
}
export type NavigationStatus =
	'waiting' | 'directory' | 'global' | 'scoped' | 'unavailable' | 'failed'
export type NavigationReport = { generation: number; status: NavigationStatus }
export type NavigationStatusEvent = { type: 'NAVIGATION_STATUS'; report: NavigationReport }
export type NavigationRecipient = ActorRef<Snapshot<unknown>, NavigationStatusEvent>
export type WorkspaceNavigate = (
	url: string,
	signal: AbortSignal,
	expectedHref: string,
	replace: boolean
) => Promise<void>
