import { manifest } from './ai-remove/manifest.js'
import { manifest as cutout } from './ai-cutout/manifest.js'
import { manifest as studio } from './sdxl-studio/manifest.js'

// Reviewed first-party bundles only. No dynamic URLs or downloaded JavaScript.
export const HOST_API_VERSION = 1
export function validatePlugin(entry) {
  const known = new Set(['photo.snapshot', 'photo.variant', 'photo.compose', 'photo.mask-handoff', 'photo.mask-export', 'model.lama-v1', 'model.birefnet-lite-v1', 'workspace.text-to-image', 'workspace.inpaint', 'workspace.outpaint'])
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(entry?.manifest?.id || '') || entry.manifest.hostApi !== HOST_API_VERSION ||
    !Array.isArray(entry.manifest.capabilities) || entry.manifest.capabilities.some(value => !known.has(value)) || typeof entry.load !== 'function') throw new Error('Incompatible plugin.')
  if (entry.manifest.workspace && (entry.manifest.workspace !== 'ai-studio' || !entry.manifest.capabilities.includes('workspace.inpaint') || typeof entry.loadWorkspace !== 'function')) throw new Error('Invalid plugin workspace.')
  return Object.freeze(entry)
}
export const plugins = Object.freeze([
  validatePlugin({ manifest, load: () => import('./ai-remove/RemovePanel.vue') }),
  validatePlugin({ manifest: cutout, load: () => import('./ai-cutout/CutoutPanel.vue') }),
  validatePlugin({ manifest: studio, load: () => import('./sdxl-studio/StudioPanel.vue'), loadWorkspace: () => import('./sdxl-studio/StudioWorkspace.vue') }),
])
