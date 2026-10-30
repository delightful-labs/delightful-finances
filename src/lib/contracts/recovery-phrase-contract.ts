export type RecoveryIdentity = { identityId: string | null; binding: object | null }
export type RecoveryPhraseView =
	| { kind: 'hidden' | 'revealing' | 'failed' | 'closed' }
	| { kind: 'revealed'; phrase: string; confirmation: 'unconfirmed' | 'confirmed' }
