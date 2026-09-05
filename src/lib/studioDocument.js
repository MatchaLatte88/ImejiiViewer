// Versioned data only. Canvas objects, native paths and provider workflows never
// enter a saved document. Artifacts are separate SHA-256-addressed PNG blobs.
export const STUDIO_LIMIT = 384 * 1024 ** 2
export const ARTIFACT_LIMIT = 128 * 1024 ** 2
export const HASH = /^[a-f0-9]{64}$/
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
export const STUDIO_OPERATIONS = Object.freeze(['text-to-image', 'inpaint', 'outpaint'])
export const SDXL_SIZES = Object.freeze([[1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216], [1344, 768], [768, 1344], [1536, 640], [640, 1536]])
export const defaultParameters = () => ({ prompt: '', negative: '', seed: 0, steps: 25, cfg: 7, denoise: 1, model: 'sd_xl_base_1.0.safetensors', width: 1024, height: 1024,
  outpaint: { left: 256, right: 256, top: 0, bottom: 0, overlap: 64 } })
export function validateCheckpointName(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || /^[a-z]:/i.test(value) || /^[\\/]/.test(value) || !value.toLowerCase().endsWith('.safetensors')) throw new Error('Choose a safe SDXL .safetensors checkpoint from ComfyUI.')
  if (value.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Choose a safe SDXL .safetensors checkpoint from ComfyUI.')
  return value
}
export function normalizeParameters(p = {}) {
  const defaults = defaultParameters()
  return { ...defaults, ...p, outpaint: { ...defaults.outpaint, ...(p.outpaint || {}) } }
}
export function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 24000000 || Math.max(width, height) > 16384) throw new Error('Invalid Studio image dimensions (maximum 24 MP).')
}
export function validateParameters(p) {
  if (!p || typeof p.prompt !== 'string' || p.prompt.length > 4000 || typeof p.negative !== 'string' || p.negative.length > 4000 || !Number.isSafeInteger(p.seed) || p.seed < 0 || p.seed > 4294967295 || !Number.isInteger(p.steps) || p.steps < 1 || p.steps > 50 || !Number.isFinite(p.cfg) || p.cfg < 1 || p.cfg > 15 || !Number.isFinite(p.denoise) || p.denoise < .1 || p.denoise > 1) throw new Error('Invalid SDXL parameters. Use 1–50 steps, CFG 1–15 and strength 0.1–1.')
  validateCheckpointName(p.model)
  if (p.width !== undefined && !SDXL_SIZES.some(([width, height]) => p.width === width && p.height === height)) throw new Error('Unsupported SDXL output size.')
  if (p.outpaint !== undefined) {
    const keys = ['left', 'right', 'top', 'bottom']
    if (!p.outpaint || keys.some(key => !Number.isInteger(p.outpaint[key]) || p.outpaint[key] < 0 || p.outpaint[key] > 2048) || !Number.isInteger(p.outpaint.overlap) || p.outpaint.overlap < 0 || p.outpaint.overlap > 256) throw new Error('Invalid SDXL outpainting dimensions.')
  }
}
export function validateStrokes(strokes) {
  if (!Array.isArray(strokes) || strokes.length > 120) throw new Error('Too many mask strokes (maximum 120).')
  let points = 0
  for (const stroke of strokes) {
    if (!stroke || typeof stroke.erase !== 'boolean' || !Number.isFinite(stroke.size) || stroke.size < .001 || stroke.size > 1 || !Array.isArray(stroke.points) || !stroke.points.length) throw new Error('Invalid mask stroke.')
    points += stroke.points.length
    for (const point of stroke.points) if (!Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid mask coordinate.')
  }
  if (points > 24000) throw new Error('Mask limit reached (24,000 points).')
}
export function validateStudioDocument(doc) {
  if (JSON.stringify(doc).length > 2 * 1024 ** 2 || doc?.version !== 1 || !STUDIO_OPERATIONS.includes(doc.operation) || !uuid(doc.id) || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || typeof doc.name !== 'string' || !doc.name || doc.name.length > 255) throw new Error('Unsupported or damaged Studio document.')
  dimensions(doc.width, doc.height)
  const hasSource = HASH.test(doc.source || ''), hasMask = HASH.test(doc.mask || '')
  if (hasSource !== hasMask || doc.source && !hasSource || doc.mask && !hasMask) throw new Error('Damaged Studio source or mask.')
  validateParameters(doc.parameters); validateStrokes(doc.strokes); validateStrokes(doc.redo)
  if (!Array.isArray(doc.results) || doc.results.length > 8 || !Array.isArray(doc.jobs) || doc.jobs.length > 20) throw new Error('Studio history limit exceeded.')
  for (const result of doc.results) {
    const provenance = result.provenance
    if (!uuid(result.id) || !HASH.test(result.artifact || '') || !STUDIO_OPERATIONS.includes(provenance?.operation) || provenance.operation !== 'text-to-image' && !HASH.test(provenance.maskSha256 || '') || provenance.sourceSha256 && !HASH.test(provenance.sourceSha256)) throw new Error('Invalid Studio variant.')
    if (provenance.outputWidth !== undefined || provenance.outputHeight !== undefined) dimensions(provenance.outputWidth, provenance.outputHeight)
    validateParameters(result.provenance.parameters)
  }
  for (const job of doc.jobs) {
    if (!uuid(job.id) || !['queued', 'preparing', 'running', 'succeeded', 'failed', 'canceled', 'interrupted'].includes(job.state) || job.maskSha256 && !HASH.test(job.maskSha256)) throw new Error('Invalid Studio job.')
    if (job.parameters) validateParameters(job.parameters)
  }
  return doc
}
export function artifactIds(doc) { return [...new Set([doc.source, doc.mask, ...doc.results.flatMap(result => [result.artifact, result.provenance.maskSha256]), ...doc.jobs.map(job => job.maskSha256)].filter(Boolean))] }
export function interruptedDocument(doc) {
  validateStudioDocument(doc)
  const copy = structuredClone(doc)
  copy.parameters = normalizeParameters(copy.parameters)
  for (const result of copy.results) result.provenance.parameters = normalizeParameters(result.provenance.parameters)
  for (const job of copy.jobs) if (job.parameters) job.parameters = normalizeParameters(job.parameters)
  for (const job of copy.jobs) if (['queued', 'preparing', 'running'].includes(job.state)) { job.state = 'interrupted'; job.message = 'Interrupted when Imejii closed. The backend may still be working; this job will not resume.' }
  return copy
}
