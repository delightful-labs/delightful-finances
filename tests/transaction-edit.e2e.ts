import { expect, test, type Page } from '@playwright/test'

async function seedTransaction(
	page: Page,
	scenario:
		| 'manual'
		| 'imported'
		| 'imported-income'
		| 'archived'
		| 'viewer'
		| 'check'
		| 'expense-check'
		| 'transfer' = 'manual'
) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
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
		const destination =
			scenario === 'check' || scenario === 'transfer'
				? await db
						.insert(app.accounts, {
							organizationId: organization.id,
							name: 'Destination ledger',
							kind: 'cash',
							currency: 'USD'
						})
						.wait({ tier: 'local' })
				: null
		const category = await db
			.insert(app.categories, {
				organizationId: organization.id,
				name: 'Editable category',
				kind: scenario === 'check' || scenario === 'imported-income' ? 'income' : 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		const base = {
			organizationId: organization.id,
			accountId: account.id,
			categoryId: category.id,
			amountMinor: scenario === 'transfer' ? 100 : 1234,
			currency: 'USD',
			bookedOn: scenario === 'transfer' ? '2026-10-25' : '2026-10-18',
			memo: 'Original memo'
		}
		const isIncome = scenario === 'check' || scenario === 'imported-income'
		const check =
			scenario === 'check' || scenario === 'expense-check'
				? await db
						.insert(app.checks, {
							organizationId: organization.id,
							accountId: account.id,
							checkNumber: '100',
							checkDate: base.bookedOn
						})
						.wait({ tier: 'local' })
				: null
		const destinationCategory =
			scenario === 'transfer'
				? await db
						.insert(app.categories, {
							organizationId: organization.id,
							name: 'Destination category',
							kind: 'income',
							isSystem: false
						})
						.wait({ tier: 'local' })
				: null
		const saved = await db
			.insert(app.transactions, {
				...base,
				kind: isIncome ? 'income' : 'expense',
				source:
					scenario === 'imported' || scenario === 'imported-income' || scenario === 'transfer'
						? 'simplefin'
						: 'manual',
				...(scenario === 'imported' || scenario === 'imported-income' || scenario === 'transfer'
					? { externalId: 'imported-edit-test' }
					: {}),
				...(check ? { paymentMethod: 'check', checkId: check.id } : {})
			})
			.wait({ tier: 'local' })
		const counterpart =
			destination && destinationCategory
				? await db
						.insert(app.transactions, {
							...base,
							accountId: destination.id,
							categoryId: destinationCategory.id,
							kind: 'income',
							source: 'simplefin',
							externalId: 'imported-transfer-counterpart'
						})
						.wait({ tier: 'local' })
				: null
		if (scenario === 'transfer' && destination && destinationCategory) {
			await db
				.insert(app.transactions, {
					...base,
					amountMinor: 101,
					accountId: destination.id,
					categoryId: destinationCategory.id,
					kind: 'income',
					source: 'manual'
				})
				.wait({ tier: 'local' })
		}
		const tag = await db
			.insert(app.tags, {
				organizationId: organization.id,
				kind: isIncome ? 'income' : 'expense',
				name: 'Historical',
				categoryId: category.id
			})
			.wait({ tier: 'local' })
		const link = await db
			.insert(app.transactionTags, {
				organizationId: organization.id,
				transactionId: saved.id,
				tagId: tag.id
			})
			.wait({ tier: 'local' })
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
			id: saved.id,
			counterpartId: counterpart?.id,
			accountId: account.id,
			destinationAccountId: destination?.id,
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
		const transfers = await db.all(app.internalTransfers.where({ expenseTransactionId: id }))
		const check = row?.checkId
			? await db.one(app.checks.where({ id: row.checkId }), { tier: 'local' })
			: null
		return {
			accountId: row?.accountId,
			amountMinor: row?.amountMinor,
			internalTransferId: row?.internalTransferId,
			memo: row?.memo,
			description: row?.description,
			categoryId: row?.categoryId,
			source: row?.source,
			externalId: row?.externalId,
			paymentMethod: row?.paymentMethod,
			checkId: row?.checkId,
			links: links.map(({ id, tagId }) => ({ id, tagId })),
			transfers: transfers.map(({ expenseTransactionId, incomeTransactionId }) => ({
				expenseTransactionId,
				incomeTransactionId
			})),
			checkNumber: check?.checkNumber,
			checkAccountId: check?.accountId
		}
	}, id)
}

