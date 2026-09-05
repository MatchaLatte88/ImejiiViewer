// ComfyUI broker: fixed loopback origin, fixed routes and built-in node graphs.
// No shell, arbitrary workflow, file path, redirect, websocket or proxy API.
const http = require('node:http')
const { randomUUID, createHash } = require('node:crypto')
const { requestId } = require('./cutout.cjs')

const MODEL = 'sd_xl_base_1.0.safetensors'
const REFINER = 'sd_xl_refiner_1.0.safetensors'
const OPERATIONS = Object.freeze(['text-to-image', 'inpaint', 'outpaint'])
const STYLE_PRESETS = Object.freeze(['source-match', 'raw'])
const WORKFLOWS = Object.freeze({
  'text-to-image': 'imejii-sdxl-text-to-image-v3',
  inpaint: 'imejii-sdxl-masked-latent-v3',
  outpaint: 'imejii-sdxl-outpaint-v3',
})
const SDXL_SIZES = Object.freeze([[1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216], [1344, 768], [768, 1344], [1536, 640], [640, 1536]])
const NODE_INPUTS = {
  CheckpointLoaderSimple: ['ckpt_name'], CLIPTextEncode: ['text', 'clip'], EmptyLatentImage: ['width', 'height', 'batch_size'],
  LoadImage: ['image'], LoadImageMask: ['image', 'channel'], VAEEncodeForInpaint: ['pixels', 'vae', 'mask', 'grow_mask_by'],
  KSampler: ['model', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'denoise'],
  KSamplerAdvanced: ['model', 'add_noise', 'noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
  VAEDecode: ['samples', 'vae'], SaveImage: ['images', 'filename_prefix'],
}
const MAX_MODELS = 256

function operation(value) {
  if (!OPERATIONS.includes(value)) throw new Error('Unsupported SDXL operation.')
  return value
}
function checkpoint(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || /^[a-z]:/i.test(value) || /^[\\/]/.test(value) || !value.toLowerCase().endsWith('.safetensors')) throw new Error('Choose a safe SDXL .safetensors checkpoint from ComfyUI.')
  const parts = value.split(/[\\/]/)
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Choose a safe SDXL .safetensors checkpoint from ComfyUI.')
  return value
}
function modelList(values) {
  if (!Array.isArray(values)) return []
  const models = []
  for (const value of values) {
    try { models.push(checkpoint(value)) } catch { /* Ignore unsafe and unsupported checkpoint entries. */ }
    if (models.length >= MAX_MODELS) break
  }
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}
const validationKey = (model, refiner, selectedOperation) => JSON.stringify([model, refiner || '', selectedOperation])
const validationPairs = validated => [...validated].map(key => {
  const [model, refiner, operation] = JSON.parse(key)
  return { model, operation, ...(refiner ? { refiner } : {}) }
})
function size(width, height) {
  if (!SDXL_SIZES.some(([w, h]) => width === w && height === h)) throw new Error('Choose a supported SDXL output size.')
  return { width, height }
}
function parameters(p, selectedOperation = 'inpaint', allowedModels = [MODEL]) {
  selectedOperation = operation(selectedOperation)
  if (!p || typeof p.prompt !== 'string' || !p.prompt.trim() || p.prompt.length > 4000 || typeof p.negative !== 'string' || p.negative.length > 4000 || !Number.isSafeInteger(p.seed) || p.seed < 0 || p.seed > 4294967295 || p.randomizeSeed !== undefined && typeof p.randomizeSeed !== 'boolean' || p.stylePreset !== undefined && !STYLE_PRESETS.includes(p.stylePreset) || p.refinerEnabled !== undefined && typeof p.refinerEnabled !== 'boolean' || !Number.isInteger(p.steps) || p.steps < 1 || p.steps > 50 || !Number.isFinite(p.cfg) || p.cfg < 1 || p.cfg > 15 || p.denoise !== 1) throw new Error('Invalid SDXL parameters. This workflow requires full denoising.')
  const model = checkpoint(p.model)
  if (!Array.isArray(allowedModels) || !allowedModels.includes(model)) throw new Error('Choose a checkpoint reported by this ComfyUI connection.')
  let refiner = ''
  if (p.refinerEnabled !== false) refiner = p.refiner ? checkpoint(p.refiner) : allowedModels.includes(REFINER) ? REFINER : ''
  if (refiner && (!allowedModels.includes(refiner) || refiner === model || p.steps < 2)) throw new Error('Choose a separate SDXL refiner reported by this ComfyUI connection and use at least two steps.')
  const result = { prompt: p.prompt, negative: p.negative, stylePreset: p.stylePreset || 'source-match', model, refiner, refinerEnabled: Boolean(refiner), seed: p.seed, steps: p.steps, cfg: p.cfg, denoise: p.denoise }
  if (selectedOperation === 'text-to-image') Object.assign(result, size(p.width, p.height))
  return result
}
function conditionPrompts(p, selectedOperation = 'inpaint') {
  selectedOperation = operation(selectedOperation)
  if (p.stylePreset === 'raw') return { prompt: p.prompt, negative: p.negative, preset: 'raw' }
  const positive = selectedOperation === 'text-to-image'
    ? 'coherent composition, accurate perspective, physically plausible lighting, highly detailed, sharp focus, polished image'
    : 'seamlessly integrated into the existing scene, coherent scale and perspective, matching ambient lighting and color, physically plausible shadows and reflections, detailed, clean natural edges'
  const negative = 'low quality, blurry, distorted geometry, malformed object, duplicate object, pasted-on appearance, halo, hard border, frame, vignette, text, watermark'
  return { prompt: p.prompt + ', ' + positive, negative: [p.negative.trim(), negative].filter(Boolean).join(', '), preset: 'source-match' }
}
function png(value, width = 1024, height = 1024) {
  if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) throw new Error('Expected a PNG buffer.')
  const b = value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (b.length < 33 || b.length > 8 * 1024 ** 2 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || b.toString('ascii', 12, 16) !== 'IHDR' || b.readUInt32BE(16) !== width || b.readUInt32BE(20) !== height || b[24] !== 8 || ![2, 6].includes(b[25])) throw new Error('Expected a bounded ' + width + ' × ' + height + ' PNG.')
  return b
}
function workflow(selectedOperation, p, image, mask, prefix) {
  selectedOperation = operation(selectedOperation)
  const conditioned = conditionPrompts(p, selectedOperation)
  const graph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.model } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: conditioned.prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: conditioned.negative, clip: ['1', 1] } },
    '7': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], seed: p.seed, steps: p.steps, cfg: p.cfg, denoise: p.denoise, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras' } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  }
  if (selectedOperation === 'text-to-image') {
    graph['6'] = { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } }
  } else {
    if (typeof image !== 'string' || typeof mask !== 'string') throw new Error('SDXL image operations require owned image and mask uploads.')
    graph['4'] = { class_type: 'LoadImage', inputs: { image } }
    graph['5'] = { class_type: 'LoadImageMask', inputs: { image: mask, channel: 'red' } }
    graph['6'] = { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['4', 0], vae: ['1', 2], mask: ['5', 0], grow_mask_by: 6 } }
  }
  graph['7'].inputs.latent_image = ['6', 0]
  if (p.refiner) {
    const split = Math.max(1, Math.min(p.steps - 1, Math.round(p.steps * .8)))
    graph['7'] = { class_type: 'KSamplerAdvanced', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['6', 0], add_noise: 'enable', noise_seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', start_at_step: 0, end_at_step: split, return_with_leftover_noise: 'enable' } }
    graph['10'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.refiner } }
    graph['11'] = { class_type: 'CLIPTextEncode', inputs: { text: conditioned.prompt, clip: ['10', 1] } }
    graph['12'] = { class_type: 'CLIPTextEncode', inputs: { text: conditioned.negative, clip: ['10', 1] } }
    graph['13'] = { class_type: 'KSamplerAdvanced', inputs: { model: ['10', 0], positive: ['11', 0], negative: ['12', 0], latent_image: ['7', 0], add_noise: 'disable', noise_seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', start_at_step: split, end_at_step: p.steps, return_with_leftover_noise: 'disable' } }
    graph['8'].inputs.samples = ['13', 0]
  }
  return graph
}
function request(port, route, { method = 'GET', body, type = 'application/json', max = 1024 ** 2, timeout = 15000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, agent: false, signal,
      headers: { Accept: '*/*', ...(body ? { 'Content-Type': type, 'Content-Length': body.length } : {}) } }, res => {
      if (res.statusCode !== 200 || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); reject(new Error('ComfyUI rejected the request (HTTP ' + res.statusCode + '). Redirects and encoded responses are disabled.')); return }
      if (Number(res.headers['content-length']) > max) { res.destroy(); reject(new Error('ComfyUI response exceeds the size limit.')); return }
      const chunks = []; let length = 0
      res.on('data', chunk => { length += chunk.length; if (length > max) { res.destroy(new Error('ComfyUI response exceeds the size limit.')); return } chunks.push(chunk) })
      res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    const timer = setTimeout(() => req.destroy(new Error('ComfyUI request timed out.')), timeout)
    req.on('error', reject); req.on('close', () => clearTimeout(timer))
    req.end(body)
  })
}
function createSdxlService({ notify = () => {}, pollMs = 1000, jobTimeout = 30 * 60 * 1000 } = {}) {
  let connection = null, active = null, connecting = false
  let validated = new Set()
  const clientId = randomUUID()
  const json = async (port, route, options) => JSON.parse((await request(port, route, options)).toString('utf8'))
  async function connect(config) {
    if (active || connecting) throw new Error('Wait for the current AI operation.')
    if (config?.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Use 127.0.0.1 and a port between 1024 and 65535.')
    connection = null; validated = new Set(); connecting = true
    try {
      const stats = await json(config.port, '/system_stats')
      if (typeof stats?.system?.comfyui_version !== 'string' || stats.system.comfyui_version.length > 80 || !Array.isArray(stats.devices)) throw new Error('This endpoint does not identify as ComfyUI.')
      const nodes = {}
      for (const [name, inputs] of Object.entries(NODE_INPUTS)) {
        const info = await json(config.port, '/object_info/' + name, { max: 2 * 1024 ** 2 })
        const node = info[name]
        if (!node || node.python_module !== 'nodes' || !inputs.every(key => key in (node.input?.required || {}))) throw new Error('Missing or modified ComfyUI standard node: ' + name)
        nodes[name] = node
      }
      if (!nodes.LoadImageMask.input.required.channel?.[0]?.includes('red') || !nodes.KSampler.input.required.sampler_name?.[0]?.includes('dpmpp_2m_sde') || !nodes.KSampler.input.required.scheduler?.[0]?.includes('karras') || !nodes.KSamplerAdvanced.input.required.sampler_name?.[0]?.includes('dpmpp_2m_sde') || !nodes.KSamplerAdvanced.input.required.scheduler?.[0]?.includes('karras')) throw new Error('ComfyUI does not support the pinned workflows.')
      const models = modelList(nodes.CheckpointLoaderSimple.input.required.ckpt_name?.[0])
      const baseModels = models.filter(model => model !== REFINER)
      const defaultModel = baseModels.includes(MODEL) ? MODEL : baseModels[0] || null
      const defaultRefiner = models.includes(REFINER) ? REFINER : null
      connection = { port: config.port, version: stats.system.comfyui_version, models, defaultModel, defaultRefiner, modelAvailable: baseModels.length > 0 }
      return { ...connection, model: defaultModel, workflows: WORKFLOWS, operations: [], validatedPairs: [], validationRequired: true, cancelMode: 'stop-accepting-results' }
    } finally { connecting = false }
  }
  async function upload(port, buffer, name, signal) {
    const boundary = 'imejii-' + randomUUID()
    const body = Buffer.concat([Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="' + name + '"\r\nContent-Type: image/png\r\n\r\n'), buffer, Buffer.from('\r\n--' + boundary + '--\r\n')])
    const result = await json(port, '/upload/image', { method: 'POST', body, type: 'multipart/form-data; boundary=' + boundary, signal })
    if (result.name !== name || result.subfolder !== '' || result.type !== 'input') throw new Error('Unexpected ComfyUI upload destination.')
    return name
  }
  async function run(payload) {
    if (active || connecting) throw new Error('Another local AI job is still active, possibly after cancellation.')
    if (!connection?.modelAvailable) throw new Error('Connect ComfyUI with an SDXL .safetensors checkpoint first.')
    requestId(payload?.id); requestId(payload?.documentId)
    const selectedOperation = operation(payload?.operation)
    if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) throw new Error('Invalid Studio revision.')
    const p = parameters(payload.parameters, selectedOperation, connection.models)
    const key = validationKey(p.model, p.refiner, selectedOperation)
    if (!validated.has(key) && payload.validate !== true) throw new Error('Validate this model and workflow first.')
    const settings = { ...connection }, controller = new AbortController()
    const job = { id: payload.id, canceled: false, controller }; active = job
    const prefix = 'imejii_' + randomUUID(), started = Date.now()
    const update = (state, message) => { if (!job.canceled) notify({ id: job.id, documentId: payload.documentId, revision: payload.revision, state, message }) }
    try {
      let imageName, maskName
      if (selectedOperation !== 'text-to-image') {
        const image = png(payload.image), mask = png(payload.mask)
        update('preparing', 'Copying the selected image and mask to local ComfyUI…')
        imageName = await upload(settings.port, image, prefix + '_image.png', controller.signal)
        if (job.canceled) throw new Error('Canceled before submission.')
        maskName = await upload(settings.port, mask, prefix + '_mask.png', controller.signal)
        if (job.canceled) throw new Error('Canceled before submission.')
      } else update('preparing', 'Preparing the SDXL text-to-image workflow…')
      const graph = workflow(selectedOperation, p, imageName, maskName, prefix)
      const conditioning = conditionPrompts(p, selectedOperation)
      const queued = await json(settings.port, '/prompt', { method: 'POST', signal: controller.signal, body: Buffer.from(JSON.stringify({ prompt: graph, client_id: clientId })) })
      requestId(queued.prompt_id)
      if (queued.error || Object.keys(queued.node_errors || {}).length) throw new Error('ComfyUI rejected the SDXL workflow.')
      job.backendId = queued.prompt_id
      update('queued', 'Queued in ComfyUI. Waiting for this job’s result…')
      while (Date.now() - started < jobTimeout) {
        if (controller.signal.aborted) throw new Error('Studio connection closed. ComfyUI may still be working.')
        const history = await json(settings.port, '/history/' + job.backendId, { signal: controller.signal, max: 2 * 1024 ** 2 })
        const own = history[job.backendId]
        if (own) {
          if (own.prompt?.[1] !== job.backendId || JSON.stringify(own.prompt?.[2]) !== JSON.stringify(graph)) throw new Error('ComfyUI job ownership could not be verified.')
          if (own.status?.status_str === 'error') throw new Error('ComfyUI could not complete the SDXL job. Check its console for model or memory errors.')
          if (own.status?.completed === true && own.status.status_str === 'success') {
            if (job.canceled) return { canceled: true, backendFinished: true }
            const outputs = own.outputs?.['9']?.images
            if (!Array.isArray(outputs) || outputs.length !== 1) throw new Error('Unexpected ComfyUI output count.')
            const output = outputs[0]
            if (output.type !== 'output' || output.subfolder !== '' || typeof output.filename !== 'string' || !new RegExp('^' + prefix + '_[0-9]+_\\.png$').test(output.filename)) throw new Error('Unsafe or unrelated ComfyUI result path.')
            const bytes = await request(settings.port, '/view?' + new URLSearchParams({ filename: output.filename, subfolder: '', type: 'output' }), { signal: controller.signal, max: 8 * 1024 ** 2 })
            const expected = selectedOperation === 'text-to-image' ? size(p.width, p.height) : { width: 1024, height: 1024 }
            png(bytes, expected.width, expected.height)
            if (job.canceled) return { canceled: true, backendFinished: true }
            validated.add(key)
            return { bytes: new Uint8Array(bytes), provider: 'comfyui', providerVersion: settings.version, model: p.model, modelSha256: null,
              operation: selectedOperation, refiner: p.refiner || null, conditioning, workflow: WORKFLOWS[selectedOperation], workflowSha256: createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
              validatedPairs: validationPairs(validated), backendJobId: job.backendId, parameters: p, elapsedMs: Date.now() - started }
          }
          update('running', 'ComfyUI is processing this SDXL job…')
        }
        await new Promise(resolve => setTimeout(resolve, pollMs))
      }
      throw new Error('The SDXL job timed out. ComfyUI may still be working. Check the server before starting another heavy AI operation.')
    } finally { if (active === job) active = null }
  }
  function cancel(id) {
    requestId(id)
    if (active?.id !== id) return { canceled: false }
    active.canceled = true
    // Never call /interrupt or clear a shared queue. Keep resource ownership
    // until our submitted job finishes; only result acceptance is canceled.
    return { canceled: true, backendMayContinue: true }
  }
  function dispose() { if (active) { active.canceled = true; active.controller.abort() }; connection = null; validated = new Set() }
  function disconnect() {
    if (active || connecting) throw new Error('Wait for the current Studio operation before disconnecting.')
    connection = null; validated = new Set()
  }
  return { connect, run, cancel, disconnect, dispose, get busy() { return Boolean(active || connecting) } }
}
module.exports = { createSdxlService, workflow, parameters, conditionPrompts, png, request, operation, checkpoint, modelList, size, MODEL, REFINER, OPERATIONS, STYLE_PRESETS, WORKFLOWS, SDXL_SIZES, NODE_INPUTS }
