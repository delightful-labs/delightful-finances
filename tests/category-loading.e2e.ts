import { expect, test } from '@playwright/test'

test('loading overlay retains layout, blocks focus, and releases the same controls when ready', async ({
	page
}) => {
	await page.goto('/settings/categories')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Category', exact: true })
	).toBeEnabled()
	await page.evaluate(async () => {
		const sveltePath = '/node_modules/.vite/deps/svelte.js'
		const reactivityPath = '/node_modules/.vite/deps/svelte_reactivity.js'
		const componentPath = '/src/lib/components/QueryContent.svelte'
		const { mount, createRawSnippet }: typeof import('svelte') = await import(sveltePath)
		const { SvelteMap }: typeof import('svelte/reactivity') = await import(reactivityPath)
		const { default: QueryContent }: typeof import('../src/lib/components/QueryContent.svelte') =
			await import(componentPath)
		const state = new SvelteMap([['loading', true]])
		const target = document.createElement('section')
		target.id = 'loading-test'
		document.body.append(target)
		const ready = document.createElement('button')
		ready.textContent = 'Finish test loading'
		ready.onclick = () => state.set('loading', false)
		document.body.append(ready)
		mount(QueryContent, {
			target,
			props: {
				queries: [
					{
						get isLoading() {
							return state.get('loading') ?? false
						},
						error: null
					}
				],
				keepContentWhileLoading: true,
				loadingMessage: 'Loading test content',
				errorMessage: 'Test load failed',
				children: createRawSnippet(() => ({
					render: () => '<button id="retained-control">Retained control</button>'
				}))
			}
		})
	})
	const region = page.locator('#loading-test')
	const button = region.locator('#retained-control')
	await expect(region.locator('[aria-busy="true"]')).toBeVisible()
	await expect(button).toBeVisible()
	await expect(region.locator('[inert]')).toHaveCount(1)
	await button.evaluate((node) => node.focus())
	await expect(button).not.toBeFocused()
	const position = () =>
		button.evaluate((node) => {
			const region = node.closest('#loading-test')
			if (!region) throw new Error('Missing loading test region')
			const bounds = node.getBoundingClientRect()
			const parent = region.getBoundingClientRect()
			return {
				x: bounds.x - parent.x,
				y: bounds.y - parent.y,
				width: bounds.width,
				height: bounds.height
			}
		})
	const before = await position()
	await button.evaluate((node) => node.setAttribute('data-retained', 'yes'))
	await page.getByRole('button', { name: 'Finish test loading' }).click()
	await expect(region.locator('[aria-busy="false"]')).toBeVisible()
	await expect(region.locator('[inert]')).toHaveCount(0)
	await expect(region.getByText('Loading test content')).toHaveCount(0)
	await expect(button).toHaveAttribute('data-retained', 'yes')
	expect(await position()).toEqual(before)
	await button.focus()
	await expect(button).toBeFocused()
})

test('category controls and creation remain usable after queries settle', async ({ page }) => {
	await page.goto('/settings/categories')
	const main = page.getByRole('main')
	await expect(main.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible()
	await expect(main.getByRole('table', { name: 'Categories', exact: true })).toBeVisible()
	await expect(main.locator('[inert]')).toHaveCount(0)
	await main.getByRole('button', { name: 'Add Category', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
	await dialog.getByLabel('Category name', { exact: true }).fill('Loading regression category')
	await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText('Loading regression category')
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(
		main.getByRole('rowheader', { name: 'Loading regression category', exact: true })
	).toBeVisible()
	await page.reload()
	await expect(
		main.getByRole('rowheader', { name: 'Loading regression category', exact: true })
	).toBeVisible()
})
