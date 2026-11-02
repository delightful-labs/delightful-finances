import { and, assign, setup } from 'xstate'
import type {
	WorkspaceDrainRequest,
	WorkspaceLease
} from 'delightful-local-first/workspace/contracts'
import type {
	TransferMutationScope,
	TransferScopeDrainResponse
} from '../../contracts/transfer-scope-drain.js'
import type { TransferMutationOwnerEvent } from '../transfers/internal-transfer-mutation-owner.js'
import type {
	SelectedResourceCommand,
	SelectedResourceOutput
} from '../../contracts/workspace-selected-resources.js'
import { sameWorkspaceLease } from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'

/** Attachment identity survives workspace switches, but never an identity reattachment. */
export function transferScopeForWorkspaceLease(lease: WorkspaceLease): TransferMutationScope {
	return {
		binding: lease.scope.attachment,
		workspaceId: lease.request.workspaceId,
		generation: lease.epoch
	}
}

type Input = {
	drain: WorkspaceDrainRequest
	transferScope?: TransferMutationScope
	resources: { send: (event: SelectedResourceCommand) => void } | undefined
	transfers: { send: (event: TransferMutationOwnerEvent) => void } | undefined
	transferRelease?: WorkspaceResourceRelease
	resourceRelease?: WorkspaceResourceRelease
}
type Context = Input & {
	transferScope: TransferMutationScope
	release: WorkspaceResourceRelease
}
export type WorkspaceSelectionDrainEvent =
	| { type: 'SELECTED_RESOURCES_RELEASED'; result: SelectedResourceOutput }
	| { type: 'SELECTED_RESOURCES_CRASHED'; lease: WorkspaceLease }
	| TransferScopeDrainResponse
	| { type: 'TRANSFER_OWNER_CRASHED'; drain: WorkspaceDrainRequest }
export type WorkspaceSelectionDrainOutput = {
	drain: WorkspaceDrainRequest
	release: WorkspaceResourceRelease
}

