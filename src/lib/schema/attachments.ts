import { schema as s } from 'jazz-tools'

export const attachmentsSchema = {
	transactionAttachments: s.table(
		{
			transactionId: s.uuid(),
			fileId: s.uuid()
		},
		{ transaction: s.rel('transactions', 'transactionId') }
	),
	files: s.table({ fileName: s.string(), mimeType: s.string(), sizeBytes: s.int() }, {}),
	fileParts: s.table({ fileId: s.uuid(), partIndex: s.int(), sizeBytes: s.int() }, {}),
	uploads: s.table({ fileId: s.uuid(), status: s.enum('pending', 'complete', 'failed') }, {})
}