async function attachmentState(page: Page, transactionId: string) {
	return page.evaluate(async (transactionId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const links = await db.all(app.transactionAttachments.where({ transactionId }))
		return Promise.all(
			links.map(async ({ id, fileId }) => {
				const file = await db.one(app.files.where({ id: fileId }), { tier: 'local' })
				const parts = await db.all(app.fileParts.where({ fileId }))
				return {
					id,
					fileId,
					fileName: file?.fileName,
					mimeType: file?.mimeType,
					parts: parts.length
				}
			})
		)
	}, transactionId)
}

async function findTransactionByDescription(page: Page, description: string) {
	return page.evaluate(async (description) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.transactions.where({ description })))[0]?.id
	}, description)
}

async function transactionExists(page: Page, id: string) {
	return page.evaluate(async (id) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.transactions.where({ id }))).length > 0
	}, id)
}

async function transferExists(page: Page, expenseTransactionId: string) {
	return page.evaluate(async (expenseTransactionId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.internalTransfers.where({ expenseTransactionId }))).length > 0
	}, expenseTransactionId)
}

async function seedLinkedTransfer(page: Page, expenseId: string, incomeId: string) {
	await page.evaluate(
		async ({ expenseId, incomeId }) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
				sessionPath
			)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const [expense] = await db.all(app.transactions.where({ id: expenseId }))
			const [income] = await db.all(app.transactions.where({ id: incomeId }))
			if (!expense || !income) throw new Error('Missing transfer transactions')
			const transferId = crypto.randomUUID()
			const write = await db.transaction((tx) => {
				tx.update(app.transactions, expenseId, { internalTransferId: transferId })
				tx.update(app.transactions, incomeId, { internalTransferId: transferId })
				tx.insert(
					app.internalTransfers,
					{
						organizationId: expense.organizationId,
						expenseTransactionId: expense.id,
						incomeTransactionId: income.id,
						expenseAccountId: expense.accountId,
						incomeAccountId: income.accountId,
						amountMinor: expense.amountMinor,
						currency: expense.currency
					},
					{ id: transferId }
				)
			})
			await write.wait({ tier: 'local' })
		},
		{ expenseId, incomeId }
	)
	await page.goto(`/income/${incomeId}`)
	await expect(page.getByText('Linked to Transfer')).toBeVisible()
}

