import { createActor } from 'xstate'
import { imageProcessingMachine } from '../../src/lib/machines/images/image-processing.js'
self.addEventListener('message', (event: MessageEvent<unknown>) => {
	if (!(event.data instanceof File)) return
	const actor = createActor(imageProcessingMachine, {
		input: {
			file: event.data,
			options: { maxWidth: 2048, maxHeight: 2048, mimeType: 'image/png' }
		},
		inspect: (event) => {
			if (event.type !== '@xstate.transition') return
			self.postMessage({
				type: 'PHASE',
				actor: event.actorRef.sessionId,
				state:
					event.snapshot.status === 'error'
						? 'error'
						: 'value' in event.snapshot
							? event.snapshot.value
							: event.snapshot.status,
				...('error' in event.event && event.event.error instanceof Error
					? { failure: { name: event.event.error.name, message: event.event.error.message } }
					: {})
			})
		}
	})
	actor.subscribe({
		next: (snapshot) => {
			if (snapshot.status !== 'done') return
			const output = snapshot.output
			self.postMessage({
				type: 'DONE',
				outcome: output.outcome,
				...(output.outcome === 'processed'
					? { dimensions: output.dimensions, byteLength: output.bytes.byteLength }
					: {})
			})
			self.close()
		},
		error: () => {
			self.postMessage({ type: 'DONE', outcome: 'crashed' })
			self.close()
		}
	})
	actor.start()
})
