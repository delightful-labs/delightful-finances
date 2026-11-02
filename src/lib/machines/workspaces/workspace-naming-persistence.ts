import { assign, sendTo, setup } from 'xstate'
import { createWorkspaceNamingOperation } from 'delightful-local-first/workspace/naming/workflow'
import type { WorkspaceNamingResult } from 'delightful-local-first/workspace/naming/contracts'
import type { AccountCurrency } from '#lib/domain/account-currency.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import type {
	WorkspaceRenameObservation,
	WorkspaceRenameReason,
	WorkspaceRenameScope
} from '#lib/contracts/workspace-rename-contract.js'

type Values = { name: string; defaultCurrency: AccountCurrency }
type Input = FormOperationInput<Values, WorkspaceRenameScope, WorkspaceRenameObservation>
type Scope = { requestId: number; scopeRevision: number; workspace: WorkspaceRenameScope }
type Result = FormOperationResult<void, WorkspaceRenameReason>
export type WorkspaceNamingPersistence<Write> = {
	issueRename: (id: string, values: Values) => { write: Write }
	persistLocal: (write: Write) => Promise<void>
}
function formResult(
	result: WorkspaceNamingResult<Scope, Pick<Values, 'defaultCurrency'>, never>
): Result {
	const settlement = result.settlement.kind
	if (result.outcome === 'succeeded')
		return { outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' }
	if (result.outcome === 'invalid')
		return { outcome: 'failed', code: 'validationFailed', settlement: 'notStarted' }
	if (result.outcome === 'cancelled' || result.outcome === 'closed')
		return { outcome: result.outcome, settlement }
	if (result.outcome === 'invalidated') return { outcome: 'scopeChanged', settlement }
	return { outcome: 'failed', code: 'operationFailed', settlement }
}

/** Existing scoped-form policy authorizes before invoking this fixed-request persistence child. */
export function createWorkspaceNamingPersistence<Write>(
	dependencies: WorkspaceNamingPersistence<Write>
) {
	const naming = createWorkspaceNamingOperation<
		Scope,
		Pick<Values, 'defaultCurrency'>,
		never,
		Write
	>({
		// The parent readiness chart is the sole eligibility owner; this child adds no role policy.
		assess: () => ({ kind: 'allowed' }),
		issue: (request) =>
			dependencies.issueRename(request.workspaceId, {
				name: request.name,
				defaultCurrency: request.settings.defaultCurrency
			}),
		persistLocal: dependencies.persistLocal
	})
	return setup<
		{ input: Input; result: Result | undefined },
		FormChildEvent<WorkspaceRenameObservation>,
		{ naming: typeof naming },
		{},
		{},
		{},
		never,
		string,
		Input,
		Result
	>({ actors: { naming } }).createMachine({
		id: 'finance-workspace-naming-persistence',
		initial: 'running',
		context: ({ input }) => ({ input, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing workspace settings result')
			return context.result
		},
		states: {
			running: {
				on: {
					CANCEL: { actions: sendTo('naming', { type: 'CANCEL' }) },
					INVALIDATE: { actions: sendTo('naming', { type: 'INVALIDATE' }) },
					SHUTDOWN: { actions: sendTo('naming', { type: 'SHUTDOWN' }) }
				},
				invoke: {
					id: 'naming',
					src: 'naming',
					input: ({
						context: {
							input: { request }
						}
					}) => {
						// Boundary invariant only; availability and schema validation already ran upstream.
						if (request.scope.organizationId === null)
							throw new Error('Missing authorized workspace')
						return {
							request: {
								scope: {
									requestId: request.id,
									scopeRevision: request.scopeRevision,
									workspace: request.scope
								},
								workspaceId: request.scope.organizationId,
								name: request.values.name,
								settings: { defaultCurrency: request.values.defaultCurrency }
							}
						}
					},
					onDone: {
						target: 'finished',
						actions: assign({ result: ({ event }) => formResult(event.output) })
					},
					onError: {
						target: 'finished',
						actions: assign({
							result: { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
						})
					}
				}
			},
			finished: { type: 'final' }
		}
	})
}