test('links and unlinks a matching synced transaction without changing either transaction', async ({
	page
}) => {
	const seed = await seedTransaction(page, 'transfer')
	if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
	await page.goto(`/expenses/${seed.id}`)
	const convertToTransfer = page.getByRole('checkbox', {
		name: 'Convert this transaction to a transfer',
		exact: true
	})
	await expect(convertToTransfer).not.toBeChecked()
	await expect(page.getByRole('region', { name: 'Matching transactions' })).toHaveCount(0)
	await convertToTransfer.check()
	const suggestions = page.getByRole('region', { name: 'Matching transactions' })
	const counterpart = suggestions.getByRole('radio', {
		name: 'Oct 25, 2026 · Destination ledger $1.00',
		exact: true
	})
	await expect(counterpart).toBeVisible()
	await expect(suggestions.getByRole('radio')).toHaveCount(1)
	await counterpart.check()
	await suggestions
		.getByRole('button', { name: 'Link to existing Transaction', exact: true })
		.click()
	await expect(suggestions.getByText('Linked to Transfer')).toBeVisible()
	await expect(suggestions.getByText('Transfer saved.', { exact: true })).toBeVisible()
	await expect
		.poll(() => persisted(page, seed.id))
		.toMatchObject({
			source: 'simplefin',
			externalId: 'imported-edit-test',
			transfers: [{ expenseTransactionId: seed.id, incomeTransactionId: seed.counterpartId }]
		})
	const counterpartId = seed.counterpartId
	if (!counterpartId) throw new Error('Missing transfer counterpart fixture')
	await expect
		.poll(() => persisted(page, counterpartId))
		.toMatchObject({
			source: 'simplefin',
			externalId: 'imported-transfer-counterpart',
			transfers: []
		})
	const openCounterpart = suggestions.getByRole('link', { name: 'Open Transaction', exact: true })
	await expect(openCounterpart).toHaveAttribute(
		'href',
		new RegExp(`/income/${counterpartId}\\?workspace=`)
	)
	await openCounterpart.click()
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === `/income/${counterpartId}` && Boolean(url.searchParams.get('workspace'))
	)
	await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
	const linkedCounterpart = page.getByRole('region', { name: 'Matching transactions' })
	await expect(
		linkedCounterpart.getByRole('link', { name: 'Open Transaction', exact: true })
	).toHaveAttribute('href', new RegExp(`/expenses/${seed.id}\\?workspace=`))
	await linkedCounterpart.getByRole('button', { name: 'Unlink Transfer', exact: true }).click()
	await expect(linkedCounterpart.getByText('Transfer saved.')).toBeVisible()
	await expect
		.poll(() => persisted(page, seed.id))
		.toMatchObject({ internalTransferId: null, transfers: [] })
	await expect
		.poll(() => persisted(page, counterpartId))
		.toMatchObject({ internalTransferId: null, transfers: [] })
})

test('shows an inconsistent transfer and prevents further link actions', async ({ page }) => {
	const seed = await seedTransaction(page, 'transfer')
	if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
	await seedLinkedTransfer(page, seed.id, seed.counterpartId)
	await page.evaluate(async (incomeId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		await db
			.update(app.transactions, incomeId, { internalTransferId: null })
			.wait({ tier: 'local' })
	}, seed.counterpartId)
	await page.goto(`/expenses/${seed.id}`)

	const suggestions = page.getByRole('region', { name: 'Matching transactions' })
	await expect(suggestions.getByText(/This transfer link is inconsistent\./)).toBeVisible()
	await expect(
		page.getByRole('checkbox', { name: 'Convert this transaction to a transfer' })
	).toHaveCount(0)
	await expect(suggestions.getByRole('button', { name: 'Unlink Transfer' })).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Delete Transactions' })).toHaveCount(0)
})

