<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { stopAfterShutdown } from '#lib/actor-lifecycle.js'
	import { createActor, type ActorRefFrom } from 'xstate'
	import {
		imageEditorMachine,
		imageEditorPresentation,
		type ImageEditorEvent
	} from '#lib/machines/image-editor.js'
	import type { ImageSelectionMode } from '#lib/domain/image-editor-geometry.js'
	import ImageEditorView from './ImageEditorView.svelte'

	// The consumer keys this component by file and owns the containing dialog.
	let {
		file,
		actor: providedActor,
		mode = 'perspective',
		oncomplete,
		oncancel
	}: {
		file: File
		actor?: ActorRefFrom<typeof imageEditorMachine>
		mode?: ImageSelectionMode
		oncomplete?: (file: File) => void
		oncancel?: () => void
	} = $props()
	const owner = untrack(() => providedActor === undefined)
	const actor = untrack(
		() => providedActor ?? createActor(imageEditorMachine, { input: { file, mode } })
	)
	let view = $state.raw(imageEditorPresentation(actor.getSnapshot()))

	function send(event: ImageEditorEvent) {
		if (actor.getSnapshot().status === 'active') actor.send(event)
		else if (event.type === 'CANCEL') oncancel?.()
	}
	onMount(() => {
		const subscription = actor.subscribe({
			next: (snapshot) => {
				view = imageEditorPresentation(snapshot)
				if (snapshot.status !== 'done') return
				if (snapshot.output.kind === 'applied') oncomplete?.(snapshot.output.file)
				else if (snapshot.output.kind !== 'failed') oncancel?.()
			},
			error: () => {
				view = imageEditorPresentation(actor.getSnapshot())
			}
		})
		if (owner) actor.start()
		return () => {
			subscription.unsubscribe()
			if (!owner) return
			stopAfterShutdown(actor)
		}
	})
</script>

<ImageEditorView {view} oncommand={send} />
