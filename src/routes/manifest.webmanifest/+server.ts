import { json } from '@sveltejs/kit'
import { m } from '#lib/paraglide/messages.js'
import { getLocale, getTextDirection } from '#lib/paraglide/runtime.js'

// Generate a public manifest at build time, retaining the existing offline URL.
export const prerender = true

export function GET() {
	return json(
		{
			id: '/',
			name: m['app.name'](),
			short_name: m['app.short_name'](),
			description: m['app.description'](),
			lang: getLocale(),
			dir: getTextDirection(getLocale()),
			start_url: '/',
			scope: '/',
			display: 'standalone',
			theme_color: '#f5f2ea',
			background_color: '#f5f2ea',
			icons: [{ src: '/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
		},
		{ headers: { 'Content-Type': 'application/manifest+json' } }
	)
}