test('deletes both transactions from the linked-transaction choices', async ({ page }) => {
	const seed = await seedTransaction(page, 'transfer')
	if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
	await seedLinkedTransfer(page, seed.id, seed.counterpartId)
	await page.getByRole('button', { name: 'Delete Transactions', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Delete Transactions' })
	await expect(
		dialog.getByText('Both transactions and their transfer link will be deleted.')
	).toBeVisible()
	await expect(
		dialog.getByText(/other transaction will remain as ordinary income or expense/)
	).toBeVisible()
	await dialog.getByRole('button', { name: 'Delete Transactions', exact: true }).click()
	await expect(
		page.getByText('Both linked transactions were deleted on this device.')
	).toBeVisible()
	await expect.poll(() => transactionExists(page, seed.id)).toBe(false)
	await expect.poll(() => transactionExists(page, seed.counterpartId!)).toBe(false)
	await expect.poll(() => transferExists(page, seed.id)).toBe(false)
})

test('unlinks and deletes only the current transaction, restoring the counterpart to totals', async ({
	page
}) => {
	const seed = await seedTransaction(page, 'transfer')
	if (!seed.counterpartId) throw new Error('Missing transfer counterpart fixture')
	await seedLinkedTransfer(page, seed.id, seed.counterpartId)
	await page.getByRole('button', { name: 'Delete Transactions', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Delete Transactions' })
	await dialog.getByRole('button', { name: 'Delete Transaction', exact: true }).click()
	await expect(
		page.getByText(
			'This transaction was unlinked and deleted on this device. The other transaction remains.'
		)
	).toBeVisible()
	await expect.poll(() => transactionExists(page, seed.counterpartId!)).toBe(false)
	await expect.poll(() => transactionExists(page, seed.id)).toBe(true)
	await expect.poll(() => transferExists(page, seed.id)).toBe(false)
	await expect
		.poll(() => persisted(page, seed.id))
		.toMatchObject({ internalTransferId: null, amountMinor: 100, source: 'simplefin' })
	await page.goto('/')
	await expect(page.getByText('Total Expenses: $1.00', { exact: true })).toBeVisible()
})

test('suggests an exact amount match and filters out other amounts', async ({ page }) => {
	const seed = await seedTransaction(page, 'transfer')
	await page.goto(`/expenses/${seed.id}`)
	const convertToTransfer = page.getByRole('checkbox', {
		name: 'Convert this transaction to a transfer',
		exact: true
	})
	await expect(page.getByRole('region', { name: 'Matching transactions' })).toHaveCount(0)
	await convertToTransfer.check()
	const suggestions = page.getByRole('region', { name: 'Matching transactions' })
	await expect(
		suggestions.getByRole('radio', { name: 'Oct 25, 2026 · Destination ledger $1.00', exact: true })
	).toBeVisible()
	await expect(suggestions.getByRole('radio')).toHaveCount(1)
})

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

for (const scenario of ['viewer', 'archived'] satisfies ('viewer' | 'archived')[]) {
	test(`${scenario} transaction remains visible as a non-editable form`, async ({ page }) => {
		const seed = await seedTransaction(page, scenario)
		await page.goto(`/expenses/${seed.id}`)
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
		await expect(page.getByLabel('Amount', { exact: true })).toBeDisabled()
		if (scenario === 'viewer')
			await expect(
				page.getByRole('main').getByRole('button', { name: 'Add Category', exact: true })
			).toBeDisabled()
		await expect(page.getByLabel('Memo (additional notes)', { exact: true })).toHaveValue(
			'Original memo'
		)
		await expect(page.getByLabel('Account', { exact: true }).locator('option:checked')).toHaveText(
			'Editable ledger · USD'
		)
		await expect(page.getByRole('button', { name: 'Save Transaction', exact: true })).toHaveCount(0)
	})
}

const onePixelPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
	'base64'
)

test('creates an image attachment, downloads it, and removes only its transaction link', async ({
	page
}) => {
	const seed = await seedTransaction(page)
	await page.goto('/expenses/new')
	const main = page.getByRole('main')
	await expect(main.getByLabel('Amount', { exact: true })).toBeEnabled()
	await main.getByLabel('Account', { exact: true }).selectOption(seed.accountId)
	await main.getByLabel('Category', { exact: true }).selectOption(seed.categoryId)
	await main.getByLabel('Amount', { exact: true }).fill('12.34')
	await main.getByLabel('Description', { exact: true }).fill('Image receipt')
	await main.locator('input[type="file"]').setInputFiles({
		name: 'receipt.png',
		mimeType: 'image/png',
		buffer: onePixelPng
	})
	await expect
		.poll(() =>
			main.locator('input[type="file"]').evaluate((input: HTMLInputElement) => input.files?.length)
		)
		.toBe(1)
	await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	await page.waitForURL(/\/expenses(?:\?|$)/)
	await expect.poll(() => findTransactionByDescription(page, 'Image receipt')).toBeTruthy()
	const transactionId = await findTransactionByDescription(page, 'Image receipt')
	if (!transactionId) throw new Error('Saved transaction was not found')
	await page.goto(`/expenses/${transactionId}`)
	const information = page.getByRole('button', { name: 'Image details: receipt.png', exact: true })
	await information.focus()
	await information.press('Enter')
	const filename = page.getByRole('link', { name: 'receipt.png', exact: true })
	await expect(filename).toBeVisible()
	const preview = page.getByRole('dialog', { name: 'receipt.png', exact: true })
	await expect(preview.getByRole('img', { name: 'Preview of receipt.png' })).toBeVisible()
	const [download] = await Promise.all([page.waitForEvent('download'), filename.click()])
	expect(download.suggestedFilename()).toBe('receipt.png')
	const [attached] = await attachmentState(page, transactionId)
	expect(attached).toMatchObject({ fileName: 'receipt.png', mimeType: 'image/png' })
	expect(attached?.parts).toBeGreaterThan(0)
	const fileId = attached?.fileId
	if (!fileId) throw new Error('Uploaded file was not found')
	// Keep a second authorized reference so retained contents remain readable.
	await page.evaluate(
		async ({ fileId, transactionId }) => {
			const schemaPath = '/src/lib/schema.ts',
				sessionPath = '/src/lib/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
				sessionPath
			)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			await db.insert(app.transactionAttachments, { transactionId, fileId }).wait({ tier: 'local' })
		},
		{ fileId, transactionId: seed.id }
	)
	await page.keyboard.press('Escape')
	await expect(information).toBeFocused()
	await information.press('Enter')
	await page.getByRole('button', { name: 'Remove receipt.png', exact: true }).focus()
	await page.getByRole('button', { name: 'Remove receipt.png', exact: true }).press('Enter')
	await expect.poll(() => attachmentState(page, transactionId)).toHaveLength(0)
	if (!fileId) throw new Error('Uploaded file was not found')
	const retained = await page.evaluate(async (fileId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return db.one(app.files.where({ id: fileId }), { tier: 'local' })
	}, fileId)
	expect(retained?.id).toBe(fileId)
})

test('accumulates images beside the picker, removes a draft, and restores saved previews after reload', async ({
	page
}) => {
	const seed = await seedTransaction(page)
	await page.goto(`/expenses/${seed.id}`)
	const imageInput = page.locator('main input[type="file"]')
	await expect(imageInput).toBeEnabled()
	await imageInput.setInputFiles({
		name: 'edited.png',
		mimeType: 'image/png',
		buffer: onePixelPng
	})
	await expect(imageInput).toHaveAttribute('multiple', '')
	await imageInput.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: onePixelPng })
	await expect(page.getByRole('img', { name: 'edited.png', exact: true })).toBeVisible()
	await expect(page.getByRole('img', { name: 'second.png', exact: true })).toBeVisible()
	const inputBounds = await imageInput.boundingBox()
	const firstBounds = await page.getByRole('img', { name: 'edited.png', exact: true }).boundingBox()
	if (!inputBounds || !firstBounds) throw new Error('Missing picker or preview')
	expect(firstBounds.x + firstBounds.width).toBeLessThanOrEqual(inputBounds.x)
	await page.getByRole('button', { name: 'Image details: second.png', exact: true }).click()
	await page.getByRole('button', { name: 'Remove Image: second.png', exact: true }).focus()
	await page.keyboard.press('Enter')
	await expect(imageInput).toBeFocused()
	await expect(page.getByRole('img', { name: 'second.png', exact: true })).toHaveCount(0)

	await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	await expect(page.getByRole('img', { name: 'Preview of edited.png' })).toBeVisible()
	await expect.poll(() => attachmentState(page, seed.id)).toHaveLength(1)
	await page.reload()
	await expect(page.getByRole('img', { name: 'Preview of edited.png' })).toBeVisible()
})

