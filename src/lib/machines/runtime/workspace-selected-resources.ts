import { assign, and, enqueueActions, raise, sendTo, setup, stateIn } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type {
	WorkspaceDrainRequest,
	WorkspaceLease
} from 'delightful-local-first/workspace/contracts'
import {
	sameWorkspaceLease,
	type SelectedResourceCommand,
	type SelectedResourceOutput,
	type SelectedResourceRecipient,
	type SelectedResourceReport
} from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import {
	sameIntegrityRequest,
	type IntegrityRequest,
	type IntegrityStatusEvent
} from '../../contracts/workspace-integrity-contract.js'
import { createBankSyncMachine } from '../bank-sync/index.js'
import type { BankSource, BankSyncDependencies } from '../bank-sync/types.js'
import { required } from '../bank-sync/identity.js'
import { createWorkspaceIntegrityOwner } from '../workspaces/workspace-integrity-owner.js'

type Input = { recipient: SelectedResourceRecipient }
type Context = Input & {
	drain: WorkspaceDrainRequest | undefined
	bankResult: WorkspaceResourceRelease | undefined
	integrityResult: WorkspaceResourceRelease | undefined
	integrityRequest: IntegrityRequest | undefined
	unexpectedStop: 'bank' | 'integrity' | undefined
	result: WorkspaceResourceRelease | undefined
}
type Event =
	| SelectedResourceCommand
	| IntegrityStatusEvent
	| {
			type: 'RESOURCE_STOPPED'
			resource: 'bank' | 'integrity'
	  }

function captureLease(lease: WorkspaceLease): WorkspaceLease {
	return Object.freeze({
		...lease,
		scope: Object.freeze({ ...lease.scope }),
		request: Object.freeze({ ...lease.request })
	})
}

