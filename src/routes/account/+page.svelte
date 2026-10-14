<script lang="ts">
	import { get, fromStore } from 'svelte/store'
	import { RecoveryPhrase } from 'jazz-tools/passphrase'
	import { getDb, getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { exportLocalFirstSecret } from 'jazz-tools'
	import { m } from '#lib/paraglide/messages.js'
	import type { z } from 'zod'
	import { app } from '#lib/schema.js'
	import { saveProfileName, saveProfileAvatar } from '#lib/data.js'
	import { profileNameFormSchema, profileAvatarFormSchema } from '#lib/validation/identity.js'
	import { createFormController } from '#lib/forms.svelte.js'
	import type { FormSave } from '#lib/machines/form.js'
	import ProfileAvatarForm from '#lib/components/ProfileAvatarForm.svelte'
	import ProfileNameForm from '#lib/components/ProfileNameForm.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import AccountRecovery from '#lib/components/AccountRecovery.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const session = getJazzSession()
	const currentSession = fromStore(session)
	const db = getDb()
	const userId = $derived(currentSession.current.account?.id ?? null)
	const profileQuery = new QuerySubscriptionOne(() =>
		userId ? app.profiles.where({ userId }) : undefined
	)
	const profile = $derived(profileQuery.current)
	function requireOwnProfile(context: { profileId: string | null; userId: string | null }) {
		if (
			!context.userId ||
			!context.profileId ||
			context.userId !== userId ||
			profile?.id !== context.profileId ||
			profile.userId !== context.userId
		)
			throw new Error('The profile identity changed before saving.')
		return { profileId: context.profileId, userId: context.userId }
	}
	const saveName: FormSave<
		z.output<typeof profileNameFormSchema>,
		void,
		{ profileId: string | null; userId: string | null }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		const owner = requireOwnProfile(context)
		await saveProfileName(db, owner.profileId, owner.userId, values.displayName)
	}
	const form = createFormController({
		schema: profileNameFormSchema,
		save: saveName,
		context: () => ({ profileId: profile?.id ?? null, userId }),
		key: () => `${userId}:${profile?.id ?? ''}`,
		disabled: () => !profile || profile.userId !== userId
	})
	const saveAvatar: FormSave<
		z.output<typeof profileAvatarFormSchema>,
		void,
		{ profileId: string | null; userId: string | null }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		const owner = requireOwnProfile(context)
		await saveProfileAvatar(db, owner.profileId, owner.userId, values)
	}
	const avatarForm = createFormController({
		schema: profileAvatarFormSchema,
		save: saveAvatar,
		context: () => ({ profileId: profile?.id ?? null, userId }),
		key: () => `${userId}:${profile?.id ?? ''}`,
		disabled: () => !profile || profile.userId !== userId
	})
	function removeAvatar() {
		avatarForm.submitValues({ action: 'remove' })
	}

	let phrase = $state('')
	let revealed = $state(false)
	let savedConfirmed = $state(false)
	let loadError = $state(false)

	function revealPhrase() {
		const account = get(session).account
		if (!account) {
			loadError = true
			return
		}

		try {
			phrase = RecoveryPhrase.fromSecret(exportLocalFirstSecret(account))
			revealed = true
			loadError = false
		} catch {
			loadError = true
		}
	}

	function hidePhrase() {
		phrase = ''
		revealed = false
		savedConfirmed = false
	}
	function confirmSaved(value: boolean) {
		savedConfirmed = value
	}
</script>

<svelte:head><title>{m['recovery.heading']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['recovery.heading']()} />
<AccountRecovery
	{phrase}
	{revealed}
	{savedConfirmed}
	{loadError}
	onReveal={revealPhrase}
	onHide={hidePhrase}
	onConfirm={confirmSaved}
/>

<QueryContent
	queries={[profileQuery]}
	loadingMessage={m['status.loading']({ subject: m['labels.profile']() })}
	errorMessage={m['errors.load']({ subject: m['labels.profile']() })}
>
	{#if profile}
		<ProfileNameForm profileId={profile.id} displayName={profile.displayName} {form} />
		<ProfileAvatarForm
			profileId={profile.id}
			avatarData={profile.avatarData}
			mimeType={profile.avatarMimeType}
			form={avatarForm}
			onRemove={removeAvatar}
		/>
	{/if}
</QueryContent>
