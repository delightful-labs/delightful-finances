import { expect, it } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import TransactionRowLayout from './TransactionRowLayout.svelte'
import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'

const children = createRawSnippet(() => ({ render: () => '<strong>Weekly groceries</strong>' }))
const amount = createRawSnippet(() => ({ render: () => '<span>$42.17</span>' }))
const scope = {
	href: 'https://finance.example/expenses?workspace=personal&page=2&account=cash',
	keys: ['workspace', 'page', 'account']
} satisfies QueryLinkContext

it.each(['/expenses/expense-id', '/transfers/transfer-id'])(
	'keeps Finance query inheritance and named row content for %s',
	(href) => {
		const { body } = render(TransactionRowLayout, {
			props: { href, label: 'Details: Weekly groceries, $42.17', children, amount },
			context: new Map([[queryLinksKey, scope]])
		})
		expect(body).toContain(`href="${href}?workspace=personal&amp;page=2&amp;account=cash"`)
		expect(body).toContain('aria-label="Details: Weekly groceries, $42.17"')
		expect(body).toContain('Weekly groceries')
		expect(body).toContain('$42.17')
		expect([...body.matchAll(/<li\b/g)]).toHaveLength(1)
		expect([...body.matchAll(/<a\b/g)]).toHaveLength(1)
	}
)

it('keeps an explicit destination page instead of replacing it with the current page', () => {
	const { body } = render(TransactionRowLayout, {
		props: {
			href: '/expenses/expense-id?page=3',
			label: 'Weekly groceries',
			children,
			amount
		},
		context: new Map([[queryLinksKey, scope]])
	})
	expect(body).toContain(
		'href="/expenses/expense-id?page=3&amp;workspace=personal&amp;account=cash"'
	)
})
