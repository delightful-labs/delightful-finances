import { z } from 'zod'
import { currencyText } from './transactions.js'

export const appAccountSchema = z.strictObject({
	organizationId: z.uuid(),
	name: z.string().trim().min(1),
	kind: z.enum(['cash', 'bank', 'card']),
	currency: currencyText.default('USD'),
	archivedAt: z.date().nullable().default(null)
})

export const accountFormSchema = appAccountSchema.pick({ name: true, kind: true }).strip()

export const accountArchiveSchema = appAccountSchema
	.pick({ organizationId: true })
	.extend({ accountId: z.uuid() })
