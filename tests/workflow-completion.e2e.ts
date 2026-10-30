import { expect, test } from '@playwright/test'
import { prepareSidebar } from './helpers/ui.js'

test('scoped workflow profile edit mode keeps pristine fields editable and unchanged saves disabled', async ({
	page
}) => {
	await page.goto('/account')
	const name = page.getByLabel('Display name', { exact: true })
	const save = page.getByRole('main').getByRole('button', { name: 'Save', exact: true })
	await expect(name).toBeEditable()
	const original = await name.inputValue()
	await expect(save).toBeDisabled()
	await name.fill('Changed profile')
	await expect(save).toBeEnabled()
	await name.fill(original)
	await expect(save).toBeDisabled()
	await name.fill(` ${original} `)
	await expect(save).toBeDisabled()
	await name.fill('Changed profile')
	await save.click()
	await expect(
		page
			.getByRole('main')
			.getByRole('status')
			.filter({ hasText: 'Profile Display name saved.' })
	).toHaveText('Profile Display name saved.')
	await expect(save).toBeDisabled()
	await expect(name).toBeEditable()
	await name.fill('Another profile')
	await expect(save).toBeEnabled()
})

test('scoped workflow first account saves offline and persists through reload', async ({
	page,
	context
}) => {
	await page.goto('/expenses/new')
	await expect(
		page
			.getByRole('main')
			.getByRole('paragraph')
			.filter({ hasText: 'Add an account before recording a transaction.' })
	).toBeVisible()
	const trigger = page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true }).first()
	await trigger.click()
	const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
	await dialog.getByLabel('Account name', { exact: true }).fill('Offline first account')
	await dialog.getByLabel('Account type', { exact: true }).selectOption('cash')
	await context.setOffline(true)
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect
		.poll(
			async () =>
				!(await dialog.isVisible()) ||
				(await dialog.getByRole('status').allTextContents()).some((text) =>
					text.includes('Offline first account saved.')
				)
		)
		.toBe(true)
	if (await dialog.isVisible())
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(
		page
			.getByLabel('Account', { exact: true })
			.locator('option')
			.filter({ hasText: 'Offline first account' })
	).toHaveCount(1)
	await context.setOffline(false)
	await page.reload()
	await expect(
		page
			.getByLabel('Account', { exact: true })
			.locator('option')
			.filter({ hasText: 'Offline first account' })
	).toHaveCount(1)
})

for (const role of ['admin', 'member', 'viewer']) {
	test(`scoped workflow account creation permission: ${role}`, async ({
		page,
		browser,
		baseURL
	}) => {
		await page.goto('/')
		const workspaceSelector = page.getByLabel('Current Workspace', { exact: true })
		await expect.poll(() => workspaceSelector.inputValue()).not.toBe('')
		const organizationId = await workspaceSelector.inputValue()
		await page.goto(`/settings/workspace?workspace=${organizationId}`)
		await expect(
			page.getByRole('textbox', { name: 'Workspace name', exact: true })
		).toBeEditable()
		if (!baseURL) throw new Error('Missing browser base URL')
		const context = await browser.newContext({ baseURL })
		try {
			const subject = await context.newPage()
			await subject.goto('/')
			await expect(subject.getByRole('complementary').getByRole('navigation')).toBeVisible()
			await prepareSidebar(subject)
			await expect(subject.getByLabel('Current Workspace', { exact: true })).not.toHaveValue('')
			const subjectId = await subject.evaluate(async () => {
				const path = '/src/lib/jazz-session.ts'
				const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
					path
				)
				const id = getCurrentJazzSession()?.getSnapshot().account?.id
				if (!id) throw new Error('Missing subject identity')
				return id
			})
			const membershipId = await page.evaluate(
				async ({ organizationId, subjectId, role }) => {
					const schemaPath = '/src/lib/schema.ts',
						sessionPath = '/src/lib/jazz-session.ts'
					const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
					const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') =
						await import(sessionPath)
					const db = getCurrentJazzSession()?.getSnapshot().client?.db
					if (!db) throw new Error('Missing owner database')
					if (role !== 'admin' && role !== 'member' && role !== 'viewer')
						throw new Error('Invalid role')
					const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
					if (!uuid.test(organizationId) || !uuid.test(subjectId))
						throw new Error(`Invalid membership UUIDs: organization=${organizationId}, subject=${subjectId}`)
					const membership = await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectId,
							role,
							accountAccessMode: 'all'
						})
						.wait({ tier: 'local' })
					return membership.id
				},
				{ organizationId, subjectId, role }
			)
			await subject.goto('/accounts')
			// Open Settings before selecting its native workspace control.
			const toggle = subject.getByRole('button', { name: 'Toggle Main navigation', exact: true })
			if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
			const settings = subject
				.locator('aside details')
				.filter({ has: subject.locator('summary').filter({ hasText: 'Settings' }) })
			if ((await settings.getAttribute('open')) === null) await settings.locator('summary').click()
			const selector = subject.getByLabel('Current Workspace', { exact: true })
			await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
			await selector.selectOption(organizationId)
			await subject
				.getByRole('main')
				.getByRole('button', { name: 'Add Account', exact: true })
				.click()
			const dialog = subject.getByRole('dialog', { name: 'Add Account', exact: true })
			const name = dialog.getByLabel('Account name', { exact: true })
			const submit = dialog.getByRole('button', { name: 'Add Account', exact: true })
			if (role === 'admin') {
				await expect(name).toBeEditable()
				await name.fill('Shared admin account')
				await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
				await submit.click()
				await expect(dialog.getByRole('status')).toContainText('Shared admin account')
				// A same-row SDK role delta must update the machine without a submit/input event.
				await dialog.getByRole('button', { name: 'Close', exact: true }).click()
				await subject
					.getByRole('main')
					.getByRole('button', { name: 'Add Account', exact: true })
					.click()
				await expect(name).toBeEditable()
				await page.evaluate(async (membershipId) => {
					const schemaPath = '/src/lib/schema.ts',
						sessionPath = '/src/lib/jazz-session.ts'
					const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
					const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') =
						await import(sessionPath)
					const db = getCurrentJazzSession()?.getSnapshot().client?.db
					if (!db) throw new Error('Missing owner database')
					await db
						.update(app.organizationMembers, membershipId, { role: 'viewer' })
						.wait({ tier: 'global' })
				}, membershipId)
				await expect(name).toBeDisabled()
				await expect(submit).toBeDisabled()
				await expect(
					dialog.getByText('Only workspace owners and admins can add accounts.', { exact: true })
				).toBeVisible()
			} else {
				await expect(name).toBeDisabled()
				await expect(submit).toBeDisabled()
				await expect(
					dialog.getByText('Only workspace owners and admins can add accounts.', { exact: true })
				).toBeVisible()
				const denied = await subject.evaluate(async (organizationId) => {
					const schemaPath = '/src/lib/schema.ts',
						sessionPath = '/src/lib/jazz-session.ts'
					const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
					const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') =
						await import(sessionPath)
					const db = getCurrentJazzSession()?.getSnapshot().client?.db
					if (!db) throw new Error('Missing subject database')
					try {
						await db
							.insert(app.accounts, {
								organizationId,
								name: 'Forbidden',
								kind: 'bank',
								currency: 'USD'
							})
							.wait({ tier: 'global' })
						return false
					} catch {
						return true
					}
				}, organizationId)
				expect(denied).toBe(true)
			}
		} finally {
			await context.close()
		}
	})
}
