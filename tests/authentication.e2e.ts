import { prepareSidebar, openCreationModal, closeCreationModal } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { generateAuthSecret } from 'jazz-tools'

async function createAccount(page: Page, name: string) {
	await page.goto('/accounts')
	await prepareSidebar(page)
	await expect(page.getByLabel('Current workspace', { exact: true })).not.toHaveValue('')
	const dialog = await openCreationModal(page, 'Add Account')
	await dialog.getByLabel('Account name').fill(name)
	await dialog.getByLabel('Account type').selectOption('bank')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText(name)
	await closeCreationModal(page)
}

async function restoreAccount(page: Page, phrase: string) {
	await page.goto('/login')
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	await expect(page).toHaveURL('/')
	await prepareSidebar(page)
}

const invalidPhrases = [
	{ name: 'wrong word count', phrase: 'abandon' },
	{ name: 'unknown word', phrase: Array(24).fill('notaword').join(' ') },
	{ name: 'invalid checksum', phrase: Array(24).fill('abandon').join(' ') }
]

for (const { name, phrase } of invalidPhrases) {
	test(`rejects ${name} without replacing the current account or data`, async ({ page }) => {
		// Confirm each fixture is invalid using Jazz's own recovery validator.
		expect(() => RecoveryPhrase.toSecret(phrase)).toThrow()
		await createAccount(page, 'Retained checking')
		const workspaceId = await page.getByLabel('Current workspace', { exact: true }).inputValue()
		await page.goto('/login')
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		await expect(page.getByRole('alert')).toHaveText(
			'The account could not be restored. Check the recovery phrase and try again.'
		)
		await expect(page).toHaveURL('/login')
		await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled()
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveValue(phrase)
		await expect(page.getByLabel('Current workspace', { exact: true })).toHaveValue(workspaceId)

		await page.goto('/accounts')
		await page.reload()
		await expect(page.getByLabel('Current workspace', { exact: true })).toHaveValue(workspaceId)
		await expect(
			page.getByLabel('Current workspace', { exact: true }).locator('option')
		).toHaveCount(1)
		await expect(page.getByRole('cell', { name: 'Retained checking', exact: true })).toHaveCount(1)
	})
}

