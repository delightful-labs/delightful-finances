import { expect, test, type Locator, type Page } from '@playwright/test'

async function bounds(locator: Locator) {
	const box = await locator.boundingBox()
	if (!box) throw new Error('Expected a visible element.')
	return box
}

async function openCreation(page: Page, route: string, label: string) {
	await page.goto(route)
	const trigger = page.getByRole('main').getByRole('button', { name: label, exact: true }).first()
	await expect(trigger).toBeEnabled()
	await trigger.click()
	const dialog = page.getByRole('dialog', { name: label, exact: true })
	await expect(dialog).toBeVisible()
	return { trigger, dialog }
}

for (const entity of ['category', 'tag']) {
	const category = entity === 'category'
	const label = category ? 'Add Category' : 'Add Tag'
	const route = category ? '/settings/categories' : '/settings/tags'
	const field = category ? 'Category name' : 'Tag name'
	const caption = category ? 'Categories' : 'Tags'
	const error = category
		? 'Enter a category name and select income or expense.'
		: 'Enter a tag name and select an available category or no category.'

	test(`${entity} modal validates, retains drafts, saves and keeps its table scrollable`, async ({
		page
	}) => {
		const { trigger, dialog } = await openCreation(page, route, label)
		await expect(trigger.locator('svg[aria-hidden="true"]')).toHaveCount(1)
		const buttons = dialog.locator('.form-controls > button')
		await expect(buttons).toHaveText(['Cancel', label])
		await expect(buttons.locator('svg[aria-hidden="true"]')).toHaveCount(2)
		const cancelBox = await bounds(buttons.first())
		const addBox = await bounds(buttons.last())
		expect(Math.abs(cancelBox.width - addBox.width)).toBeLessThan(1)
		expect(cancelBox.x).toBeLessThan(addBox.x)
		const controls = await bounds(dialog.locator('.form-controls'))
		expect(Math.abs(cancelBox.width + addBox.width + 8 - controls.width)).toBeLessThan(1)

		const name = dialog.getByLabel(field, { exact: true })
		await name.fill('   ')
		await dialog.getByRole('button', { name: label, exact: true }).click()
		await expect(dialog.getByRole('alert')).toHaveText(error)
		await name.fill('Unsaved draft')
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(dialog).not.toBeVisible()
		await expect(trigger).toBeFocused()
		await trigger.click()
		await expect(name).toHaveValue('Unsaved draft')
		await page.keyboard.press('Escape')
		await expect(dialog).not.toBeVisible()
		await expect(trigger).toBeFocused()
		await trigger.click()
		await page.mouse.click(2, 2)
		await expect(dialog).not.toBeVisible()
		await expect(trigger).toBeFocused()
		await trigger.click()

		const savedName = `${entity}-${'longname'.repeat(16)}`
		await name.fill(savedName)
		await dialog.getByRole('button', { name: label, exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText(savedName)
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await trigger.click()
		await expect(name).toHaveValue('')
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		const table = page.getByRole('main').getByRole('table', { name: caption, exact: true })
		await expect(table.getByRole('rowheader', { name: savedName, exact: true })).toBeVisible()
		const tableBox = await bounds(table)
		const triggerBox = await bounds(trigger)
		expect(triggerBox.y).toBeGreaterThanOrEqual(tableBox.y + tableBox.height)
		await page.setViewportSize({ width: 390, height: 900 })
		const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
		const region = page.getByRole('main').getByRole('region', { name: caption, exact: true })
		await expect(region).toBeVisible()
		expect(await region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
		await expect(page.getByRole('main')).not.toHaveAttribute('inert', '')
		await region.focus()
		await expect(region).toBeFocused()
		await page.keyboard.press('ArrowRight')
		await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
		await expect(
			table.getByRole('button', { name: `Archive ${savedName}`, exact: true })
		).toBeVisible()
		await page.reload()
		await expect(
			page.getByRole('main').getByRole('rowheader', { name: savedName, exact: true })
		).toBeVisible()
	})
}

for (const route of ['/expenses', '/income', '/expenses/new', '/income/new']) {
	test(`first account can be created from ${route} and used for a transaction`, async ({
		page
	}) => {
		const { dialog } = await openCreation(page, route, 'Add Account')
		await expect(page).toHaveURL((url) => url.pathname === route)
		await dialog.getByLabel('Account name', { exact: true }).fill('First checking')
		await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog).not.toBeVisible()
		await expect(page).toHaveURL((url) => url.pathname === route)
		const entry = route.endsWith('/new') ? route : `${route}/new`
		if (entry !== route) await page.goto(entry)
		const main = page.getByRole('main')
		await expect(main.getByLabel('Account', { exact: true }).locator('option:checked')).toHaveText(
			'First checking'
		)
		await main.getByLabel('Amount', { exact: true }).fill('12.34')
		const description = main.getByLabel('Description', { exact: true })
		const memo = main.getByLabel('Memo (additional notes)', { exact: true })
		await expect(description).toHaveJSProperty('tagName', 'INPUT')
		await expect(memo).toHaveJSProperty('tagName', 'TEXTAREA')
		await description.fill('  First transaction  ')
		await memo.fill('Additional notes\nSecond line')
		await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(page).toHaveURL((url) => url.pathname === route.replace('/new', ''))
		await expect(main.getByText('First transaction', { exact: true })).toBeVisible()
		await expect(main.getByText('Additional notes', { exact: false })).toHaveCount(0)
		await main.getByRole('link', { name: /Transaction details:.*First transaction/ }).click()
		await expect(main.getByLabel('Description', { exact: true })).toHaveValue('First transaction')
		await expect(main.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
			'Additional notes\nSecond line'
		)
		await main.getByLabel('Description', { exact: true }).fill('Updated description')
		await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(
			main.getByRole('status').filter({ hasText: /^Transaction saved\.$/ })
		).toBeVisible()
		await page.reload()
		await expect(main.getByLabel('Description', { exact: true })).toHaveValue('Updated description')
		await expect(main.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
			'Additional notes\nSecond line'
		)
	})
}

test('account management reuses the modal and the removed account route is unavailable', async ({
	page
}) => {
	const { dialog } = await openCreation(page, '/accounts', 'Add Account')
	await dialog.getByLabel('Account name', { exact: true }).fill('Modal checking')
	await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText('Modal checking')
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('cell', { name: 'Modal checking', exact: true })
	).toBeVisible()
	const response = await page.goto('/accounts/new')
	expect(response?.status()).toBe(404)
})

test('sidebar icons align and Details child content retains padding', async ({ page }) => {
	await page.goto('/accounts')
	const sidebar = page.locator('aside.inline-drawer')
	const accounts = sidebar
		.locator('details')
		.filter({ has: page.locator('summary', { hasText: 'Accounts' }) })
	await accounts.locator('summary').click()
	const topIcon = sidebar.getByRole('link', { name: 'Expenses', exact: true }).locator('svg')
	const summaryIcon = accounts
		.locator('summary')
		.getByText('Accounts', { exact: true })
		.locator('svg')
	const nestedIcon = accounts
		.getByRole('link', { name: 'Manage Accounts', exact: true })
		.locator('svg')
	const positions = await Promise.all([bounds(topIcon), bounds(summaryIcon), bounds(nestedIcon)])
	expect(
		Math.max(...positions.map((box) => box.x)) - Math.min(...positions.map((box) => box.x))
	).toBeLessThan(1)
	await expect(accounts.locator('summary')).toHaveAttribute('data-caret-position', 'right')
	expect(await accounts.evaluate((node) => getComputedStyle(node).borderWidth)).toBe('0px')
	expect(
		await accounts
			.locator('.details-content-section')
			.evaluate((node) => getComputedStyle(node).paddingLeft)
	).toBe('16px')
	expect(
		await accounts.locator('summary').evaluate((node) => getComputedStyle(node).userSelect)
	).toBe('none')
})

for (const entity of ['category', 'tag', 'account']) {
	test(`${entity} modal closes and resets its draft when the active workspace changes`, async ({
		page
	}) => {
		const route =
			entity === 'account'
				? '/accounts'
				: `/settings/${entity === 'category' ? 'categories' : 'tags'}`
		const label =
			entity === 'account' ? 'Add Account' : entity === 'category' ? 'Add Category' : 'Add Tag'
		const field = `${entity[0]?.toUpperCase()}${entity.slice(1)} name`
		const { dialog } = await openCreation(page, route, label)
		await dialog.getByLabel(field, { exact: true }).fill('Old workspace draft')
		const workspaceId = await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
				sessionPath
			)
			const snapshot = getCurrentJazzSession()?.getSnapshot()
			if (!snapshot?.client || !snapshot.account) throw new Error('Test session is not ready.')
			const db = snapshot.client.db
			const workspace = await db
				.insert(app.organizations, {
					name: 'Second modal workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: snapshot.account.id
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: workspace.id,
					userId: snapshot.account.id,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			return workspace.id
		})
		const selector = page.getByLabel('Current Workspace', { exact: true })
		await expect(selector.locator(`option[value="${workspaceId}"]`)).toHaveCount(1)
		// Exercise a scope update while the modal owns focus, as with an external workspace change.
		await selector.evaluate((node, id) => {
			if (!(node instanceof HTMLSelectElement)) throw new Error('Expected workspace selector.')
			node.value = id
			node.dispatchEvent(new Event('change', { bubbles: true }))
		}, workspaceId)
		await expect(dialog).not.toBeVisible()
		const trigger = page.getByRole('main').getByRole('button', { name: label, exact: true }).first()
		await expect(trigger).toBeEnabled()
		await trigger.click()
		await expect(dialog).toBeVisible()
		await expect(dialog.getByLabel(field, { exact: true })).toHaveValue('')
	})
}
