import { expect, test } from '@playwright/test'

test('startup storage failure is recoverable by an explicit retry', async ({ page }) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.addInitScript(() => {
		const getItem = Storage.prototype.getItem
		let failed = false
		Storage.prototype.getItem = function (key) {
			if (!failed && key.startsWith('jazz-account-selection-v1:')) {
				failed = true
				throw new DOMException('Synthetic account storage failure', 'SecurityError')
			}
			return getItem.call(this, key)
		}
	})
	await page.goto('/settings/banks')
	await expect(
		page.getByText('Your finances could not be opened. Try again.', { exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Try again', exact: true }).click()
	await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
	await expect(
		page.getByText('Your finances could not be opened. Try again.', { exact: true })
	).toBeHidden()
	expect(errors).toEqual([])
})

test('journal actors settle native IndexedDB races and cancellation before releasing connections', async ({
	page
}) => {
	await page.goto('/settings/banks')
	await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const xstatePath = '/node_modules/xstate/dist/xstate.esm.js'
		const journalPath = '/src/lib/machines/account-merge/journal.ts'
		const storagePath = '/src/lib/machines/account-merge/journal-storage.ts'
		const { createActor, toPromise }: typeof import('xstate') = await import(xstatePath)
		const {
			createMergeJournalMachine
		}: typeof import('../src/lib/machines/account-merge/journal.js') = await import(journalPath)
		const {
			journalStorageActor
		}: typeof import('../src/lib/machines/account-merge/journal-storage.js') = await import(
			storagePath
		)
		const appId = crypto.randomUUID()
		const storage = { appId, factory: indexedDB }
		const identityId = crypto.randomUUID()
		const organizationId = crypto.randomUUID()
		const journal: import('../src/lib/schema/account-merge-journal.js').AccountMergeJournal = {
			version: 1,
			operationId: crypto.randomUUID(),
			destination: null,
			snapshot: {
				version: 1,
				sourceIdentityId: identityId,
				sourceOrganization: {
					id: organizationId,
					ownerId: identityId,
					kind: 'personal',
					name: 'Personal',
					defaultCurrency: 'USD'
				},
				accounts: [],
				categories: [],
				tags: [],
				transactions: [],
				checkDetails: [],
				transactionTags: [],
				transactionBatches: [],
				batchTemplates: [],
				bankAccountLinks: [],
				transactionAttachments: [],
				excludedConnectionCount: 0
			}
		}
		const run = (
			command: import('../src/lib/schema/account-merge-journal.js').MergeJournalCommand
		) => toPromise(createActor(createMergeJournalMachine(storage), { input: { command } }).start())
		const competing = await Promise.all([
			run({ type: 'CREATE', journal }),
			run({ type: 'CREATE', journal: { ...journal, operationId: crypto.randomUUID() } })
		])
		const loaded = await run({ type: 'LOAD' })
		if (loaded.outcome !== 'completed' || !loaded.journal)
			throw new Error('Expected committed journal')
		const winner = loaded.journal
		const bound = await run({
			type: 'BIND',
			operationId: winner.operationId,
			destination: { identityId: crypto.randomUUID(), organizationId: crypto.randomUUID() }
		})
		const wrongOperation = await run({ type: 'DISCARD', operationId: crypto.randomUUID() })
		const discarded = await run({ type: 'DISCARD', operationId: winner.operationId })
		const cancelled = createActor(journalStorageActor, { input: storage })
		cancelled.subscribe((snapshot) => {
			if (snapshot.matches({ replacing: 'active' })) cancelled.send({ type: 'CANCEL' })
		})
		cancelled.start()
		cancelled.send({ type: 'REPLACE', expected: null, journal })
		const cancellation = await toPromise(cancelled)
		const afterCancellation = await run({ type: 'LOAD' })
		// Deletion also proves that every actor released its database connection.
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(`delightful-finances:account-merge:${appId}`)
			request.onsuccess = () => resolve()
			request.onerror = () => reject(request.error)
			request.onblocked = () => reject(new Error('Journal connection leaked'))
		})
		return {
			outcomes: competing.map((value) => value.outcome).sort(),
			bound,
			wrongOperation,
			discarded,
			cancellation,
			afterCancellation
		}
	})
	expect(result.outcomes).toEqual(['completed', 'conflict'])
	expect(result.bound.outcome).toBe('completed')
	expect(result.wrongOperation.outcome).toBe('conflict')
	expect(result.discarded).toEqual({ outcome: 'completed', journal: null })
	expect(result.cancellation).toEqual({ type: 'ERROR', code: 'cancelled' })
	expect(result.afterCancellation).toEqual({ outcome: 'completed', journal: null })
})
