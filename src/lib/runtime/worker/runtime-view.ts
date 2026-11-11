import type { ActorRefFrom } from 'xstate'
import type { financeWorkerRuntimeMachine } from '../../machines/runtime/finance-worker-runtime.js'
import { selectRecoveryView } from '../../machines/runtime/application-readiness.js'
import type { RuntimeView } from './application-protocol.js'
import { emptyWorkspaceView, type PublicWorkspaceView } from './workspace-protocol.js'

/** Explicit public projection. Session handles, roots, credentials, actor refs
 * and SDK errors cannot escape through this selector. */
export function projectFinanceRuntime(
	runtime: ActorRefFrom<typeof financeWorkerRuntimeMachine>,
	workspace: PublicWorkspaceView = emptyWorkspaceView()
): RuntimeView {
	const snapshot = runtime.getSnapshot()
	const application = snapshot.context.application?.getSnapshot()
	const session = application?.context.session?.getSnapshot()
	const acquisition = snapshot.context.acquisition?.getSnapshot()
	const closed = snapshot.matches('closed')
	return {
		workspace,
		runtime: closed
			? 'closed'
			: snapshot.matches('releaseBlocked')
				? 'releaseBlocked'
				: snapshot.matches('running')
					? 'running'
					: snapshot.matches('startingResources') || snapshot.matches('startingApplication')
						? 'starting'
						: 'draining',
		session: {
			status: closed ? 'closed' : (session?.status ?? 'starting'),
			identityId: session?.account?.id ?? null
		},
		startup: {
			failed: application?.hasTag('startup-error') ?? false,
			waitingForOtherVersion: acquisition?.matches('waitingForAvailability') ?? false
		},
		recovery: application
			? selectRecoveryView(application)
			: {
					busy: false,
					navigationOnly: false,
					invalid: false,
					failed: false,
					navigationFailed: false,
					canRetryNavigation: false,
					draftRevision: 0
				}
	}
}
