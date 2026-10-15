import { describe, expect, it, vi } from 'vitest'
import { resizeAvatar } from '../domain/avatar.js'
import {
	appProfileSchema,
	profileNameFormSchema,
	workspaceNameFormSchema,
	profileAvatarFormSchema,
	profileAvatarValuesSchema,
	MAX_AVATAR_BYTES,
	MAX_AVATAR_UPLOAD_BYTES
} from './identity.js'

describe('workspace name validation', () => {
	it('trims the submitted name', () => {
		expect(workspaceNameFormSchema.parse({ name: '  Household  ' })).toEqual({ name: 'Household' })
	})
	it.each(['', ' ', '\t\n', undefined, null, 123])('rejects invalid names %j', (name) => {
		expect(workspaceNameFormSchema.safeParse({ name }).success).toBe(false)
	})
	it('strips fields outside the name form', () => {
		expect(workspaceNameFormSchema.parse({ name: 'Household', ownerId: 'other' })).toEqual({
			name: 'Household'
		})
	})
})

describe('profile name validation', () => {
	const userId = '11111111-1111-4111-8111-111111111111'
	it('trims names in the canonical schema and form', () => {
		expect(appProfileSchema.parse({ userId, displayName: '  Matthew  ' })).toEqual({
			userId,
			displayName: 'Matthew'
		})
		expect(profileNameFormSchema.parse({ displayName: '  Matthew  ' })).toEqual({
			displayName: 'Matthew'
		})
	})
	it.each(['', ' ', '\t\n'])('clears a blank submitted name %j', (displayName) => {
		expect(profileNameFormSchema.parse({ displayName })).toEqual({ displayName: null })
	})
	it('allows missing or cleared canonical names for identity fallbacks', () => {
		expect(appProfileSchema.parse({ userId })).toEqual({ userId })
		expect(appProfileSchema.parse({ userId, displayName: null })).toEqual({
			userId,
			displayName: null
		})
	})
	it.each([undefined, null, 123, {}, ['Matthew']])(
		'rejects non-text form values %j',
		(displayName) => {
			expect(profileNameFormSchema.safeParse({ displayName }).success).toBe(false)
		}
	)
	it('strips submitted identity and profile ID fields', () => {
		expect(
			profileNameFormSchema.parse({ displayName: 'Matthew', userId: 'other', id: 'other' })
		).toEqual({ displayName: 'Matthew' })
	})
	it('rejects invalid canonical identity and blank canonical names', () => {
		expect(appProfileSchema.safeParse({ userId: 'invalid', displayName: 'Matthew' }).success).toBe(
			false
		)
		expect(appProfileSchema.safeParse({ userId, displayName: ' ' }).success).toBe(false)
	})
})

vi.mock('../domain/avatar.js', () => ({ resizeAvatar: vi.fn() }))

describe('profile avatar validation', () => {
	const avatar = { avatarData: new Uint8Array([1, 2, 3]), avatarMimeType: 'image/webp' }
	it('accepts complete avatar values or complete removal', () => {
		expect(profileAvatarValuesSchema.parse(avatar)).toEqual(avatar)
		expect(profileAvatarValuesSchema.parse({ avatarData: null, avatarMimeType: null })).toEqual({
			avatarData: null,
			avatarMimeType: null
		})
	})
	it.each([
		{ avatarData: null, avatarMimeType: 'image/png' },
		{ avatarData: new Uint8Array([1]), avatarMimeType: null },
		{ avatarData: new Uint8Array(), avatarMimeType: 'image/png' },
		{ avatarData: new Uint8Array(MAX_AVATAR_BYTES + 1), avatarMimeType: 'image/png' },
		{ avatarData: new Uint8Array([1]), avatarMimeType: 'image/svg+xml' },
		{ avatarData: [1, 2], avatarMimeType: 'image/png' },
		{}
	])('rejects inconsistent or invalid stored avatar values %#', (values) => {
		expect(profileAvatarValuesSchema.safeParse(values).success).toBe(false)
	})
	it('processes uploads above 256 KB and persists the encoder output', async () => {
		const file = new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], 'photo.png', {
			type: 'image/png'
		})
		vi.mocked(resizeAvatar).mockResolvedValueOnce(
			new Blob([avatar.avatarData], { type: 'image/webp' })
		)
		await expect(
			profileAvatarFormSchema.parseAsync({ action: 'upload', file, userId: 'injected' })
		).resolves.toEqual(avatar)
		expect(resizeAvatar).toHaveBeenLastCalledWith(file)
	})
	it.each([
		new File([], 'empty.png', { type: 'image/png' }),
		new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }),
		new File([new Uint8Array(MAX_AVATAR_UPLOAD_BYTES + 1)], 'large.png', { type: 'image/png' })
	])('rejects invalid file input before processing %#', async (file) => {
		vi.mocked(resizeAvatar).mockClear()
		expect((await profileAvatarFormSchema.safeParseAsync({ action: 'upload', file })).success).toBe(
			false
		)
		expect(resizeAvatar).not.toHaveBeenCalled()
	})
	it('removes an avatar without decoding a file', async () => {
		vi.mocked(resizeAvatar).mockClear()
		await expect(profileAvatarFormSchema.parseAsync({ action: 'remove' })).resolves.toEqual({
			avatarData: null,
			avatarMimeType: null
		})
		expect(resizeAvatar).not.toHaveBeenCalled()
	})
	it('propagates a decoder failure and rejects oversized encoded results', async () => {
		const file = new File(['image'], 'photo.png', { type: 'image/png' })
		vi.mocked(resizeAvatar).mockRejectedValueOnce(new Error('Invalid image bytes'))
		await expect(profileAvatarFormSchema.parseAsync({ action: 'upload', file })).rejects.toThrow(
			'Invalid image bytes'
		)
		vi.mocked(resizeAvatar).mockResolvedValueOnce(
			new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type: 'image/png' })
		)
		expect((await profileAvatarFormSchema.safeParseAsync({ action: 'upload', file })).success).toBe(
			false
		)
	})
})
