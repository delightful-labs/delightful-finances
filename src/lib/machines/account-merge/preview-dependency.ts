import { setup, type EventObject } from 'xstate'
import {
	compatibleMergeDependency,
	mergeDependencies,
	mergeDependencyRecords
} from '#lib/account-merge/preview.js'
import type { MergeConflictInput } from '#lib/schema/account-merge-conflict.js'
import type {
	MergeDependency,
	MergeDependencyInput,
	MergeDependencyResult,
	MergePreviewDecision
} from '#lib/schema/account-merge-preview.js'
import { required } from '../bank-sync/identity.js'

type Context = {
	input: MergeDependencyInput | undefined
	dependencies: MergeDependency[]
	index: number
	dependency: MergeDependency | undefined
	parents: readonly MergeConflictInput[]
	effective:
		{ value: MergeConflictInput['candidate']['value']; kind: 'planned' | 'retained' } | undefined
	result: MergeDependencyResult | undefined
}
const workflow = setup<
	Context,
	EventObject,
	{},
	{},
	{},
	{},
	never,
	string,
	MergeDependencyInput,
	MergeDependencyResult
>({})
const original = (context: Context) => {
	const input = required(context.input)
	return required(input.decisions.get(input.record.candidate.mapping.originId))
}
const hasUnavailableParent = (context: Context) =>
	context.parents.some((parent) => {
		const decision = required(context.input).decisions.get(parent.candidate.mapping.originId)
		return !decision || decision.outcome === 'conflict' || decision.outcome === 'blocked'
	})
const retainedParent = (context: Context) =>
	context.parents.find((parent) => parent.target !== null)
const plannedParent = (context: Context) =>
	context.parents.find(
		(parent) =>
			required(context.input).decisions.get(parent.candidate.mapping.originId)?.outcome ===
			'addition'
	)
const clear = workflow.assign({
	input: undefined,
	dependencies: [],
	index: 0,
	dependency: undefined,
	parents: [],
	effective: undefined
})
const finish = (decision: (context: Context) => MergePreviewDecision) =>
	workflow.createStateConfig({
		type: 'final',
		entry: [workflow.assign({ result: ({ context }) => ({ decision: decision(context) }) }), clear]
	})
const blocked = (reason: Extract<MergePreviewDecision, { outcome: 'blocked' }>['reason']) =>
	finish((context) => {
		const record = original(context)
		const dependency = required(context.dependency)
		return {
			entity: record.entity,
			sourceId: record.sourceId,
			destinationId: record.destinationId,
			originId: record.originId,
			outcome: 'blocked',
			reason,
			dependency: { entity: dependency.entity, destinationId: dependency.destinationId }
		}
	})

// Monotone pass: only additions can become blocked. Existing origins/targets are
// preserved; deleted retained targets cannot satisfy a new child's dependency.
export const accountMergePreviewDependencyMachine = workflow.createMachine({
	id: 'account-merge-preview-dependency',
	initial: 'routing',
	context: ({ input }) => ({
		input,
		dependencies: mergeDependencies(input.record),
		index: 0,
		dependency: {
			entity: input.record.entity,
			destinationId: input.record.candidate.mapping.destinationId,
			field: 'id'
		},
		parents: mergeDependencyRecords(input, {
			entity: input.record.entity,
			destinationId: input.record.candidate.mapping.destinationId
		}),
		effective: undefined,
		result: undefined
	}),
	output: ({ context }) => required(context.result),
	states: {
		routing: {
			always: [
				{ guard: ({ context }) => original(context).outcome !== 'addition', target: 'unchanged' },
				{ target: 'checkingGroup' }
			]
		},
		checkingGroup: {
			always: [
				{
					guard: ({ context }) => hasUnavailableParent(context),
					target: 'blockedGroup'
				},
				{
					guard: ({ context }) =>
						context.parents.some((parent) => {
							const decision = required(context.input).decisions.get(
								parent.candidate.mapping.originId
							)
							return (
								decision?.outcome === 'existing' &&
								decision.reason === 'recorded-origin' &&
								parent.target === null
							)
						}),
					target: 'unavailable'
				},
				{ target: 'nextDependency' }
			]
		},
		nextDependency: {
			always: [
				{
					guard: ({ context }) => context.index >= context.dependencies.length,
					target: 'unchanged'
				},
				{
					target: 'checkingParents',
					actions: workflow.assign({
						dependency: ({ context }) => required(context.dependencies[context.index]),
						parents: ({ context }) =>
							mergeDependencyRecords(
								required(context.input),
								required(context.dependencies[context.index])
							),
						effective: undefined
					})
				}
			]
		},
		checkingParents: {
			always: [
				{
					guard: ({ context }) => context.parents.length === 0 || hasUnavailableParent(context),
					target: 'unavailable'
				},
				{
					guard: ({ context }) => retainedParent(context) !== undefined,
					target: 'checkingCompatibility',
					actions: workflow.assign({
						effective: ({ context }) => ({
							kind: 'retained',
							value: required(retainedParent(context)?.target ?? undefined)
						})
					})
				},
				{ target: 'checkingPlannedParent' }
			]
		},
		checkingPlannedParent: {
			always: [
				{
					guard: ({ context }) => plannedParent(context) !== undefined,
					target: 'checkingCompatibility',
					actions: workflow.assign({
						effective: ({ context }) => ({
							kind: 'planned',
							value: required(plannedParent(context)).candidate.value
						})
					})
				},
				{ target: 'unavailable' }
			]
		},
		checkingCompatibility: {
			always: [
				{
					guard: ({ context }) =>
						!compatibleMergeDependency(
							required(context.input).record,
							required(context.dependency),
							required(context.effective)
						),
					target: 'incompatible'
				},
				{
					target: 'nextDependency',
					actions: workflow.assign({ index: ({ context }) => context.index + 1 })
				}
			]
		},
		unchanged: finish(original),
		blockedGroup: blocked('canonical-group'),
		unavailable: blocked('unavailable-dependency'),
		incompatible: blocked('incompatible-dependency')
	}
})