/** One selected lease's resource lifetime; identity-bound startup/creation/navigation stay outside. */
export function createWorkspaceSelectedResources({
	dependencies,
	lease: issuedLease,
	userId
}: {
	dependencies: BankSyncDependencies
	lease: WorkspaceLease
	userId: string
}) {
	const lease = captureLease(issuedLease)
	const { db, passkeyName, read } = dependencies
	const readBoundSource = (): BankSource => {
		const source = read()
		return source.organizationId === lease.request.workspaceId && source.userId === userId
			? source
			: {
					organizationId: null,
					userId: undefined,
					sessionReady: false,
					membership: undefined,
					connections: [],
					accounts: [],
					links: []
				}
	}
	const actors = {
		bank: createBankSyncMachine({ db, passkeyName, read: readBoundSource }),
		integrity: createWorkspaceIntegrityOwner(db)
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{ bank: 'bank'; integrity: 'integrity' },
		{ shutDownChildren: undefined },
		{ currentDrain: undefined; active: undefined },
		never,
		string,
		Input,
		SelectedResourceOutput
	>({
		actors,
		actions: {
			shutDownChildren: enqueueActions(({ self, enqueue }) => {
				// Only direct public references/status; queued completion still supplies the finite result.
				const children = self.getSnapshot().children
				for (const child of [children.bank, children.integrity])
					if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
			})
		},
		guards: {
			currentDrain: ({ event }) =>
				event.type === 'DRAIN' && sameWorkspaceLease(event.drain.lease, lease),
			active: stateIn({ owning: { control: 'active' } })
		}
	})
	const rememberDrain = model.assign(({ event }) => {
		if (event.type !== 'DRAIN') throw new Error('Missing selected-resource drain')
		return { drain: Object.freeze({ token: event.drain.token, lease }) }
	})
	const rejectDrain = (reason: 'scopeMismatch' | 'busy') =>
		model.sendTo(
			({ context }) => context.recipient,
			({ event }): SelectedResourceReport => {
				if (event.type !== 'DRAIN') throw new Error('Missing rejected resource drain')
				return { type: 'SELECTED_RESOURCE_DRAIN_REJECTED', lease, drain: event.drain, reason }
			}
		)
	return model.createMachine({
		id: 'workspace-selected-resources',
		initial: 'owning',
		context: ({ input }) => ({
			...input,
			drain: undefined,
			bankResult: undefined,
			integrityResult: undefined,
			integrityRequest: undefined,
			unexpectedStop: undefined,
			result: undefined
		}),
		output: ({ context }) => ({ lease, drain: context.drain, release: required(context.result) }),
		on: {
			INTEGRITY_STATUS: {
				guard: and([
					'active',
					({ context, event }) =>
						context.integrityRequest !== undefined &&
						sameIntegrityRequest(context.integrityRequest, event.report.request)
				]),
				actions: sendTo(
					({ context }) => context.recipient,
					({ event }): SelectedResourceReport => ({
						type: 'SELECTED_INTEGRITY_STATUS',
						lease,
						report: event.report
					})
				)
			}
		},
		states: {
			owning: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: {
								on: {
									BANK: {
										guard: ({ event }) =>
											sameWorkspaceLease(event.lease, lease) &&
											(event.event.type !== 'WORKSPACE_ACCESS_CHANGED' ||
												(event.event.access.organizationId === lease.request.workspaceId &&
													event.event.access.userId === userId)),
										actions: enqueueActions(({ event, self, enqueue }) => {
											const child = self.getSnapshot().children.bank
											if (child?.getSnapshot().status === 'active')
												enqueue.sendTo(child, event.event)
										})
									},
									INTEGRITY: {
										guard: ({ context, event }) =>
											sameWorkspaceLease(event.lease, lease) &&
											Number.isSafeInteger(event.request.generation) &&
											event.request.generation >= 0 &&
											event.request.generation > (context.integrityRequest?.generation ?? -1) &&
											(event.request.binding === undefined ||
												(event.request.binding.organizationId === lease.request.workspaceId &&
													event.request.binding.userId === userId)),
										actions: [
											assign({
												integrityRequest: ({ event }) => ({
													...event.request,
													binding: event.request.binding ? { ...event.request.binding } : undefined
												})
											}),
											enqueueActions(({ context, self, enqueue }) => {
												const child = self.getSnapshot().children.integrity
												if (child?.getSnapshot().status === 'active')
													enqueue.sendTo(child, {
														type: 'OBSERVED',
														request: required(context.integrityRequest)
													})
											})
										]
									},
									DRAIN: [
										{ guard: 'currentDrain', target: 'draining', actions: rememberDrain },
										{ actions: rejectDrain('scopeMismatch') }
									],
									SHUTDOWN: 'draining',
									RESOURCE_STOPPED: {
										target: 'draining',
										actions: [
											assign({ unexpectedStop: ({ event }) => event.resource }),
											sendTo(
												({ context }) => context.recipient,
												({ event }): SelectedResourceReport => ({
													type: 'SELECTED_RESOURCES_STOPPING',
													lease,
													resource: event.resource
												})
											)
										]
									}
								}
							},
							draining: {
								entry: 'shutDownChildren',
								always: {
									guard: ({ context }) =>
										context.bankResult !== undefined && context.integrityResult !== undefined,
									target: 'stopped'
								},
								on: {
									DRAIN: [
										{
											guard: and(['currentDrain', ({ context }) => context.drain === undefined]),
											actions: rememberDrain
										},
										{
											guard: and([
												'currentDrain',
												({ context, event }) => context.drain?.token === event.drain.token
											])
										},
										{ guard: 'currentDrain', actions: rejectDrain('busy') },
										{ actions: rejectDrain('scopeMismatch') }
									]
								}
							},
							stopped: { type: 'final' }
						}
					},
					bank: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'bank',
									src: 'bank',
									onDone: {
										target: 'stopped',
										actions: [
											assign({ bankResult: ({ event }) => event.output }),
											raise({ type: 'RESOURCE_STOPPED', resource: 'bank' })
										]
									},
									onError: {
										target: 'stopped',
										actions: [
											assign({ bankResult: { outcome: 'unresolved' } }),
											raise({ type: 'RESOURCE_STOPPED', resource: 'bank' })
										]
									}
								}
							},
							stopped: { type: 'final' }
						}
					},
					integrity: {
						initial: 'running',
						states: {
							running: {
								invoke: {
									id: 'integrity',
									src: 'integrity',
									input: ({ self }) => ({
										request: { generation: 0, binding: undefined },
										recipient: self
									}),
									onDone: {
										target: 'stopped',
										actions: [
											assign({ integrityResult: ({ event }) => event.output }),
											raise({ type: 'RESOURCE_STOPPED', resource: 'integrity' })
										]
									},
									onError: {
										target: 'stopped',
										actions: [
											assign({ integrityResult: { outcome: 'unresolved' } }),
											raise({ type: 'RESOURCE_STOPPED', resource: 'integrity' })
										]
									}
								}
							},
							stopped: { type: 'final' }
						}
					}
				},
				onDone: 'classifying'
			},
			classifying: {
				entry: assign(({ context }) => ({
					result: retainResourceRelease(
						retainResourceRelease(required(context.bankResult), required(context.integrityResult)),
						{ outcome: context.unexpectedStop ? 'releasedWithFailure' : 'released' }
					)
				})),
				always: [
					{
						guard: ({ context }) => context.result?.outcome === 'unresolved',
						target: 'unresolved'
					},
					{
						guard: ({ context }) => context.result?.outcome === 'releasedWithFailure',
						target: 'releasedWithFailure'
					},
					{ target: 'released' }
				]
			},
			released: { type: 'final' },
			releasedWithFailure: { type: 'final' },
			unresolved: { type: 'final' }
		}
	})
}

/** Public bank reference for integration subscriptions; cleanup never exposes a usable replacement. */
export function selectedResourceBankActor(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceSelectedResources>> | undefined
) {
	return snapshot?.status === 'active' && snapshot.matches({ owning: { control: 'active' } })
		? snapshot.children.bank
		: undefined
}
