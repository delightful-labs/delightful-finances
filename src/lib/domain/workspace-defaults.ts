import { m } from '../paraglide/messages.js'
import type { Category } from '../schema.js'

/** Edit the starter set here. Keep keys stable when changing translated labels. */
export function workspaceStarterCategories(): {
	key: string
	name: string
	kind: Category['kind']
	isSystem: boolean
}[] {
	return [
		{
			key: 'uncategorized',
			name: m['defaults.categories.uncategorized'](),
			kind: 'expense',
			isSystem: true
		},
		{
			key: 'uncategorized',
			name: m['defaults.categories.uncategorized'](),
			kind: 'income',
			isSystem: true
		},
		{
			key: 'groceries',
			name: m['defaults.categories.groceries'](),
			kind: 'expense',
			isSystem: false
		},
		{ key: 'housing', name: m['defaults.categories.housing'](), kind: 'expense', isSystem: false },
		{
			key: 'transport',
			name: m['defaults.categories.transport'](),
			kind: 'expense',
			isSystem: false
		},
		{
			key: 'other expense',
			name: m['defaults.categories.other_expense'](),
			kind: 'expense',
			isSystem: false
		},
		{ key: 'salary', name: m['defaults.categories.salary'](), kind: 'income', isSystem: false },
		{
			key: 'other income',
			name: m['defaults.categories.other_income'](),
			kind: 'income',
			isSystem: false
		}
	]
}
