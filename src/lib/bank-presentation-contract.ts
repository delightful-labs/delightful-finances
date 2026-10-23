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
export type BankStepLabelKey =
	| 'bank.step_token'
	| 'actions.create_subject'
	| 'bank.step_encrypt'
	| 'bank.step_verify'
	| 'bank.step_connect'
type SetupStep = { id: string; labelKey: BankStepLabelKey }
export const bankSetupSteps = [
	{ id: 'token', labelKey: 'bank.step_token' },
	{ id: 'create', labelKey: 'actions.create_subject' },
	{ id: 'encrypt', labelKey: 'bank.step_encrypt' },
	{ id: 'verify', labelKey: 'bank.step_verify' },
	{ id: 'connect', labelKey: 'bank.step_connect' }
] satisfies [SetupStep, ...SetupStep[]]
export type BankStatus =
	| { key: 'bank.idle_step'; stepKey: BankStepLabelKey }
	| { key: Exclude<BankStatusKey, 'bank.idle_step'> }
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
