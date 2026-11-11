import {
	nativeTextCommandSchema,
	nativeTextReplySchema
} from '../../contracts/native-text-transfer.js'
import {
	transactionRouteCommandSchema,
	transactionEditCommandSchema
} from './transaction-route-protocol.js'
import { overviewCommandSchema } from './overview-protocol.js'
import { ledgerCommandSchema } from './ledger-protocol.js'
import { accountActionsCommandSchema } from './account-actions-protocol.js'
import { managementCommandSchema } from './management-protocol.js'
import { z } from 'zod'
import { accountFormCommandSchema } from './form-protocol.js'
import { workspaceCommandSchema, workspaceViewSchema } from './workspace-protocol.js'

export const FINANCE_RUNTIME_PROTOCOL_VERSION = 1
export const MAX_RUNTIME_COMMANDS = 32
const id = z.string().uuid()
const localHref = z
	.string()
	.max(24_576)
	.refine((value) => value.startsWith('/') && !value.startsWith('//'))
export const routeSchema = z
	.object({
		pathname: z.string().max(4096).startsWith('/'),
		search: z.string().max(16_384),
		hash: z.string().max(4096)
	})
	.strict()
const correlation = z.object({
	version: z.literal(FINANCE_RUNTIME_PROTOCOL_VERSION),
	scope: id,
	requestId: id,
	sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
export const applicationIntentSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('RETRY') }).strict(),
	z.object({ type: z.literal('RELOAD') }).strict(),
	z.object({ type: z.literal('RETRY_NAVIGATION') }).strict(),
	z.object({ type: z.literal('DISMISS_MUTATION_REJECTION') }).strict(),
	z
		.object({
			type: z.literal('RECOVER'),
			phrase: z.string().max(4096),
			origin: localHref,
			destination: localHref
		})
		.strict()
])
export const runtimeCommandSchema = z.discriminatedUnion('type', [
	correlation
		.extend({
			type: z.literal('NAME_TEXT'),
			generation: z.number().int().positive().safe(),
			form: z.enum(['account', 'category', 'tag']),
			draftRevision: z.number().int().nonnegative().safe(),
			command: nativeTextCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('TRANSACTION_TEXT'),
			generation: z.number().int().positive().safe(),
			formGeneration: z.number().int().positive().safe(),
			draftRevision: z.number().int().nonnegative().safe(),
			command: nativeTextCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('TRANSACTION_EDIT'),
			generation: z.number().int().positive(),
			formGeneration: z.number().int().positive(),
			command: transactionEditCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('TRANSACTION_FORM'),
			generation: z.number().int().positive(),
			formGeneration: z.number().int().positive(),
			draftRevision: z.number().int().nonnegative().safe(),
			command: transactionRouteCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('TRANSACTION_OPTIONS'),
			generation: z.number().int().positive(),
			formGeneration: z.number().int().positive(),
			catalog: z.enum(['accounts', 'categories', 'tags', 'transfers', 'savedTags']),
			offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('OVERVIEW'),
			generation: z.number().int().positive(),
			command: overviewCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('LEDGER'),
			generation: z.number().int().positive(),
			command: ledgerCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('ACCOUNT_COMMAND'),
			generation: z.number().int().positive(),
			command: accountActionsCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('MANAGEMENT_FILTER'),
			generation: z.number().int().positive(),
			catalog: z.enum(['categories', 'tags']),
			filter: z.enum(['active', 'archived', 'all'])
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('MANAGEMENT_OPTIONS'),
			generation: z.number().int().positive(),
			kind: z.enum(['expense', 'income']),
			offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('MANAGEMENT_FORM'),
			generation: z.number().int().positive(),
			draftRevision: z.number().int().nonnegative().safe(),
			...managementCommandSchema.shape
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('ACCOUNT_FORM'),
			generation: z.number().int().positive(),
			draftRevision: z.number().int().nonnegative().safe(),
			command: accountFormCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('WORKSPACE'),
			generation: z.number().int().positive(),
			command: workspaceCommandSchema
		})
		.strict(),
	correlation
		.extend({
			type: z.literal('CATALOG_PAGE'),
			generation: z.number().int().positive(),
			catalog: z.enum(['organizations', 'accounts', 'categories', 'tags']),
			offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
		})
		.strict(),
	correlation.extend({ type: z.literal('APPLICATION'), command: applicationIntentSchema }).strict(),
	correlation.extend({ type: z.literal('ROUTE'), route: routeSchema }).strict(),
	correlation
		.extend({
			type: z.literal('ACK'),
			revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
		})
		.strict(),
	correlation.extend({ type: z.literal('SHUTDOWN') }).strict()
])
export const runtimeViewSchema = z
	.object({
		workspace: workspaceViewSchema,
		runtime: z.enum(['starting', 'running', 'draining', 'releaseBlocked', 'closed']),
		session: z
			.object({
				status: z.enum(['starting', 'ready', 'signed-out', 'transitioning', 'error', 'closed']),
				identityId: id.nullable()
			})
			.strict(),
		startup: z.object({ failed: z.boolean(), waitingForOtherVersion: z.boolean() }).strict(),
		recovery: z
			.object({
				busy: z.boolean(),
				navigationOnly: z.boolean(),
				invalid: z.boolean(),
				failed: z.boolean(),
				navigationFailed: z.boolean(),
				canRetryNavigation: z.boolean(),
				draftRevision: z.number().int().nonnegative()
			})
			.strict()
	})
	.strict()
