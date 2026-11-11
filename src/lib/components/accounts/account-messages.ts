import { m } from '#lib/paraglide/messages.js'
import type {
	AccountArchiveNotice,
	AccountGrantNotice
} from '#lib/contracts/account-presentation-contract.js'

export function archiveNoticeText(notice: AccountArchiveNotice) {
	const subject = m['nouns.account']({ count: 1 })
	if (notice.key === 'status.archived_subject_name')
		return m[notice.key]({ subject, name: notice.name })
	if (notice.key === 'errors.archive_subject') return m[notice.key]({ subject })
	return m[notice.key]()
}
export function grantNoticeText(notice: AccountGrantNotice) {
	return m[notice.key]()
}
