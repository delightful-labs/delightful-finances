import { m } from '#lib/paraglide/messages.js'
import type { Account } from './schema.js'
export type BankSetupView =
	| 'creating'
	| 'test-encryption'
	| 'encrypting'
	| 'test-decryption'
	| 'verifying'
	| 'save'
	| 'saving'
export type BankStatusKey =
	| 'bank.idle_step'
	| 'bank.locked'
	| 'bank.waiting'
	| 'bank.restricted'
	| 'bank.working'
	| 'bank.success'
	| 'bank.partial_success'
	| 'bank.cancelled'
	| 'bank.failure'
	| 'bank.mode_mismatch'
	| 'bank.passkey_failure'
	| 'bank.claim_failure'
	| 'bank.invalid_setup_token'
	| 'bank.account_already_linked'
	| 'bank.save_failure'
	| 'bank.other_tab'
	| 'bank.locking_unavailable'
	| 'bank.unlock_failure'
	| 'bank.provider_failure'
	| 'bank.mapping_failure'
type SetupStep = { id: string; label: () => string }
export const bankSetupSteps = [
	{ id: 'token', label: () => m['bank.step_token']() },
	{
		id: 'create',
		label: () => m['actions.create_subject']({ subject: m['nouns.passkey']({ count: 1 }) })
	},
	{ id: 'encrypt', label: () => m['bank.step_encrypt']() },
	{ id: 'verify', label: () => m['bank.step_verify']() },
	{ id: 'connect', label: () => m['bank.step_connect']() }
] satisfies [SetupStep, ...SetupStep[]]
export type BankStatus = { key: BankStatusKey; label: () => string }
export type LastSync = {
	time: Date
	outcomeKey: 'bank.succeeded' | 'bank.partial' | 'bank.failed'
	imported: number
	existing: number
	omitted: number
}

export type ProviderAccountView = {
	id: string
	name: string
	currency: string
	mapping: { kind: 'linked'; account: Account } | { kind: 'broken' } | { kind: 'unmapped' }
	selectedAccountId: string
	availableAccounts: readonly Account[]
	showExisting: boolean
}
export type BankPresentation = {
	mode:
		| { kind: 'restricted' }
		| { kind: 'setup'; step: number; stage: BankSetupView | null }
		| { kind: 'connected'; recovery: 'available' }
	activity: { kind: 'idle' } | { kind: 'working'; indicator: 'provider' | 'general' }
	status: BankStatus | undefined
	history: LastSync | undefined
	providerAccounts: readonly ProviderAccountView[]
}