export const runtimeReplySchema = z.discriminatedUnion('type', [
	correlation.extend({ type: z.literal('TEXT'), reply: nativeTextReplySchema.nullable() }).strict(),
	correlation.extend({ type: z.literal('RECEIVED') }).strict(),
	z
		.object({
			version: z.literal(FINANCE_RUNTIME_PROTOCOL_VERSION),
			scope: id,
			type: z.literal('VIEW'),
			revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
			view: runtimeViewSchema
		})
		.strict(),
	z
		.object({
			version: z.literal(FINANCE_RUNTIME_PROTOCOL_VERSION),
			scope: id,
			type: z.literal('CLOSED')
		})
		.strict(),
	z
		.object({
			version: z.literal(FINANCE_RUNTIME_PROTOCOL_VERSION),
			scope: id,
			type: z.literal('FAILED')
		})
		.strict()
])
const port = z.custom<MessagePort>(
	(value) => typeof MessagePort !== 'undefined' && value instanceof MessagePort
)
export const runtimeBootstrapSchema = z
	.object({
		version: z.literal(FINANCE_RUNTIME_PROTOCOL_VERSION),
		type: z.literal('INITIALIZE'),
		scope: id,
		origin: z.string().url().max(8192),
		serverUrl: z.string().url().max(8192),
		legacyScope: z.string().max(4096).optional(),
		route: routeSchema,
		assets: z
			.object({
				wasmUrl: z.string().url().max(8192),
				brokerWorkerUrl: z.string().url().max(8192),
				wasmVersion: z.string().min(1).max(256)
			})
			.strict(),
		storage: port,
		drain: port,
		locks: port,
		native: port
	})
	.strict()
export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>
export type RuntimeIntent = {
	[Kind in RuntimeCommand['type']]: Omit<
		Extract<RuntimeCommand, { type: Kind }>,
		'version' | 'scope' | 'sequence' | 'requestId'
	>
}[RuntimeCommand['type']]
export type RuntimeView = z.infer<typeof runtimeViewSchema>
export type RuntimeBootstrap = z.infer<typeof runtimeBootstrapSchema>
export type RuntimeReply = z.infer<typeof runtimeReplySchema>
export type RouteObservation = z.infer<typeof routeSchema>

export const nativeRequestSchema = z.discriminatedUnion('type', [
	correlation
		.extend({
			type: z.literal('NAVIGATE'),
			destination: localHref,
			expectedHref: localHref,
			expectedRouteSequence: z.number().int().nonnegative().safe(),
			replace: z.boolean()
		})
		.strict(),
	correlation.extend({ type: z.literal('RELOAD') }).strict()
])
export const nativeReplySchema = correlation
	.extend({
		type: z.literal('NATIVE_SETTLED'),
		outcome: z.enum(['succeeded', 'unavailable', 'obsolete'])
	})
	.strict()
export type NativeRequest = z.infer<typeof nativeRequestSchema>
