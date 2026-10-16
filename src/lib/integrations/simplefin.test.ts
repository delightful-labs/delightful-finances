import { afterEach, expect, it, vi } from 'vitest'
import { bridgeUrl, claimToken, fetchAccounts, providerAccountIdentity } from './simplefin.js'
import type { BankTrace } from './diagnostics.js'
const trace: BankTrace = {
	id: crypto.randomUUID(),
	log: () => {},
	failed: () => {},
	step: async (_stage, work) => await work()
}
const access = 'https://user:secret@bridge.simplefin.org/simplefin'
afterEach(() => vi.unstubAllGlobals())
it.each(['bridge.simplefin.org', 'beta-bridge.simplefin.org'])(
	'accepts official %s endpoints',
	(host) => {
		expect(bridgeUrl(`https://${host}/simplefin/claim/token`, 'claim').hostname).toBe(host)
		expect(bridgeUrl(`https://user:secret@${host}/simplefin`, 'access').hostname).toBe(host)
	}
)
it.each([
	'http://bridge.simplefin.org/simplefin/claim/token',
	'https://bridge.simplefin.org.evil.test/simplefin/claim/token',
	'https://bridge.simplefin.org:8443/simplefin/claim/token',
	'https://bridge.simplefin.org/simplefin/claim/token?redirect=evil',
	'https://bridge.simplefin.org/simplefin/claim/token#fragment',
	'https://user:secret@bridge.simplefin.org/simplefin/claim/token',
	'https://bridge.simplefin.org/simplefin/claim/token/extra'
])('rejects unsafe claim destination %s', (url) => {
	expect(() => bridgeUrl(url, 'claim')).toThrow()
})
it('requires credentials for access URLs', () => {
	expect(() => bridgeUrl('https://bridge.simplefin.org/simplefin', 'access')).toThrow()
})
it('validates tokens before making requests and never retries failed claims', async () => {
	const fetch = vi.fn(async () => new Response('', { status: 502 }))
	vi.stubGlobal('fetch', fetch)
	await expect(claimToken('dummy text', new AbortController().signal, trace)).rejects.toThrow()
	expect(fetch).not.toHaveBeenCalled()
	await expect(
		claimToken(
			btoa('https://bridge.simplefin.org/simplefin/claim/token'),
			new AbortController().signal,
			trace
		)
	).rejects.toThrow('provider-failure')
	expect(fetch).toHaveBeenCalledTimes(1)
})
it('claims only, then separates explicit discovery and transaction requests', async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(access))
		.mockImplementation(async () => Response.json({ errors: [], accounts: [] }))
	vi.stubGlobal('fetch', fetch)
	const signal = new AbortController().signal
	expect(
		await claimToken(btoa('https://bridge.simplefin.org/simplefin/claim/token'), signal, trace)
	).toBe(access)
	expect(fetch).toHaveBeenCalledTimes(1)
	await fetchAccounts(access, true, signal, trace)
	await fetchAccounts(access, false, signal, trace)
	const operations = fetch.mock.calls.map((call) => {
		const options: unknown = call[1]
		return options && typeof options === 'object' && 'body' in options ? options.body : undefined
	})
	expect(operations).toEqual([
		JSON.stringify({
			operation: 'claim',
			url: 'https://bridge.simplefin.org/simplefin/claim/token'
		}),
		JSON.stringify({ operation: 'discover', url: access }),
		JSON.stringify({ operation: 'sync', url: access })
	])
})
it('rejects malformed provider responses', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ accounts: [{ id: 'missing-fields' }] }))
	)
	await expect(fetchAccounts(access, false, new AbortController().signal, trace)).rejects.toThrow()
})
it('separates account identities across institutions while ignoring renamed accounts', () => {
	const account = {
		id: 'same',
		name: 'Checking',
		currency: 'USD',
		org: { 'sfin-url': 'https://bank.example', domain: 'bank.example' }
	}
	expect(providerAccountIdentity(account)).toBe(
		providerAccountIdentity({ ...account, name: 'Renamed' })
	)
	expect(providerAccountIdentity(account)).not.toBe(
		providerAccountIdentity({ ...account, org: { ...account.org, domain: 'other.example' } })
	)
})
