/** Props-only contracts: no framework, schema library, or actor dependency. */
export type FormIssue = { path: readonly PropertyKey[]; code: string }
export type FormSettlement =
	'notStarted' | 'locallyPersisted' | 'confirmed' | 'rejected' | 'unknown'
export type FormInterruption = 'scopeChanged' | 'cancelled' | 'closed'
export type FormReadiness<Reason> = { kind: 'ready' } | { kind: 'blocked'; reason: Reason }
export type FormOperationResult<Result, Reason> =
	| { outcome: 'succeeded'; value: Result; settlement: 'locallyPersisted' | 'confirmed' }
	| { outcome: 'denied' | 'unavailable'; reason: Reason; settlement: 'notStarted' }
	| { outcome: FormInterruption; settlement: FormSettlement }
	| {
			outcome: 'failed'
			code: 'validationFailed' | 'operationFailed' | 'availabilityFailed' | 'unexpected'
			settlement: FormSettlement
	  }
	| {
			outcome: 'partial'
			value: Result
			reason: Reason
			settlement: 'locallyPersisted' | 'confirmed' | 'unknown'
	  }
export type FormResult<Result, Reason> =
	| FormOperationResult<Result, Reason>
	| { outcome: 'invalid'; issues: readonly FormIssue[]; settlement: 'notStarted' }
export type ScopedFormView<Result, Reason> = {
	readiness: FormReadiness<Reason> | { kind: 'observing' | 'failed' | 'closed' }
	content: { kind: 'fields' } | { kind: 'success'; value: Result }
	activity:
		{ kind: 'idle' | 'validating' | 'operating' } | { kind: 'settling'; reason: FormInterruption }
	feedback: { kind: 'none' } | { kind: 'result'; result: FormResult<Result, Reason> }
	canSubmit: boolean
	canReset: boolean
	canOpen: boolean
	canCancel: boolean
	fieldsEditable: boolean
	canRetryReadiness: boolean
	draftRevision: number
}
/** Shared rendering surface. Legacy adapters leave draft revision unmanaged. */
export type FormPresentation = Pick<
	ScopedFormView<unknown, unknown>,
	'activity' | 'content' | 'canSubmit' | 'canReset' | 'canOpen' | 'fieldsEditable'
> & { draftRevision: number | undefined }

/** Revision is assigned by the owner; domain availability must echo it. */
export type FormObservation<Observation> = { revision: number; facts: Observation }
export type FormCapability<Scope, Reason> = {
	revision: number
	scope: Scope
	readiness: FormReadiness<Reason>
}
export type FormRequest<Scope> = {
	id: number
	scope: Scope
	scopeRevision: number
	values: unknown
}
export type FormChildEvent<Observation> =
	| { type: 'OBSERVE'; observation: FormObservation<Observation> }
	| { type: 'INVALIDATE' | 'CANCEL' | 'SHUTDOWN' }
export type FormOperationInput<Values, Scope, Observation> = {
	request: Omit<FormRequest<Scope>, 'values'> & { values: Values }
	observation: FormObservation<Observation>
}

/** Creation accepts drafts as before; editing requires a domain baseline comparison. */
export type FormMode<Values, Observation> =
	| { mode?: 'create' }
	| {
			mode: 'edit'
			initialValues: (observation: Observation) => Values
			valuesEqual: (draft: unknown, initialValues: Values) => boolean
	  }