test('restores existing workspace data without duplicates or previous identity accounts', async ({
	page,
	browser,
	baseURL
}) => {
	await createAccount(page, 'Original checking')
	const workspaceId = await page.getByLabel('Current workspace', { exact: true }).inputValue()
	await page.goto('/account')
	await page.getByRole('button', { name: 'Show recovery phrase' }).click()
	const phrase = await page.getByLabel('Your recovery phrase').inputValue()
	await page.getByLabel('I saved this phrase somewhere safe.').check()
	await page.getByRole('button', { name: 'I saved the phrase' }).click()

	const otherContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
	try {
		const otherPage = await otherContext.newPage()
		await createAccount(otherPage, 'Previous identity checking')
		await restoreAccount(otherPage, phrase)
		await expect(otherPage.getByLabel('Current workspace', { exact: true })).toHaveValue(
			workspaceId
		)
		await expect(
			otherPage.getByLabel('Current workspace', { exact: true }).locator('option')
		).toHaveCount(1)
		await otherPage.goto('/accounts')
		await expect(
			otherPage.getByRole('cell', { name: 'Original checking', exact: true })
		).toBeVisible()
		await expect(otherPage.getByText('Previous identity checking', { exact: true })).toHaveCount(0)

		await restoreAccount(otherPage, phrase)
		await otherPage.reload()
		await expect(otherPage.getByLabel('Current workspace', { exact: true })).toHaveValue(
			workspaceId
		)
		await expect(
			otherPage.getByLabel('Current workspace', { exact: true }).locator('option')
		).toHaveCount(1)
		await otherPage.goto('/accounts')
		await expect(
			otherPage.getByRole('cell', { name: 'Original checking', exact: true })
		).toHaveCount(1)
		await expect(otherPage.getByText('Previous identity checking', { exact: true })).toHaveCount(0)
		await otherPage.goto('/expenses/new')
		await expect(otherPage.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(6)
		await otherPage.goto('/incomes/new')
		await expect(otherPage.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(4)
	} finally {
		await otherContext.close()
	}
})

test('recovery modal clears its content and confirmation on every dismissal', async ({ page }) => {
	await createAccount(page, 'Recovery modal checking')
	await page.goto('/account')
	const show = page.getByRole('button', { name: 'Show recovery phrase' })
	const dialog = page.getByRole('dialog', { name: 'Account recovery' })
	const phrase = page.getByLabel('Your recovery phrase', { exact: true })
	const confirmation = page.getByLabel('I saved this phrase somewhere safe.')
	const complete = page.getByRole('button', { name: 'I saved the phrase', exact: true })

	for (const dismissal of ['close', 'escape', 'backdrop', 'complete']) {
		await show.click()
		await expect(dialog).toBeVisible()
		// Never include recovery secrets in assertion output or test artifacts.
		expect(await phrase.evaluate((element: HTMLTextAreaElement) => element.value.length > 0)).toBe(
			true
		)
		await expect(confirmation).not.toBeChecked()
		await expect(complete).toBeDisabled()
		await phrase.click()
		await expect(dialog).toBeVisible()
		if (dismissal === 'complete') {
			await confirmation.check()
			await complete.click()
		} else if (dismissal === 'escape') {
			await confirmation.check()
			await page.keyboard.press('Escape')
		} else if (dismissal === 'backdrop') {
			await page.mouse.click(1, 1)
		} else {
			await page.getByRole('button', { name: 'Close', exact: true }).click()
		}
		await expect(dialog).not.toBeVisible()
		await expect(phrase).toHaveCount(0)
		await expect(show).toBeFocused()
	}
})

async function saveDisplayName(page: Page, name: string) {
	await page.goto('/account')
	await expect(page.getByLabel('Display name', { exact: true })).toBeEnabled()
	await page.getByLabel('Display name', { exact: true }).fill(name)
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('status').filter({ hasText: 'Profile Display name saved.' })
	).toHaveCount(1)
}

test('profile name trims, survives reload, and can be cleared', async ({ page }) => {
	await saveDisplayName(page, '  Profile owner  ')
	await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Profile owner')
	await page.reload()
	await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Profile owner')
	await page.getByLabel('Display name', { exact: true }).fill('  ')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('status').filter({ hasText: 'Profile Display name saved.' })
	).toHaveCount(1)
	await page.reload()
	await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('')
})

test('profile name follows the recovered identity across devices', async ({
	page,
	browser,
	baseURL
}) => {
	await saveDisplayName(page, 'Recovered owner')
	// Confirm synchronization without including recovery secrets in output.
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const schemaPath = '/src/lib/schema.ts'
				const sessionPath = '/src/lib/jazz-session.ts'
				const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
				const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
					sessionPath
				)
				const snapshot = getCurrentJazzSession()?.getSnapshot()
				if (!snapshot?.client || !snapshot.account) throw new Error('Session not ready')
				return (
					await snapshot.client.db.one(app.profiles.where({ userId: snapshot.account.id }), {
						tier: 'remote'
					})
				)?.displayName
			})
		)
		.toBe('Recovered owner')
	await page.getByRole('button', { name: 'Show recovery phrase' }).click()
	const phrase = await page.getByLabel('Your recovery phrase').inputValue()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
	try {
		const other = await context.newPage()
		await saveDisplayName(other, 'Previous identity')
		await restoreAccount(other, phrase)
		await other.goto('/account')
		await expect(other.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
		await other.reload()
		await expect(other.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
		await page.reload()
		await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
	} finally {
		await context.close()
	}
})

