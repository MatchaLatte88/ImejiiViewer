import models from '../../../shared/ai-models.json'

export const manifest = Object.freeze({
  id: 'ai-remove', version: '1.0.0', hostApi: 1,
  name: 'Object removal', label: 'AI Remove', icon: 'wand',
  description: 'Paint away distractions. Reconstruct the background locally with LaMa.',
  action: 'Remove an object', resultSuffix: 'removed', operation: 'object-removal',
  guidance: 'Paint the object and its shadow. Best for small distractions against textured backgrounds.',
  attribution: 'LaMa by Roman Suvorov and contributors. ONNX conversion by Carve.Photos.',
  capabilities: ['photo.snapshot', 'photo.variant', 'model.lama-v1'],
  model: Object.freeze(models['lama-v1']),
})
