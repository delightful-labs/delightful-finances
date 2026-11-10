// Vite supplies the same public flags to Window and worker module graphs.
// SvelteKit's page-initialized $app/env module cannot execute in a worker.
export const PUBLIC_DEBUG: string | undefined = import.meta.env.PUBLIC_DEBUG
export const PUBLIC_FAKE_DATA: string | undefined = import.meta.env.PUBLIC_FAKE_DATA
export const PUBLIC_SIMPLEFIN_DEMO: string | undefined = import.meta.env.PUBLIC_SIMPLEFIN_DEMO
