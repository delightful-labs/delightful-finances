import { expect, type Locator, type Page } from '@playwright/test'

export async function openSidebarSection(page: Page, label: 'Accounts' | 'Settings') {
	const toggle = page.getByRole('button', { name: 'Toggle navigation', exact: true })
	await expect(toggle).toBeVisible()
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
	const section = page.locator('aside details').filter({
		has: page.locator('summary').filter({ hasText: label })
	})
	await expect(section).toBeVisible()
	if ((await section.getAttribute('open')) === null) await section.locator('summary').click()
	return section
}

export async function prepareSidebar(page: Page) {
	await openSidebarSection(page, 'Accounts')
	await openSidebarSection(page, 'Settings')
}

export async function navigateSidebar(page: Page, label: string) {
	await closeCreationModal(page)
	if (label === 'Accounts') await openSidebarSection(page, 'Accounts')
	if (['Workspace', 'Banks', 'Account', 'Login'].includes(label))
		await openSidebarSection(page, 'Settings')
	await page.locator('aside').getByRole('link', { name: label, exact: true }).click()
}

export function creationDialog(page: Page, label: string) {
	return page.getByRole('dialog', { name: label, exact: true })
}

export async function openCreationModal(page: Page, label: string) {
	const dialog = creationDialog(page, label)
	if (!(await dialog.isVisible())) {
		await page.getByRole('main').getByRole('button', { name: label, exact: true }).first().click()
	}
	await expect(dialog).toBeVisible()
	return dialog
}

export async function closeCreationModal(page: Page) {
	const dialog = page
		.getByRole('dialog')
		.filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) })
	if (await dialog.isVisible()) {
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(dialog).not.toBeVisible()
	}
}

export async function selectWorkspace(selector: Locator, id: string) {
	const page = selector.page()
	await closeCreationModal(page)
	await openSidebarSection(page, 'Settings')
	await selector.selectOption(id)
}
