import { expect, test, type Page } from '@playwright/test'

async function seedTransaction(
	page: Page,
	scenario: 'manual' | 'imported' | 'archived' | 'viewer' | 'check' = 'manual'
) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled()
	return page.evaluate(async (scenario) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Test session is not ready.')
		const db = snapshot.client.db
		const [organization] = await db.all(app.organizations)
		if (!organization) throw new Error('Missing organization.')
		const account = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Editable ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const category = await db
			.insert(app.categories, {
				organizationId: organization.id,
				name: 'Editable category',
				kind: scenario === 'check' ? 'income' : 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		const dataPath = '/src/lib/data.ts'
		const { createTransaction }: typeof import('../src/lib/data.js') = await import(dataPath)
		const base = {
			organizationId: organization.id,
			accountId: account.id,
			categoryId: category.id,
			money: { amountMinor: 1234, currency: 'USD' },
			bookedOn: '2026-10-18',
			memo: 'Original memo',
			tags: ['Historical']
		}
		const result = await createTransaction(
			db,
			scenario === 'check'
				? {
						...base,
						kind: 'income',
						source: { source: 'manual' },
						paymentMethod: 'check',
						checkDetails: { checkNumber: '100', checkDate: base.bookedOn }
					}
				: {
						...base,
						kind: 'expense',
						source:
							scenario === 'imported'
								? { source: 'simplefin', externalId: 'imported-edit-test' }
								: { source: 'manual' }
					}
		)
		if ('error' in result) throw new Error(result.error)
		const transactionId = result.value.id
		const [link] = await db.all(app.transactionTags.where({ transactionId }))
		if (!link) throw new Error('Missing tag assignment')
		await db.update(app.tags, link.tagId, { archivedAt: new Date() }).wait({ tier: 'local' })
		if (scenario === 'archived')
			await db.update(app.accounts, account.id, { archivedAt: new Date() }).wait({ tier: 'local' })
		if (scenario === 'viewer') {
			const [member] = await db.all(
				app.organizationMembers.where({
					organizationId: organization.id,
					userId: snapshot.account.id
				})
			)
			if (!member) throw new Error('Missing membership')
			await db
				.update(app.organizationMembers, member.id, { role: 'viewer' })
				.wait({ tier: 'local' })
		}
		return {
			id: transactionId,
			accountId: account.id,
			categoryId: category.id,
			linkId: link.id,
			tagId: link.tagId
		}
	}, scenario)
}

async function persisted(page: Page, id: string) {
	return page.evaluate(async (id) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const [row] = await db.all(app.transactions.where({ id }))
		const links = await db.all(app.transactionTags.where({ transactionId: id }))
		const details = await db.all(app.checkDetails.where({ transactionId: id }))
		return {
			amountMinor: row?.amountMinor,
			memo: row?.memo,
			links: links.map(({ id, tagId }) => ({ id, tagId })),
			checkNumber: details[0]?.checkNumber
		}
	}, id)
}

test('always-visible form supports reverted drafts, repeated offline saves and retained archived tags', async ({
	page,
	context
}) => {
	const seed = await seedTransaction(page)
	await page.goto(`/expenses/${seed.id}`)
	const amount = page.getByLabel('Amount', { exact: true })
	const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
	await expect(amount).toHaveValue('12.34')
	await expect(amount).toBeEnabled()
	await expect(page.getByRole('button', { name: 'Edit transaction', exact: true })).toHaveCount(0)
	await expect(save).toBeDisabled()
	await amount.fill('20')
	await expect(save).toBeEnabled()
	await amount.fill('12.34')
	await expect(save).toBeDisabled()
	await context.setOffline(true)
	await amount.fill('56.78')
	await save.click()
	await expect(page.getByText('Transaction saved.', { exact: true })).toBeVisible()
	await expect(amount).toBeEnabled()
	await expect(save).toBeDisabled()
	await page.getByLabel('Memo (additional notes)', { exact: true }).fill('Second save')
	await save.click()
	await expect(save).toBeDisabled()
	await expect
		.poll(() => persisted(page, seed.id))
		.toMatchObject({
			amountMinor: 5678,
			memo: 'Second save',
			links: [{ id: seed.linkId, tagId: seed.tagId }]
		})
	await context.setOffline(false)
	await page.reload()
	await expect(amount).toHaveValue('56.78')
	await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
		'Second save'
	)
})