test('shows shared form feedback when selected images exceed the per-transaction limit', async ({
	page
}) => {
	await seedTransaction(page)
	await page.goto('/expenses/new')
	const main = page.getByRole('main')
	await main.getByLabel('Amount', { exact: true }).fill('12.34')
	await expect(
		main.getByText(
			'JPEG, PNG, or WebP images. Up to five images per transaction. Up to 10 MiB per image.'
		)
	).toBeVisible()
	await main.locator('input[type="file"]').setInputFiles(
		Array.from({ length: 6 }, (_, index) => ({
			name: `receipt-${index}.png`,
			mimeType: 'image/png',
			buffer: onePixelPng
		}))
	)
	await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	await expect(main.locator('#transaction-attachments-error')).toContainText(
		'Check the form and try again.'
	)
})

test('shows shared form feedback for unsupported and oversized image selections', async ({
	page
}) => {
	await seedTransaction(page)
	const selections = [
		{
			name: 'receipt.svg',
			mimeType: 'image/svg+xml',
			buffer: Buffer.from('<svg></svg>')
		},
		{
			name: 'oversized.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(10 * 1024 * 1024 + 1)
		}
	]
	for (const selection of selections) {
		await page.goto('/expenses/new')
		const main = page.getByRole('main')
		await main.getByLabel('Amount', { exact: true }).fill('12.34')
		await main.locator('input[type="file"]').setInputFiles({
			name: selection.name,
			mimeType: selection.mimeType,
			buffer: selection.buffer
		})
		await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(main.locator('#transaction-attachments-error')).toContainText(
			'Check the form and try again.'
		)
	}
})

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

