import { self } from '$app/service-worker'
import { version } from '$app/env'
import { assets, immutable, prerendered } from '$app/manifest'

const cachePrefix = 'delightful-finance-shell-'
const cacheName = `${cachePrefix}${version}`
const cachedPaths = new Set(
	[...immutable, ...assets, ...prerendered].map(
		({ path }) => new URL(path.replace(/^\//, ''), self.registration.scope).pathname
	)
)

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([...cachedPaths])))
})

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith(cachePrefix) && key !== cacheName)
						.map((key) => caches.delete(key))
				)
			)
	)
})

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url)
	// Only the build's public shell/assets are cached. Jazz and auth requests pass through.
	if (
		event.request.method !== 'GET' ||
		url.origin !== self.location.origin ||
		!cachedPaths.has(url.pathname)
	) {
		return
	}

	event.respondWith(
		caches.open(cacheName).then(async (cache) => {
			const cached = await cache.match(url.pathname)
			return cached ?? fetch(event.request)
		})
	)
})

// Keep the default waiting lifecycle: updates never force-reload an active form.
