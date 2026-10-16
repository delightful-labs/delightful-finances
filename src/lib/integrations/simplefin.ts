import type { BankTrace } from './diagnostics.js'
import { providerResponseSchema, type ProviderAccount } from '../validation/integrations.js'

export function providerAccountIdentity(account: ProviderAccount) {
	return JSON.stringify([
		account.org['sfin-url'],
		account.org.domain ?? account.org.id ?? '',
		account.id
	])
}

// The official developer guide also issues tokens on beta-bridge.simplefin.org.
// Keep an exact host allowlist for both client validation and the stateless relay.
export function bridgeUrl(value: string, kind: 'claim' | 'access', trace?: BankTrace) {
	const url = new URL(value)
	const hostAllowed =
		url.hostname === 'bridge.simplefin.org' || url.hostname === 'beta-bridge.simplefin.org'
	const pathAllowed =
		kind === 'claim'
			? /^\/simplefin\/claim\/[^/]+$/.test(url.pathname)
			: url.pathname === '/simplefin'
	const credentialsAllowed =
		kind === 'claim' ? !url.username && !url.password : Boolean(url.username && url.password)
	trace?.log(`provider-url.${kind}.shape`, {
		providerHttps: url.protocol === 'https:',
		providerHost:
			url.hostname === 'bridge.simplefin.org'
				? 'production'
				: url.hostname === 'beta-bridge.simplefin.org'
					? 'beta'
					: 'unsupported',
		providerPathAllowed: pathAllowed,
		providerCredentialsAllowed: credentialsAllowed,
		providerHasPort: Boolean(url.port),
		providerHasQuery: Boolean(url.search),
		providerHasFragment: Boolean(url.hash)
	})
	if (
		url.protocol !== 'https:' ||
		!hostAllowed ||
		url.port ||
		url.hash ||
		url.search ||
		!pathAllowed ||
		!credentialsAllowed
	)
		throw new Error('invalid-provider-url')
	return url
}

export function validateSetupToken(token: string, trace: BankTrace) {
	return trace.step(
		'claim.validate-token',
		() => bridgeUrl(atob(token.trim()), 'claim', trace).href
	)
}

async function request(body: object, signal: AbortSignal, trace: BankTrace) {
	const response = await trace.step('relay.http', () =>
		fetch('/api/simplefin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bank-Sync-Trace': trace.id },
			body: JSON.stringify(body),
			signal,
			cache: 'no-store',
			credentials: 'same-origin'
		})
	)
	trace.log('relay.response', { status: response.status })
	if (!response.ok) throw new Error('provider-failure')
	return response
}
export async function claimToken(token: string, signal: AbortSignal, trace: BankTrace) {
	const claimUrl = await validateSetupToken(token, trace)
	const response = await request({ operation: 'claim', url: claimUrl }, signal, trace)
	const accessUrl = await trace.step('claim.read-response', () => response.text())
	await trace.step('claim.validate-access-url', () => bridgeUrl(accessUrl, 'access', trace))
	return accessUrl
}
export async function fetchAccounts(
	accessUrl: string,
	discovery: boolean,
	signal: AbortSignal,
	trace: BankTrace
) {
	bridgeUrl(accessUrl, 'access', trace)
	const response = await request(
		{ operation: discovery ? 'discover' : 'sync', url: accessUrl },
		signal,
		trace
	)
	const payload: unknown = await trace.step('provider.decode-json', () => response.json())
	return trace.step('provider.validate-response', () => providerResponseSchema.parse(payload))
}
