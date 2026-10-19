import { m } from './paraglide/messages.js'
/** Presentation-only localization shared by the domain form views. */
export const formReasonText = {
	sessionUnavailable: () => m['forms.session_unavailable'](),
	selectWorkspace: () => m['workspace.select_workspace'](),
	loading: () => m['forms.loading'](),
	loadFailed: () => m['forms.load_failed'](),
	readOnly: () => m['forms.read_only'](),
	unavailableReference: () => m['forms.unavailable_reference'](),
	ambiguousTagName: () => m['tags.ambiguous_name'](),
	duplicateName: () => m['forms.duplicate_name'](),
	protectedRecord: () => m['forms.protected_record'](),
	profileUnavailable: () => m['forms.profile_unavailable'](),
	noAccounts: () => m['transactions.no_accounts'](),
	noCategories: () => m['forms.no_categories']()
}
