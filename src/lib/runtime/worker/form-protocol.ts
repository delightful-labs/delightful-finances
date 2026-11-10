import { nativeTextReferenceSchema } from '../../contracts/native-text-transfer.js'
import { z } from 'zod'
import type { ScopedFormView } from '../../contracts/form-contract.js'
import type { AccountCreationView } from '../../contracts/account-creation-contract.js'
import type { Account } from '../../schema.js'
export const accountRowSchema = z
	.object({
		id: z.string().uuid(),
		organizationId: z.string().uuid(),
		name: z.string().max(4096),
		kind: z.enum(['cash', 'bank', 'card']),
		currency: z.string().max(64),
		archivedAt: z.date().nullable()
	})
	.strict()
const reason = z.enum([
	'sessionUnavailable',
	'selectWorkspace',
	'loadFailed',
	'loading',
	'readOnly',
	'duplicateName'
])
const settlement = z.enum(['notStarted', 'locallyPersisted', 'confirmed', 'rejected', 'unknown'])
const interruption = z.enum(['scopeChanged', 'cancelled', 'closed'])
const issue = z
	.object({
		path: z.array(z.union([z.string().max(128), z.number()])).max(32),
		code: z.string().max(128)
	})
	.strict()
export function createFormViewSchema<Value extends z.ZodType, Reason extends z.ZodType>(
	valueSchema: Value,
	reasonSchema: Reason
) {
	const result = z.discriminatedUnion('outcome', [
		z
			.object({
				outcome: z.literal('succeeded'),
				value: valueSchema,
				settlement: z.enum(['locallyPersisted', 'confirmed'])
			})
			.strict(),
		z
			.object({
				outcome: z.enum(['denied', 'unavailable']),
				reason: reasonSchema,
				settlement: z.literal('notStarted')
			})
			.strict(),
		z.object({ outcome: interruption, settlement }).strict(),
		z
			.object({
				outcome: z.literal('failed'),
				code: z.enum([
					'validationFailed',
					'operationFailed',
					'availabilityFailed',
					'unexpected',
					'completionFailed'
				]),
				settlement
			})
			.strict(),
		z
			.object({
				outcome: z.literal('partial'),
				value: valueSchema,
				reason: reasonSchema,
				settlement: z.enum(['locallyPersisted', 'confirmed', 'unknown'])
			})
			.strict(),
		z
			.object({
				outcome: z.literal('invalid'),
				issues: z.array(issue).max(64),
				settlement: z.literal('notStarted')
			})
			.strict()
	])
	return z
		.object({
			readiness: z.discriminatedUnion('kind', [
				z.object({ kind: z.literal('ready') }).strict(),
				z.object({ kind: z.literal('blocked'), reason: reasonSchema }).strict(),
				z.object({ kind: z.enum(['observing', 'failed', 'closed']) }).strict()
			]),
			content: z.discriminatedUnion('kind', [
				z.object({ kind: z.literal('fields') }).strict(),
				z.object({ kind: z.literal('success'), value: valueSchema }).strict()
			]),
			activity: z.discriminatedUnion('kind', [
				z.object({ kind: z.enum(['idle', 'validating', 'operating']) }).strict(),
				z.object({ kind: z.literal('settling'), reason: interruption }).strict()
			]),
			feedback: z.discriminatedUnion('kind', [
				z.object({ kind: z.literal('none') }).strict(),
				z.object({ kind: z.literal('result'), result }).strict()
			]),
			canSubmit: z.boolean(),
			canReset: z.boolean(),
			canOpen: z.boolean(),
			canCancel: z.boolean(),
			fieldsEditable: z.boolean(),
			canRetryReadiness: z.boolean(),
			draftRevision: z.number().int().nonnegative()
		})
		.strict()
}
export const accountFormViewSchema = createFormViewSchema(accountRowSchema, reason)
export const accountFormCommandSchema = z.discriminatedUnion('type', [
	z.object({ type: z.enum(['OPEN', 'RESET', 'CANCEL', 'RETRY_READINESS']) }).strict(),
	z
		.object({
			type: z.enum(['SUBMIT', 'CHANGE']),
			values: z
				.object({
					name: z.union([z.string().max(4096), nativeTextReferenceSchema]).optional(),
					kind: z.string().max(64).optional(),
					currency: z.string().max(64).optional()
				})
				.strict()
		})
		.strict()
])
export type AccountFormIntent = z.infer<typeof accountFormCommandSchema>
export type PublicAccountFormView = z.infer<typeof accountFormViewSchema>
function publicAccount(account: Account) {
	const { id, organizationId, name, kind, currency, archivedAt } = account
	return { id, organizationId, name: name.slice(0, 4096), kind, currency, archivedAt }
}
/** Explicit selection drops recovery checkpoints, callbacks, SDK errors and bindings. */
export function projectFormView<Input, Output, Reason>(
	view: ScopedFormView<Input, Reason> | undefined,
	projectValue: (value: Input) => Output
): ScopedFormView<Output, Reason> {
	if (!view)
		return {
			readiness: { kind: 'closed' },
			content: { kind: 'fields' },
			activity: { kind: 'idle' },
			feedback: { kind: 'none' },
			canSubmit: false,
			canReset: false,
			canOpen: false,
			canCancel: false,
			fieldsEditable: false,
			canRetryReadiness: false,
			draftRevision: 0
		}
	const feedback = view.feedback
	const response = feedback.kind === 'result' ? feedback.result : undefined
	const safeResult =
		response === undefined
			? undefined
			: response.outcome === 'invalid'
				? {
						outcome: response.outcome,
						settlement: response.settlement,
						issues: response.issues.slice(0, 64).map(({ path, code }) => ({
							path: path
								.slice(0, 32)
								.map((key) => (typeof key === 'number' ? key : String(key).slice(0, 128))),
							code: code.slice(0, 128)
						}))
					}
				: response.outcome === 'succeeded'
					? {
							outcome: response.outcome,
							settlement: response.settlement,
							value: projectValue(response.value)
						}
					: response.outcome === 'partial'
						? {
								outcome: response.outcome,
								settlement: response.settlement,
								value: projectValue(response.value),
								reason: response.reason
							}
						: response.outcome === 'denied' || response.outcome === 'unavailable'
							? {
									outcome: response.outcome,
									settlement: response.settlement,
									reason: response.reason
								}
							: response.outcome === 'failed'
								? {
										outcome: response.outcome,
										settlement: response.settlement,
										code: response.code
									}
								: { outcome: response.outcome, settlement: response.settlement }
	return {
		readiness: view.readiness,
		content:
			view.content.kind === 'success'
				? { kind: 'success', value: projectValue(view.content.value) }
				: { kind: 'fields' },
		activity: view.activity,
		feedback: safeResult ? { kind: 'result', result: safeResult } : { kind: 'none' },
		canSubmit: view.canSubmit,
		canReset: view.canReset,
		canOpen: view.canOpen,
		canCancel: view.canCancel,
		fieldsEditable: view.fieldsEditable,
		canRetryReadiness: view.canRetryReadiness,
		draftRevision: view.draftRevision
	}
}

export function projectAccountForm(view: AccountCreationView | undefined): PublicAccountFormView {
	return accountFormViewSchema.parse(projectFormView(view, publicAccount))
}