test('inline Check details can be edited and its account moves with the transaction', async ({
	page
}) => {
	const seed = await seedTransaction(page, 'check')
	const destinationAccountId = seed.destinationAccountId
	if (!destinationAccountId) throw new Error('Missing destination account fixture')
	await page.goto(`/income/${seed.id}`)
	const payment = page.getByLabel('Payment method', { exact: true })
	await expect(payment).toHaveValue('check')
	await expect(payment.locator('option[value="cash"]')).toBeEnabled()
	const check = page.locator('[name="checkNumber"]')
	await expect(check).toHaveValue('100')
	await check.fill('101')
	await page.getByLabel('Account', { exact: true }).selectOption(destinationAccountId)
	await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	await expect
		.poll(() => persisted(page, seed.id))
		.toMatchObject({
			checkNumber: '101',
			accountId: destinationAccountId,
			checkAccountId: destinationAccountId
		})
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

test('manual amount entry saves above the former ceiling with exact cents', async ({ page }) => {
	const seed = await seedTransaction(page)
	await page.goto(`/expenses/${seed.id}`)
	const amount = page.getByLabel('Amount', { exact: true })
	const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
	for (const [text, amountMinor] of [
		['21474836.48', 2_147_483_648],
		['90071992547409.91', Number.MAX_SAFE_INTEGER]
	] satisfies [string, number][]) {
		await amount.fill(text)
		await save.click()
		await expect(save).toBeDisabled()
		await expect.poll(() => persisted(page, seed.id)).toMatchObject({ amountMinor })
		await page.reload()
		await expect(amount).toHaveValue(text)
	}
	await amount.fill('90071992547409.92')
	await save.click()
	await expect(amount).toHaveAttribute('aria-invalid', 'true')
	await expect(page.getByText('Transaction saved.', { exact: true })).toHaveCount(0)
	await expect
		.poll(() => persisted(page, seed.id))
		.toMatchObject({ amountMinor: Number.MAX_SAFE_INTEGER })
})

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(`imported ${kind} supports category, tag and note edits offline without changing provenance`, async ({
		page,
		context
	}) => {
		const seed = await seedTransaction(page, kind === 'expense' ? 'imported' : 'imported-income')
		await page.goto(`/${kind === 'expense' ? 'expenses' : 'income'}/${seed.id}`)
		const amount = page.getByLabel('Amount', { exact: true })
		const save = page.getByRole('button', { name: 'Save Transaction', exact: true })
		await expect(amount).toBeEnabled()
		await expect(save).toBeDisabled()
		if (kind === 'income') {
			const payment = page.getByLabel('Payment method', { exact: true })
			await expect(payment).toBeVisible()
			await expect(payment).toHaveValue('')
		}
		const memo = page.getByLabel('Memo (additional notes)', { exact: true })
		await memo.fill('Changed')
		await expect(save).toBeEnabled()
		await memo.fill('Original memo')
		await expect(save).toBeDisabled()
		const category = page.getByLabel('Category', { exact: true })
		const replacementId = await category
			.locator('option')
			.evaluateAll((options) =>
				options
					.find(
						(option) =>
							option instanceof HTMLOptionElement &&
							!option.disabled &&
							option.value &&
							option.label !== 'Editable category'
					)
					?.getAttribute('value')
			)
		if (!replacementId) throw new Error('Missing alternate category')
		await context.setOffline(true)
		await category.selectOption(replacementId)
		await amount.fill('56.78')
		await page.getByLabel('Description', { exact: true }).fill('User description')
		await memo.fill('User notes')
		const tags = page
			.getByRole('textbox', { name: 'Tags', exact: true })
			.or(page.getByRole('combobox', { name: 'Tags', exact: true }))
		await tags.fill('User tag')
		await tags.press('Enter')
		await save.click()
		await expect(save).toBeDisabled()
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({
				amountMinor: 5678,
				description: 'User description',
				memo: 'User notes',
				categoryId: replacementId,
				source: 'simplefin',
				externalId: 'imported-edit-test',
				paymentMethod: null
			})
		await expect.poll(async () => (await persisted(page, seed.id)).links.length).toBe(2)
		await context.setOffline(false)
		await page.reload()
		await expect(memo).toHaveValue('User notes')
		await expect(amount).toHaveValue('56.78')
		await expect(page.getByRole('button', { name: 'Remove User tag', exact: true })).toBeVisible()
		await expect(save).toBeDisabled()
	})
}

test('expense edits preserve an existing check without exposing inline payment controls', async ({
	page
}) => {
	const seed = await seedTransaction(page, 'expense-check')
	const original = await persisted(page, seed.id)
	expect(original.checkId).toBeTruthy()
	await page.goto(`/expenses/${seed.id}`)
	await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
	await expect(page.getByLabel('Payment method', { exact: true })).toHaveCount(0)
	await expect(page.locator('[name="checkNumber"]')).toHaveCount(0)
	await expect(page.locator('input[name="paymentMethod"]')).toHaveValue('check')
	await expect(page.locator('input[name="checkId"]')).toHaveValue(original.checkId ?? '')
	await page.getByLabel('Memo (additional notes)', { exact: true }).fill('Expense check retained')
	await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	await expect
		.poll(() => persisted(page, seed.id))
		.toMatchObject({
			memo: 'Expense check retained',
			paymentMethod: 'check',
			checkId: original.checkId,
			checkNumber: '100',
			checkAccountId: seed.accountId
		})
})

test('list and overview show archived tag names and react to renaming', async ({ page }) => {
	const seed = await seedTransaction(page)
	await page.evaluate(async (id) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const date = new Date()
		const bookedOn = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
		await db
			.update(app.transactions, id, { bookedOn, description: 'Tagged cleanup row' })
			.wait({ tier: 'local' })
	}, seed.id)
	for (const path of ['/expenses', '/']) {
		await page.goto(path)
		const row = page
			.locator('li')
			.filter({ has: page.getByText('Tagged cleanup row', { exact: true }) })
		await expect(row.locator('.classification')).toContainText('Historical')
	}
	await page.evaluate(async (id) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		await db.update(app.tags, id, { name: 'Renamed historical' }).wait({ tier: 'local' })
	}, seed.tagId)
	const row = page
		.locator('li')
		.filter({ has: page.getByText('Tagged cleanup row', { exact: true }) })
	await expect(row.locator('.classification')).toContainText('Renamed historical')
	await page.goto('/expenses')
	await expect(row.locator('.classification')).toContainText('Renamed historical')
})

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(`inline ${kind} category creation preserves drafts, binds kind and selects repeated additions offline`, async ({
		page,
		context
	}) => {
		const seed = await seedTransaction(page, kind === 'income' ? 'imported-income' : 'manual')
		await page.goto(`/${kind === 'income' ? 'income' : 'expenses'}/${seed.id}`)
		const main = page.getByRole('main')
		const category = main.getByLabel('Category', { exact: true })
		const memo = main.getByLabel('Memo (additional notes)', { exact: true })
		const save = main.getByRole('button', { name: 'Save Transaction', exact: true })
		await expect(category).toHaveValue(seed.categoryId)
		await memo.fill('Unsaved category draft')
		const add = main.getByRole('button', { name: 'Add Category', exact: true })
		await expect(add).toBeEnabled()
		await context.setOffline(true)
		await add.click()
		const dialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
		await expect(dialog).toBeVisible()
		await expect(dialog.getByRole('combobox')).toHaveCount(0)
		await dialog.getByLabel('Category name', { exact: true }).fill('Cancelled category')
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(category).toHaveValue(seed.categoryId)
		await expect(memo).toHaveValue('Unsaved category draft')
		for (const name of ['First inline category', 'Second inline category']) {
			await add.click()
			await dialog.getByLabel('Category name', { exact: true }).fill(name)
			// A forged hidden kind cannot override the transaction's observed kind.
			await dialog.locator('input[name="kind"]').evaluate((input) => {
				if (input instanceof HTMLInputElement)
					input.value = input.value === 'income' ? 'expense' : 'income'
			})
			await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
			await expect(dialog.getByRole('status')).toContainText(name)
			await dialog.getByRole('button', { name: 'Close', exact: true }).click()
			await expect(category.locator('option:checked')).toHaveText(name)
			await expect(memo).toHaveValue('Unsaved category draft')
			await expect(save).toBeEnabled()
			await expect
				.poll(() => persisted(page, seed.id))
				.toMatchObject({ categoryId: seed.categoryId, memo: 'Original memo' })
		}
		const selectedId = await category.inputValue()
		await category.selectOption(seed.categoryId)
		await memo.fill('Still my chosen category')
		await expect(category).toHaveValue(seed.categoryId)
		await category.selectOption(selectedId)
		await save.click()
		await expect(save).toBeDisabled()
		await expect
			.poll(() => persisted(page, seed.id))
			.toMatchObject({ categoryId: selectedId, memo: 'Still my chosen category' })
		await context.setOffline(false)
		await page.reload()
		await expect(category).toHaveValue(selectedId)
		await expect(memo).toHaveValue('Still my chosen category')
		await expect(save).toBeDisabled()
		await add.click()
		await dialog.getByLabel('Category name', { exact: true }).fill('Category only change')
		await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Category only change')
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(category.locator('option:checked')).toHaveText('Category only change')
		await expect(save).toBeEnabled()
		const categoryOnlyId = await category.inputValue()
		const createdRows = await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
				sessionPath
			)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			return (await db.all(app.categories))
				.filter((row) =>
					[
						'First inline category',
						'Second inline category',
						'Category only change',
						'Cancelled category'
					].includes(row.name)
				)
				.map(({ id, name, kind }) => ({ id, name, kind }))
		})
		expect(createdRows).toHaveLength(3)
		expect(createdRows.every((row) => row.kind === kind)).toBe(true)
		await save.click()
		await expect.poll(() => persisted(page, seed.id)).toMatchObject({ categoryId: categoryOnlyId })
	})
}

test('inline category rejects duplicate names without changing the draft selection', async ({
	page
}) => {
	const seed = await seedTransaction(page)
	await page.goto(`/expenses/${seed.id}`)
	await page.getByRole('main').getByRole('button', { name: 'Add Category', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Add Category', exact: true })
	await dialog.getByLabel('Category name', { exact: true }).fill('Editable category')
	await dialog.getByRole('button', { name: 'Add Category', exact: true }).click()
	await expect(
		dialog.getByText('An active item with this name already exists. Choose another name.', {
			exact: true
		})
	).toBeVisible()
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(page.getByLabel('Category', { exact: true })).toHaveValue(seed.categoryId)
	await expect(page.getByRole('button', { name: 'Save Transaction', exact: true })).toBeDisabled()
})

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(`${kind} list abbreviates month names and preserves date semantics`, async ({ page }) => {
		await seedTransaction(page, kind === 'income' ? 'imported-income' : 'manual')
		await page.goto(kind === 'income' ? '/income' : '/expenses')
		const date = page.getByRole('main').locator('time[datetime="2026-10-18"]')
		await expect(date).toHaveText('Sun, Oct 18, 2026')
	})
}
