export const AMOUNT_INPUT_PATTERN = String.raw`^(0|[1-9]\d*)(?:\.(\d{1,2}))?$`

export type MoneyParseResult =
	| { kind: 'valid'; amountMinor: number }
	| { kind: 'invalid'; reason: 'empty' | 'format' | 'too-large' }

/** Parse a non-negative USD-style amount without ever passing through a float. */
export function parseAmountMinor(input: string): MoneyParseResult {
	const value = input.trim()
	if (value.length === 0) return { kind: 'invalid', reason: 'empty' }

	const match = new RegExp(AMOUNT_INPUT_PATTERN).exec(value)
	if (match === null) return { kind: 'invalid', reason: 'format' }

	const amountMinor = BigInt(`${match[1]}${(match[2] ?? '').padEnd(2, '0')}`)
	if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
		return { kind: 'invalid', reason: 'too-large' }
	}

	return { kind: 'valid', amountMinor: Number(amountMinor) }
}

export function formatMoney(amountMinor: number, currency: string, locale = 'en-US'): string {
	if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
		throw new RangeError('Money must be a non-negative integer amount in minor units.')
	}

	const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
	const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
	const scale = 10 ** fractionDigits
	const whole = Math.floor(amountMinor / scale)
	const fraction = amountMinor % scale
	const parts = formatter.formatToParts(whole)
	if (fractionDigits === 0) return parts.map((part) => part.value).join('')

	const localizedFraction = new Intl.NumberFormat(locale, {
		useGrouping: false,
		minimumIntegerDigits: fractionDigits
	}).format(fraction)
	return parts.map((part) => (part.type === 'fraction' ? localizedFraction : part.value)).join('')
}

export function formatSignedMoney(amountMinor: bigint, currency: string, locale = 'en-US'): string {
	const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
	const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
	const scale = 10n ** BigInt(fractionDigits)
	const negative = amountMinor < 0n
	const absolute = negative ? -amountMinor : amountMinor
	const whole = absolute / scale
	const fraction = absolute % scale
	const wholeAmount = negative ? (whole === 0n ? -0 : -whole) : whole
	const parts = formatter.formatToParts(wholeAmount)
	if (fractionDigits === 0) return parts.map((part) => part.value).join('')
	const localizedFraction = new Intl.NumberFormat(locale, {
		useGrouping: false,
		minimumIntegerDigits: fractionDigits,
		maximumFractionDigits: 0
	}).format(fraction)
	return parts.map((part) => (part.type === 'fraction' ? localizedFraction : part.value)).join('')
}
