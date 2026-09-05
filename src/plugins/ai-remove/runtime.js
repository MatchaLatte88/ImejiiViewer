import { manifest } from './manifest.js'
import { createModelRuntime } from '../model-runtime.js'

export function createRemovalRuntime(options = {}) {
  return createModelRuntime({ modelId: manifest.model.id, jobName: 'Removal',
    workerFactory: () => new Worker(new URL('./inference.worker.js', import.meta.url), { type: 'module' }), ...options })
}
