import type { ActorLogic, Snapshot, SnapshotFrom } from 'xstate'
import type { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormMode,
	FormObservation,
	FormOperationInput
} from '#lib/form-contract.js'
import { createScopedFormWriteMachine } from './scoped-form-write.js'
import type { ScopedFormOptions } from './scoped-form.js'

/** Composition only: policy states and effects are supplied by the domain. */
export function createSingleWriteFormOptions<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>
>(
	options: {
		schema: z.ZodType<Values>
		availability: ActorLogic<
			AvailabilitySnapshot,
			FormChildEvent<Observation>,
			FormObservation<Observation>
		>
		selectAvailability: (snapshot: AvailabilitySnapshot) => FormCapability<Scope, Reason>
		scopeOf: (facts: Observation) => Scope
		sameScope: (left: Scope, right: Scope) => boolean
		observe: () => Observation
		classifyBlocked: (reason: Reason) => 'denied' | 'unavailable'
		assessmentObservation?: (input: FormOperationInput<Values, Scope, Observation>) => Observation
		write: (input: FormOperationInput<Values, Scope, Observation>) => Promise<Result>
		successContent?: 'retain' | 'replace'
		resetOnSuccess?: boolean
	} & FormMode<Values, Observation>
) {
	const operation = createScopedFormWriteMachine<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot
	>({ ...options, settlement: 'locallyPersisted' })
	return { ...options, operation } satisfies ScopedFormOptions<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		SnapshotFrom<typeof operation>
	> & { observe: () => Observation }
}