async function avatarRecord(page: Page, remote = false) {
	return page.evaluate(async (remote) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Session not ready')
		const profile = await snapshot.client.db.one(
			app.profiles.where({ userId: snapshot.account.id }),
			remote ? { tier: 'remote' } : {}
		)
		if (!profile) throw new Error('Profile not ready')
		const bytes = profile.avatarData
		return {
			id: profile.id,
			userId: profile.userId,
			displayName: profile.displayName ?? null,
			mimeType: profile.avatarMimeType ?? null,
			byteLength: bytes?.byteLength ?? 0,
			checksum: bytes
				? Array.from(
						new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
					).join(',')
				: null
		}
	}, remote)
}

async function avatarImage(page: Page, width: number, height: number, noisy = false) {
	const bytes = await page.evaluate(
		async ({ width, height, noisy }) => {
			const canvas = new OffscreenCanvas(width, height)
			const context = canvas.getContext('2d')
			if (!context) throw new Error('Canvas unavailable')
			if (noisy) {
				const image = context.createImageData(width, height)
				for (let offset = 0; offset < image.data.length; offset += 65536)
					crypto.getRandomValues(image.data.subarray(offset, offset + 65536))
				for (let index = 3; index < image.data.length; index += 4) image.data[index] = 255
				context.putImageData(image, 0, 0)
			} else {
				context.fillStyle = '#318060'
				context.fillRect(0, 0, width, height)
			}
			const blob = await canvas.convertToBlob({ type: 'image/png' })
			return Array.from(new Uint8Array(await blob.arrayBuffer()))
		},
		{ width, height, noisy }
	)
	return { name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(bytes) }
}

async function waitForAvatar(page: Page, width: number, height: number) {
	const image = page
		.getByRole('group')
		.filter({ has: page.getByLabel('Avatar', { exact: true }) })
		.locator('img')
	await expect(image).toBeVisible()
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])
		)
		.toEqual([width, height])
	return image
}