/** Joins actual cleanup evidence; a failed leg never abandons the other owner. */
export function createWorkspaceSelectionDrainMachine() {
	const model = setup<
		Context,
		WorkspaceSelectionDrainEvent,
		{},
		{},
		{ retainResources: undefined; retainTransfers: undefined; unresolved: undefined },
		{
			matchingResources: undefined
			matchingResourceCrash: undefined
			matchingTransfer: undefined
			matchingTransferCrash: undefined
		},
		never,
		string,
		Input,
		WorkspaceSelectionDrainOutput
	>({
		guards: {
			matchingResources: ({ context, event }) =>
				event.type === 'SELECTED_RESOURCES_RELEASED' &&
				sameWorkspaceLease(event.result.lease, context.drain.lease) &&
				// The owner may finish its own shutdown before receiving our drain command.
				(event.result.drain === undefined ||
					(event.result.drain.token === context.drain.token &&
						sameWorkspaceLease(event.result.drain.lease, context.drain.lease))),
			matchingResourceCrash: ({ context, event }) =>
				event.type === 'SELECTED_RESOURCES_CRASHED' &&
				sameWorkspaceLease(event.lease, context.drain.lease),
			matchingTransfer: ({ context, event }) =>
				event.type === 'TRANSFER_SCOPE_DRAIN_RESULT' &&
				event.request.token === context.drain.token &&
				event.request.scope.binding === context.transferScope.binding &&
				event.request.scope.workspaceId === context.transferScope.workspaceId &&
				event.request.scope.generation === context.transferScope.generation,
			matchingTransferCrash: ({ context, event }) =>
				event.type === 'TRANSFER_OWNER_CRASHED' &&
				event.drain.token === context.drain.token &&
				sameWorkspaceLease(event.drain.lease, context.drain.lease)
		},
		actions: {
			retainResources: assign(({ context, event }) => {
				if (event.type !== 'SELECTED_RESOURCES_RELEASED') throw new Error('Missing resource result')
				return { release: retainResourceRelease(context.release, event.result.release) }
			}),
			retainTransfers: assign(({ context, event }) => {
				if (event.type !== 'TRANSFER_SCOPE_DRAIN_RESULT') throw new Error('Missing transfer result')
				return {
					release: retainResourceRelease(context.release, {
						outcome: event.outcome === 'rejected' ? 'unresolved' : event.outcome
					})
				}
			}),
			unresolved: assign({ release: { outcome: 'unresolved' } })
		}
	})
	return model.createMachine({
		id: 'workspace-selection-drain',
		context: ({ input }) => ({
			...input,
			drain: Object.freeze({
				token: input.drain.token,
				lease: Object.freeze({
					...input.drain.lease,
					scope: Object.freeze({ ...input.drain.lease.scope }),
					request: Object.freeze({ ...input.drain.lease.request })
				})
			}),
			transferScope: Object.freeze({
				...(input.transferScope ?? transferScopeForWorkspaceLease(input.drain.lease))
			}),
			release: retainResourceRelease(
				input.resourceRelease ?? { outcome: 'released' },
				input.transferRelease ?? { outcome: 'released' }
			)
		}),
		initial: 'draining',
		output: ({ context }) => ({ drain: context.drain, release: context.release }),
		states: {
			draining: {
				type: 'parallel',
				states: {
					resources: {
						initial: 'checking',
						states: {
							checking: {
								always: [
									{ guard: ({ context }) => context.resources !== undefined, target: 'waiting' },
									{
										guard: ({ context }) => context.resourceRelease?.outcome === 'unresolved',
										target: 'unresolved'
									},
									{
										guard: ({ context }) =>
											context.resourceRelease?.outcome === 'releasedWithFailure',
										target: 'releasedWithFailure'
									},
									{ target: 'released' }
								]
							},
							waiting: {
								entry: ({ context }) =>
									context.resources?.send({ type: 'DRAIN', drain: context.drain }),
								on: {
									SELECTED_RESOURCES_RELEASED: [
										{
											guard: and([
												'matchingResources',
												({ event }) => event.result.release.outcome === 'unresolved'
											]),
											target: 'unresolved',
											actions: 'retainResources'
										},
										{
											guard: and([
												'matchingResources',
												({ event }) => event.result.release.outcome === 'releasedWithFailure'
											]),
											target: 'releasedWithFailure',
											actions: 'retainResources'
										},
										{ guard: 'matchingResources', target: 'released', actions: 'retainResources' }
									],
									SELECTED_RESOURCES_CRASHED: {
										guard: 'matchingResourceCrash',
										target: 'unresolved',
										actions: 'unresolved'
									}
								}
							},
							released: { type: 'final' },
							releasedWithFailure: { type: 'final' },
							unresolved: { type: 'final' }
						}
					},
					transfers: {
						initial: 'checking',
						states: {
							checking: {
								always: [
									{ guard: ({ context }) => context.transfers !== undefined, target: 'waiting' },
									{
										guard: ({ context }) => context.transferRelease?.outcome === 'unresolved',
										target: 'unresolved'
									},
									{
										guard: ({ context }) =>
											context.transferRelease?.outcome === 'releasedWithFailure',
										target: 'releasedWithFailure'
									},
									{ target: 'released' }
								]
							},
							waiting: {
								entry: ({ context, self }) =>
									context.transfers?.send({
										type: 'DRAIN_TRANSFER_SCOPE',
										drain: {
											request: { token: context.drain.token, scope: context.transferScope },
											recipient: self
										}
									}),
								on: {
									TRANSFER_SCOPE_DRAIN_RESULT: [
										{
											guard: and([
												'matchingTransfer',
												({ event }) =>
													event.outcome === 'unresolved' || event.outcome === 'rejected'
											]),
											target: 'unresolved',
											actions: 'retainTransfers'
										},
										{
											guard: and([
												'matchingTransfer',
												({ event }) => event.outcome === 'releasedWithFailure'
											]),
											target: 'releasedWithFailure',
											actions: 'retainTransfers'
										},
										{ guard: 'matchingTransfer', target: 'released', actions: 'retainTransfers' }
									],
									TRANSFER_OWNER_CRASHED: {
										guard: 'matchingTransferCrash',
										target: 'unresolved',
										actions: 'unresolved'
									}
								}
							},
							released: { type: 'final' },
							releasedWithFailure: { type: 'final' },
							unresolved: { type: 'final' }
						}
					}
				},
				onDone: 'complete'
			},
			complete: { type: 'final' }
		}
	})
}
