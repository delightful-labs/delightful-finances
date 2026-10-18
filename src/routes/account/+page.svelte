<script lang="ts">
	import { observeRow } from '#lib/observations.js'
	import { fromStore } from 'svelte/store'
	import { getDb, getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { m } from '#lib/paraglide/messages.js'
	import type { z } from 'zod'
	import { app } from '#lib/schema.js'
	import { saveProfileName, saveProfileAvatar } from '#lib/data.js'
	import { profileNameFormSchema, profileAvatarFormSchema } from '#lib/validation/identity.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import { createProfileFormOptions } from '#lib/machines/profile.js'
	import type { ProfileObservation, ProfileReason, ProfileScope } from '#lib/profile-contract.js'
	import type { SnapshotFrom } from 'xstate'
	import ProfileAvatarForm from '#lib/components/ProfileAvatarForm.svelte'
	import ProfileNameForm from '#lib/components/ProfileNameForm.svelte'
	import RecoveryPhraseIntegration from '#lib/components/RecoveryPhraseIntegration.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const session = getJazzSession()
	const currentSession = fromStore(session)
	const db = getDb()
	const userId = $derived(currentSession.current.account?.id ?? null)
	const profileQuery = new QuerySubscriptionOne(() =>
		userId ? app.profiles.where({ userId }) : undefined
	)
	const profile = $derived(profileQuery.current)

	function observeProfile(): ProfileObservation {
		return {
			identityId: currentSession.current.account?.id ?? null,
			binding: currentSession.current.client?.db ?? null,
			sessionReady: currentSession.current.status === 'ready',
			loading: profileQuery.isLoading,
			failed: profileQuery.error != null,
			profile: observeRow(profileQuery.current)
		}
	}
	const options = createProfileFormOptions({
		binding: db,
		observe: observeProfile,
		saveName: (id, user, name) => saveProfileName(db, id, user, name),
		saveAvatar: (id, user, values) => saveProfileAvatar(db, id, user, values)
	})
	const form = createScopedFormController<
		z.output<typeof profileNameFormSchema>,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof options.name.availability>,
		SnapshotFrom<typeof options.name.operation>
	>(options.name)
	const avatarForm = createScopedFormController<
		z.output<typeof profileAvatarFormSchema>,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof options.avatar.availability>,
		SnapshotFrom<typeof options.avatar.operation>
	>(options.avatar)
	function removeAvatar() {
		avatarForm.submitValues({ action: 'remove' })
	}
</script>

<svelte:head><title>{m['navigation.account']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['navigation.account']()} />
<RecoveryPhraseIntegration />

<ProfileNameForm
	profileId={profile?.id ?? ''}
	displayName={profile?.displayName}
	view={form.view}
	onsubmit={form.submit}
	onreset={form.reset}
	oninput={form.input}
	onRetryReadiness={form.retryReadiness}
/>
<ProfileAvatarForm
	profileId={profile?.id ?? ''}
	avatarData={profile?.avatarData}
	mimeType={profile?.avatarMimeType}
	view={avatarForm.view}
	onsubmit={avatarForm.submit}
	onreset={avatarForm.reset}
	oninput={avatarForm.input}
	onRetryReadiness={avatarForm.retryReadiness}
	onRemove={removeAvatar}
	onSelectionChange={(file) => avatarForm.changeValues({ action: 'upload', file })}
/>