async function uploadAvatar(
	page: Page,
	image: Awaited<ReturnType<typeof avatarImage>>,
	replace = false
) {
	await page.getByLabel('Avatar', { exact: true }).setInputFiles(image)
	await page.getByRole('button', { name: 'Save Avatar', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('status').filter({ hasText: 'Profile Avatar saved.' })
	).toHaveCount(1)
}

test('avatar upload above 256 KB resizes, replaces, removes, and persists without changing the name', async ({
	page
}) => {
	test.setTimeout(120_000)
	await page.addInitScript(() => {
		const revoke = URL.revokeObjectURL.bind(URL)
		window.avatarRevokedUrls = []
		URL.revokeObjectURL = (url) => {
			window.avatarRevokedUrls.push(url)
			revoke(url)
		}
	})
	await saveDisplayName(page, 'Avatar owner')
	const large = await avatarImage(page, 512, 256, true)
	expect(large.buffer.byteLength).toBeGreaterThan(256 * 1024)
	await uploadAvatar(page, large)
	const firstImage = await waitForAvatar(page, 256, 128)
	const firstUrl = await firstImage.getAttribute('src')
	const first = await avatarRecord(page)
	expect(first.mimeType).toBe('image/webp')
	expect(first.byteLength).toBeGreaterThan(0)
	expect(first.byteLength).toBeLessThanOrEqual(256 * 1024)
	expect(first.displayName).toBe('Avatar owner')
	await page.reload()
	await waitForAvatar(page, 256, 128)
	expect(await avatarRecord(page)).toEqual(first)
	const reloadedUrl = await page
		.getByRole('group')
		.filter({ has: page.getByLabel('Avatar', { exact: true }) })
		.locator('img')
		.getAttribute('src')
	await uploadAvatar(page, await avatarImage(page, 120, 240), true)
	await waitForAvatar(page, 120, 240)
	await expect
		.poll(() =>
			page.evaluate((url) => url !== null && window.avatarRevokedUrls.includes(url), reloadedUrl)
		)
		.toBe(true)
	const replacement = await avatarRecord(page)
	expect(replacement.checksum).not.toBe(first.checksum)
	expect(replacement.id).toBe(first.id)
	expect(replacement.displayName).toBe(first.displayName)
	const replacementUrl = await page
		.getByRole('group')
		.filter({ has: page.getByLabel('Avatar', { exact: true }) })
		.locator('img')
		.getAttribute('src')
	await page.getByRole('button', { name: 'Remove avatar', exact: true }).click()
	await expect(
		page
			.getByRole('group')
			.filter({ has: page.getByLabel('Avatar', { exact: true }) })
			.locator('img')
	).toHaveCount(0)
	await expect
		.poll(() =>
			page.evaluate((url) => url !== null && window.avatarRevokedUrls.includes(url), replacementUrl)
		)
		.toBe(true)
	await page.reload()
	await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
	await expect(page.getByRole('button', { name: 'Save Avatar', exact: true })).toHaveCount(0)
	const removed = await avatarRecord(page)
	expect(removed).toEqual({ ...first, byteLength: 0, mimeType: null, checksum: null })
	expect(firstUrl).toMatch(/^blob:/)
})

test('avatar rejects invalid, oversized, and undecodable images and allows retry', async ({
	page
}) => {
	test.setTimeout(120_000)
	await page.goto('/account')
	await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
	const initial = await avatarRecord(page)
	for (const file of [
		{ name: 'avatar.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
		{ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
		{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }
	]) {
		await page.getByLabel('Avatar', { exact: true }).setInputFiles(file)
		await page.getByRole('button', { name: 'Save Avatar', exact: true }).click()
		await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
			file.name === 'broken.png'
				? 'Could not save Profile. Please try again.'
				: 'Choose a valid PNG, JPEG, or WebP image up to 10 MB.'
		)
		expect(await avatarRecord(page)).toEqual(initial)
	}
	await uploadAvatar(page, await avatarImage(page, 80, 40))
	await waitForAvatar(page, 80, 40)
	await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0)
})

test('avatar can upload, replace, and remove while offline', async ({ page }) => {
	test.setTimeout(120_000)
	await page.goto('/account')
	await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
	const first = await avatarImage(page, 400, 200)
	const second = await avatarImage(page, 100, 100)
	await page.context().setOffline(true)
	try {
		await uploadAvatar(page, first)
		await waitForAvatar(page, 256, 128)
		await uploadAvatar(page, second, true)
		await waitForAvatar(page, 100, 100)
		const local = await avatarRecord(page)
		expect(local.byteLength).toBeGreaterThan(0)
		await page.getByRole('button', { name: 'Remove avatar', exact: true }).click()
		await expect(
			page
				.getByRole('group')
				.filter({ has: page.getByLabel('Avatar', { exact: true }) })
				.locator('img')
		).toHaveCount(0)
		expect((await avatarRecord(page)).byteLength).toBe(0)
	} finally {
		await page.context().setOffline(false)
	}
	await expect.poll(async () => (await avatarRecord(page, true)).byteLength).toBe(0)
	await page.reload()
	await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
	await expect(page.getByRole('button', { name: 'Save Avatar', exact: true })).toHaveCount(0)
})

test('avatar follows account recovery on another device', async ({ page, browser, baseURL }) => {
	test.setTimeout(120_000)
	await saveDisplayName(page, 'Recovered avatar owner')
	await uploadAvatar(page, await avatarImage(page, 300, 600))
	await waitForAvatar(page, 128, 256)
	const original = await avatarRecord(page)
	await expect.poll(() => avatarRecord(page, true)).toEqual(original)
	await page.getByRole('button', { name: 'Show recovery phrase' }).click()
	const phrase = await page.getByLabel('Your recovery phrase').inputValue()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
	try {
		const other = await context.newPage()
		await restoreAccount(other, phrase)
		await other.goto('/account')
		await waitForAvatar(other, 128, 256)
		await expect(other.getByLabel('Display name', { exact: true })).toHaveValue(
			'Recovered avatar owner'
		)
		expect(await avatarRecord(other)).toEqual(original)
		await other.reload()
		await waitForAvatar(other, 128, 256)
	} finally {
		await context.close()
	}
})

declare global {
	interface Window {
		avatarRevokedUrls: string[]
	}
}

declare global {
	interface Window {
		authFailureTest: {
			shutdownAttempts: number
			storageFailures: number
			releaseSharedClient?: () => Promise<void>
		}
	}
}

async function currentIdentity(page: Page) {
	return page.evaluate(async () => {
		const sessionPath = '/src/lib/jazz-session.ts'
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		return getCurrentJazzSession()?.getSnapshot().account?.id
	})
}

test('startup network failures can retry repeatedly without replacing the saved identity', async ({
	page,
	context
}) => {
	await createAccount(page, 'Network retained checking')
	const identity = await currentIdentity(page)
	expect(identity).toBeTruthy()
	let blocked = 0
	let failing = true
	await context.route(/\.wasm(?:\?|$)/, async (route) => {
		if (failing) {
			blocked += 1
			await route.abort('internetdisconnected')
		} else await route.continue()
	})
	await page.reload()
	const retry = page.getByRole('button', { name: 'Try again', exact: true })
	await expect(retry).toBeVisible()
	await expect(page.getByRole('alert')).toHaveText('Your finances could not be opened. Try again.')
	expect(blocked).toBeGreaterThan(0)
	await retry.click()
	await expect(retry).toBeVisible()
	failing = false
	await retry.click()
	await expect(page.getByRole('button', { name: 'Toggle navigation', exact: true })).toBeVisible()
	expect(await currentIdentity(page)).toBe(identity)
	await page.goto('/accounts')
	await expect(
		page.getByRole('cell', { name: 'Network retained checking', exact: true })
	).toBeVisible()
})

test('restore session failures retain identity and retry without exposing the recovery phrase', async ({
	page
}) => {
	await createAccount(page, 'Session retained checking')
	const identity = await currentIdentity(page)
	await page.goto('/account')
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	const messages: string[] = []
	const urls: string[] = []
	page.on('console', (message) => messages.push(message.text()))
	page.on('pageerror', (error) => messages.push(error.message))
	page.on('request', (request) => urls.push(request.url()))
	await page.goto('/login')
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.evaluate(async () => {
		const sessionPath = '/src/lib/jazz-session.ts'
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const client = getCurrentJazzSession()?.getSnapshot().client
		if (!client) throw new Error('Test session is not ready.')
		window.authFailureTest = { shutdownAttempts: 0, storageFailures: 0 }
		const shutdown = client.shutdown.bind(client)
		client.shutdown = async (options) => {
			window.authFailureTest.shutdownAttempts += 1
			if (window.authFailureTest.shutdownAttempts <= 2)
				throw new Error('Private simulated shutdown failure')
			return shutdown(options)
		}
	})
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	const retry = page.getByRole('button', { name: 'Try again', exact: true })
	await expect(retry).toBeVisible()
	await expect(page.getByRole('alert')).toHaveText('Your finances could not be opened. Try again.')
	expect(await currentIdentity(page)).toBe(identity)
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveCount(0)
	await retry.click()
	await expect.poll(() => page.evaluate(() => window.authFailureTest.shutdownAttempts)).toBe(2)
	await expect(retry).toBeVisible()
	await retry.click()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
	expect(await currentIdentity(page)).toBe(identity)
	expect(await page.getByLabel('Recovery phrase', { exact: true }).inputValue()).toBe('')
	await expect(page.getByRole('alert')).toHaveCount(0)
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	await expect(page).toHaveURL('/')
	expect(await currentIdentity(page)).toBe(identity)
	await page.goto('/accounts')
	await expect(
		page.getByRole('cell', { name: 'Session retained checking', exact: true })
	).toBeVisible()
	for (const value of [...messages, ...urls]) {
		expect(value.includes(phrase), 'Recovery phrase must not appear in diagnostics or URLs').toBe(
			false
		)
		expect(
			value.includes(encodeURIComponent(phrase)),
			'Encoded phrase must not appear in URLs'
		).toBe(false)
		expect(
			value.includes('Private simulated shutdown failure'),
			'Raw SDK failures must not be rendered or logged'
		).toBe(false)
	}
})

test('session retry completes a selected identity after local selection storage fails', async ({
	page
}) => {
	await createAccount(page, 'Previous selection checking')
	const previous = await currentIdentity(page)
	const phrase = RecoveryPhrase.fromSecret(generateAuthSecret())
	await page.goto('/login')
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.evaluate(() => {
		window.authFailureTest = { shutdownAttempts: 0, storageFailures: 0 }
		const setItem = Storage.prototype.setItem
		Storage.prototype.setItem = function (key, value) {
			if (key.startsWith('jazz-account-selection-v1:')) {
				Storage.prototype.setItem = setItem
				window.authFailureTest.storageFailures += 1
				throw new DOMException('Simulated local selection failure', 'QuotaExceededError')
			}
			return setItem.call(this, key, value)
		}
	})
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	const retry = page.getByRole('button', { name: 'Try again', exact: true })
	await expect(retry).toBeVisible()
	expect(await page.evaluate(() => window.authFailureTest.storageFailures)).toBe(1)
	const selected = await currentIdentity(page)
	expect(selected).toBeTruthy()
	expect(selected).not.toBe(previous)
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveCount(0)
	await retry.click()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
	expect(await currentIdentity(page)).toBe(selected)
	expect(await page.getByLabel('Recovery phrase', { exact: true }).inputValue()).toBe('')
	await page.reload()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
	expect(await currentIdentity(page)).toBe(selected)
	await page.goto('/accounts')
	await expect(
		page.getByRole('cell', { name: 'Previous selection checking', exact: true })
	).toHaveCount(0)
})

test('recoverable restore failure keeps the original client and generic feedback after remount', async ({
	page
}) => {
	await createAccount(page, 'Recoverable checking')
	const identity = await currentIdentity(page)
	await page.goto('/account')
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	await page.goto('/login')
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
	await page.evaluate(async () => {
		const sessionPath = '/src/lib/jazz-session.ts'
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Test session is not ready.')
		// Use the same public SDK module URL as the application to share its client registry.
		const moduleSource = await (await fetch(sessionPath)).text()
		const sdkPath = moduleSource.match(/from\s*['"]([^'"]*jazz-tools[^'"]*)['"]/)?.[1]
		if (!sdkPath) throw new Error('Could not find the application SDK module.')
		const { createJazzClient }: typeof import('jazz-tools/svelte') = await import(sdkPath)
		const config = snapshot.client.db.getConfig()
		if (!config.serverUrl) throw new Error('Test database URL is missing.')
		const holder = await createJazzClient({
			appId: config.appId,
			serverUrl: config.serverUrl,
			account: snapshot.account
		})
		window.authFailureTest = {
			shutdownAttempts: 0,
			storageFailures: 0,
			releaseSharedClient: () => holder.shutdown()
		}
	})
	try {
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		await expect(page.getByRole('alert')).toHaveText(
			'The account could not be restored. Please try again.'
		)
		expect(await currentIdentity(page)).toBe(identity)
		expect(await page.getByLabel('Recovery phrase', { exact: true }).inputValue()).toBe('')
		await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled()
	} finally {
		await page.evaluate(async () => {
			await window.authFailureTest.releaseSharedClient?.()
		})
	}
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	await expect(page).toHaveURL('/')
	expect(await currentIdentity(page)).toBe(identity)
	await page.goto('/accounts')
	await expect(page.getByRole('cell', { name: 'Recoverable checking', exact: true })).toBeVisible()
})