for (const scenario of ['viewer', 'imported', 'archived'] satisfies (
	'viewer' | 'imported' | 'archived'
)[]) {
	test(`${scenario} transaction remains visible as a non-editable form`, async ({ page }) => {
		const seed = await seedTransaction(page, scenario)
		await page.goto(`/expenses/${seed.id}`)
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
		await expect(page.getByLabel('Amount', { exact: true })).toBeDisabled()
		await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
			'Original memo'
		)
		await expect(page.getByLabel('Account', { exact: true }).locator('option:checked')).toHaveText(
			'Editable ledger'
		)
		await expect(page.getByRole('button', { name: 'Save Transaction', exact: true })).toHaveCount(0)
	})
}

test('removing a tag alone enables Save and persists removal', async ({ page }) => {
	const seed = await seedTransaction(page)
	await page.goto(`/expenses/${seed.id}`)
	const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
	await expect(save).toBeDisabled()
	await page.getByRole('button', { name: 'Remove Historical', exact: true }).click()
	await expect(save).toBeEnabled()
	await save.click()
	await expect.poll(async () => (await persisted(page, seed.id)).links).toEqual([])
})

test('check details can be edited while payment conversion is unavailable', async ({ page }) => {
	const seed = await seedTransaction(page, 'check')
	await page.goto(`/income/${seed.id}`)
	const payment = page.getByLabel('Payment method', { exact: true })
	await expect(payment).toHaveValue('check')
	await expect(payment.locator('option[value="cash"]')).toBeDisabled()
	const check = page.locator('[name="checkNumber"]')
	await expect(check).toHaveValue('100')
	await check.fill('101')
	await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	await expect.poll(async () => (await persisted(page, seed.id)).checkNumber).toBe('101')
})

for (const viewport of [
	{ width: 1280, height: 900 },
	{ width: 390, height: 844 }
]) {
	test(`metadata starts closed and toggles independently of the form at ${viewport.width}px`, async ({
		page
	}) => {
		await page.setViewportSize(viewport)
		const seed = await seedTransaction(page)
		await page.goto(`/expenses/${seed.id}`)
		const main = page.getByRole('main')
		const metadata = main
			.locator('details')
			.filter({ has: page.locator('summary', { hasText: 'Metadata' }) })
		const summary = metadata.locator('summary')
		const amount = main.getByLabel('Amount', { exact: true })
		await expect(amount).toHaveValue('12.34')
		await expect(amount).toBeVisible()
		await expect(metadata).not.toHaveAttribute('open')
		await expect(metadata.locator('dl')).toBeHidden()
		await amount.fill('45.67')
		await summary.click()
		await expect(metadata).toHaveAttribute('open', '')
		await expect(metadata.locator('dl')).toBeVisible()
		await expect(metadata.locator('dt')).toHaveText([
			'Created by',
			'Created at',
			'Last edited by',
			'Last edited at'
		])
		await expect(metadata.locator('.attribution').first()).not.toHaveText('')
		await expect(metadata.locator('.attribution').last()).not.toHaveText('')
		const times = metadata.locator('time')
		await expect(times).toHaveCount(2)
		for (const time of await times.all()) {
			await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/)
			await expect(time).not.toHaveText('')
		}
		await summary.focus()
		await page.keyboard.press('Enter')
		await expect(metadata).not.toHaveAttribute('open')
		await expect(metadata.locator('dl')).toBeHidden()
		await expect(amount).toBeVisible()
		await expect(amount).toHaveValue('45.67')
		await page.reload()
		await expect(amount).toHaveValue('12.34')
		await expect(metadata).not.toHaveAttribute('open')
	})
}
