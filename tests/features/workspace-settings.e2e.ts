import { expect } from '@playwright/test'
import { test, start, installWorkspaceSettingsTest } from '../helpers/workspace.js'
import { openCreationModal, selectWorkspace } from '../helpers/ui.js'

test(
	'owner can rename, reject whitespace, retry, and retain the name after reload',
	{ tag: ['@workspace-rename', '@workspaces'] },
	async ({ page }) => {
		// Console events can disappear during teardown; retain action warnings across reload.
		await page.addInitScript(() => {
			const warn = console.warn.bind(console)
			console.warn = (...args) => {
				if (String(args[0]).includes('Custom actions should not call')) {
					sessionStorage.setItem('workspace-action-warning', String(args[0]))
				}
				warn(...args)
			}
		})
		await start(page)
		const workspaceId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const name = page.getByRole('textbox', { name: 'Workspace name', exact: true })
		const save = page.getByRole('button', { name: 'Save', exact: true })
		await name.fill('   ')
		await save.click()
		await expect(page.getByRole('alert').filter({ hasText: 'Enter Workspace name' })).toHaveText(
			'Enter Workspace name'
		)
		await name.fill('  Household  ')
		await save.click()
		await expect(
			page.getByRole('main').getByRole('status').filter({ hasText: 'Workspace settings saved.' })
		).toHaveText('Workspace settings saved.')
		await expect(
			page.getByLabel('Current Workspace', { exact: true }).locator('option:checked')
		).toHaveText('Household')
		await page.reload()
		await expect(name).toHaveValue('Household')
		await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
		await expect(save).toBeDisabled()
		expect(await page.evaluate(() => sessionStorage.getItem('workspace-action-warning'))).toBeNull()

		const currency = page.locator('#workspace-default-currency')
		await expect(currency).toHaveValue('USD')
		await currency.selectOption('TZS')
		await save.click()
		await expect(
			page.getByRole('main').getByRole('status').filter({ hasText: 'Workspace settings saved.' })
		).toHaveText('Workspace settings saved.')
		await expect(currency).toHaveValue('TZS')
		await page.reload()
		await expect(currency).toHaveValue('TZS')

		await page.goto(`/accounts?workspace=${workspaceId}`)
		const accountDialog = await openCreationModal(page, 'Add Account')
		await expect(accountDialog.getByLabel('Currency', { exact: true })).toHaveValue('TZS')
		await accountDialog.getByLabel('Account name').fill('Default currency wallet')
		await accountDialog.getByLabel('Account type').selectOption('cash')
		await accountDialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(accountDialog.getByRole('status')).toHaveText(
			'Account Default currency wallet saved.'
		)
		await accountDialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('cell', { name: 'TZS', exact: true })
		).toBeVisible()
	}
)

for (const role of ['admin', 'member', 'viewer']) {
	test(
		`${role} has the correct rename access in a shared workspace`,
		{ tag: ['@workspace-rename', '@workspaces', '@permissions'] },
		async ({ page, browser, baseURL }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const otherContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
			try {
				const subject = await otherContext.newPage()
				await start(subject)
				const ownWorkspaceId = await subject
					.getByLabel('Current Workspace', { exact: true })
					.inputValue()
				const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
				await page.evaluate(
					async ({ organizationId, subjectId, role }) => {
						const { app, db } = window.workspaceSettingsTest
						if (role !== 'admin' && role !== 'member' && role !== 'viewer')
							throw new Error('Invalid test role.')
						await db
							.update(app.organizations, organizationId, { name: 'Shared workspace' })
							.wait({ tier: 'global' })
						await db
							.insert(app.organizationMembers, {
								organizationId,
								userId: subjectId,
								role,
								accountAccessMode: 'all'
							})
							.wait({ tier: 'global' })
					},
					{ organizationId, subjectId, role }
				)
				// Reopen to obtain the grant and recreate bindings for the new document.
				await subject.reload()
				await installWorkspaceSettingsTest(subject)
				const selector = subject.getByLabel('Current Workspace', { exact: true })
				await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
				await selectWorkspace(selector, organizationId)
				const name = subject.getByRole('textbox', { name: 'Workspace name', exact: true })
				const currency = subject.locator('#workspace-default-currency')
				const save = subject.getByRole('button', { name: 'Save', exact: true })
				await expect(name).toHaveValue('Shared workspace')
				await expect(currency).toHaveValue('USD')
				if (role === 'admin') {
					await expect(name).toBeEditable()
					await expect(currency).toBeEnabled()
					await currency.selectOption('TZS')
					await name.fill('Admin renamed workspace')
					await save.click()
					await expect(
						subject
							.getByRole('main')
							.getByRole('status')
							.filter({ hasText: 'Workspace settings saved.' })
					).toHaveText('Workspace settings saved.')
					await expect(
						page.getByRole('textbox', { name: 'Workspace name', exact: true })
					).toHaveValue('Admin renamed workspace')
				} else {
					await expect(name).not.toBeEditable()
					await expect(currency).toBeDisabled()
					await expect(save).toBeDisabled()
					await expect(
						subject.getByText('You do not have permission to make this change.')
					).toBeVisible()
					const outcome = await subject.evaluate(async (organizationId) => {
						const { app, db } = window.workspaceSettingsTest
						try {
							await db
								.update(app.organizations, organizationId, { name: 'Forbidden rename' })
								.wait({ tier: 'global' })
							return 'accepted'
						} catch (error) {
							return error instanceof Error ? error.message : 'unknown-error'
						}
					}, organizationId)
					expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
					const savedName = await page.evaluate(async (organizationId) => {
						const { app, db } = window.workspaceSettingsTest
						return (
							await db.one(app.organizations.where({ id: organizationId }), { tier: 'remote' })
						)?.name
					}, organizationId)
					expect(savedName).toBe('Shared workspace')
				}
				await selectWorkspace(selector, ownWorkspaceId)
				await expect(name).toBeEditable()
				await expect(save).toBeDisabled()
				await expect(name).not.toHaveValue('Shared workspace')
			} finally {
				await otherContext.close()
			}
		}
	)
}
