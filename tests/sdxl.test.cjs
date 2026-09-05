const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { randomUUID } = require('node:crypto')
const { createSdxlService, workflow, parameters, conditionPrompts, png, request, checkpoint, modelList, MODEL, REFINER, WORKFLOWS, SDXL_SIZES, NODE_INPUTS } = require('../electron/sdxl.cjs')
const COMMUNITY = 'community\\dream-xl.safetensors'
// Protocol fixtures only: this suite does not claim to execute an SDXL model.
const image = Buffer.alloc(33)
image.write('89504e470d0a1a0a', 'hex'); image.write('IHDR', 12); image.writeUInt32BE(1024, 16); image.writeUInt32BE(1024, 20); image[24] = 8; image[25] = 6
const params = { model: MODEL, prompt: 'A red vase', negative: '', seed: 42, steps: 25, cfg: 7, denoise: 1 }
const payload = (operation = 'inpaint') => ({ id: randomUUID(), documentId: randomUUID(), revision: 3, operation, parameters: { ...params, width: 1024, height: 1024 }, ...(operation === 'text-to-image' ? {} : { image, mask: image }), validate: true })
async function fixture(t, options = {}) {
  const calls = [], jobs = new Map()
  let ready = !options.wait
  const server = http.createServer(async (req, res) => {
    try {
      calls.push({ method: req.method, url: req.url })
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks), send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
      if (req.url === '/system_stats') return send(options.wrongServer ? {} : { system: { comfyui_version: 'fixture-only-1' }, devices: [] })
      if (req.url.startsWith('/object_info/')) {
        const name = req.url.split('/').pop(), required = Object.fromEntries(NODE_INPUTS[name].map(key => [key, ['STRING']]))
        if (name === 'CheckpointLoaderSimple') required.ckpt_name = [options.models || [MODEL]]
        if (name === 'LoadImageMask') required.channel = [['red', 'alpha']]
        if (name === 'KSampler' || name === 'KSamplerAdvanced') { required.sampler_name = [['dpmpp_2m_sde']]; required.scheduler = [['karras']] }
        return send({ [name]: { python_module: options.custom ? 'custom_nodes.untrusted' : 'nodes', input: { required } } })
      }
      if (req.url === '/upload/image') return send({ name: options.badUpload ? '../outside.png' : /filename="([^"]+)"/.exec(body.toString())?.[1], subfolder: '', type: 'input' })
      if (req.url === '/prompt') { const p = JSON.parse(body); const id = randomUUID(); jobs.set(id, p.prompt); return send({ prompt_id: id, node_errors: {} }) }
      if (req.url.startsWith('/history/')) {
        const id = req.url.split('/').pop(), graph = jobs.get(id)
        if (!ready) return send({ foreign: { status: { completed: true }, outputs: {} } })
        return send({ [id]: { prompt: [0, options.foreign ? randomUUID() : id, graph], status: { completed: true, status_str: options.failed ? 'error' : 'success' }, outputs: { '9': { images: [{ filename: options.badOutput ? '../private.png' : graph['9'].inputs.filename_prefix + '_00001_.png', subfolder: '', type: 'output' }] } } } })
      }
      if (req.url.startsWith('/view?')) { res.end(image); return }
      res.writeHead(404); res.end()
    } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  return { port: server.address().port, calls, jobs, ready: () => { ready = true } }
}
test('SDXL parameters, buffers and fixed workflow reject free model/path/operation inputs', () => {
  for (const change of [{ model: '../model' }, { prompt: '' }, { steps: 51 }, { seed: -1 }, { randomizeSeed: 'yes' }, { stylePreset: 'magic' }, { refinerEnabled: 'yes' }, { refiner: '../refiner.safetensors' }, { cfg: NaN }, { denoise: .8 }]) assert.throws(() => parameters({ ...params, ...change }))
  assert.throws(() => png(new Uint8Array(12))); assert.throws(() => png({ byteLength: 33 }))
  const graph = workflow('inpaint', params, 'own-image.png', 'own-mask.png', 'own-output')
  assert.equal(graph['5'].inputs.channel, 'red'); assert.equal(graph['6'].inputs.grow_mask_by, 6)
  assert.deepEqual(graph['6'].inputs.pixels, ['4', 0]); assert.equal(graph['4'].inputs.image, 'own-image.png')
  assert.equal(graph['7'].inputs.sampler_name, 'dpmpp_2m_sde'); assert.equal(graph['7'].inputs.scheduler, 'karras'); assert.equal(graph['1'].inputs.ckpt_name, MODEL)
  const text = workflow('text-to-image', { ...params, width: 1024, height: 1024 }, undefined, undefined, 'text-output')
  assert.equal(text['6'].class_type, 'EmptyLatentImage'); assert.equal(text['6'].inputs.width, 1024); assert.equal(text['4'], undefined)
  assert.throws(() => parameters({ ...params, width: 1000, height: 1000 }, 'text-to-image'))
  assert.equal(parameters({ ...params, model: COMMUNITY }, 'inpaint', [MODEL, COMMUNITY]).model, COMMUNITY)
  assert.equal(checkpoint(COMMUNITY), COMMUNITY)
  assert.deepEqual(modelList([MODEL, COMMUNITY, COMMUNITY, '../escape.safetensors', 'legacy.ckpt']), [COMMUNITY, MODEL])
  const refinedParameters = parameters({ ...params, refinerEnabled: true }, 'inpaint', [MODEL, REFINER])
  const refined = workflow('inpaint', refinedParameters, 'own-image.png', 'own-mask.png', 'own-output')
  assert.equal(refinedParameters.refiner, REFINER); assert.equal(refined['7'].class_type, 'KSamplerAdvanced')
  assert.equal(refined['7'].inputs.end_at_step, 20); assert.equal(refined['13'].inputs.start_at_step, 20); assert.deepEqual(refined['8'].inputs.samples, ['13', 0])
  assert.match(conditionPrompts(refinedParameters, 'inpaint').prompt, /matching ambient lighting/)
  assert.equal(conditionPrompts({ ...refinedParameters, stylePreset: 'raw' }, 'inpaint').prompt, params.prompt)
  assert.equal(WORKFLOWS.outpaint, 'imejii-sdxl-outpaint-v3'); assert.equal(SDXL_SIZES.length, 9)
})
test('SDXL refuses external addresses, invalid ports, impersonators and custom-node replacements', async t => {
  const service = createSdxlService()
  for (const config of [{ host: 'example.com', port: 8188 }, { host: 'localhost', port: 8188 }, { host: '127.0.0.1', port: 80 }, { host: '127.0.0.1', port: '8188' }]) await assert.rejects(service.connect(config))
  for (const options of [{ wrongServer: true }, { custom: true }]) { const f = await fixture(t, options); await assert.rejects(service.connect({ host: '127.0.0.1', port: f.port })) }
})
test('SDXL smoke-validation gate, own uploads/history and bounded result retrieval', async t => {
  const f = await fixture(t), progress = [], service = createSdxlService({ notify: p => progress.push(p), pollMs: 2 })
  const connected = await service.connect({ host: '127.0.0.1', port: f.port })
  assert.deepEqual(connected.operations, []); assert.equal(connected.validationRequired, true)
  assert.deepEqual(connected.models, [MODEL]); assert.equal(connected.defaultModel, MODEL)
  await assert.rejects(service.run({ ...payload(), validate: false }), /Validate/)
  const p = payload(), result = await service.run(p)
  assert.equal(result.model, MODEL); assert.equal(result.modelSha256, null); assert.equal(result.bytes.length, 33)
  assert.ok(progress.every(event => event.id === p.id && event.revision === p.revision && event.documentId === p.documentId))
  assert.equal(f.calls.filter(call => call.url === '/upload/image').length, 2)
  assert.ok(f.calls.every(call => !/interrupt|queue|delete/.test(call.url)))
  assert.equal(service.busy, false)
  await service.run({ ...payload(), validate: false })
  const text = await service.run(payload('text-to-image'))
  assert.equal(text.operation, 'text-to-image'); assert.equal(text.workflow, WORKFLOWS['text-to-image'])
  assert.equal(f.calls.filter(call => call.url === '/upload/image').length, 4)
})
test('Community SDXL checkpoints are selected from ComfyUI and validated per model and workflow', async t => {
  const f = await fixture(t, { models: [MODEL, COMMUNITY, COMMUNITY, '../escape.safetensors', 'legacy.ckpt'] })
  const service = createSdxlService({ pollMs: 2 })
  const connected = await service.connect({ host: '127.0.0.1', port: f.port })
  assert.deepEqual(connected.models, [COMMUNITY, MODEL]); assert.equal(connected.defaultModel, MODEL)
  const community = payload(); community.parameters.model = COMMUNITY
  const result = await service.run(community)
  assert.equal(result.model, COMMUNITY)
  assert.deepEqual(result.validatedPairs, [{ model: COMMUNITY, operation: 'inpaint' }])
  await service.run({ ...payload(), parameters: { ...payload().parameters, model: COMMUNITY }, validate: false })
  await assert.rejects(service.run({ ...payload('text-to-image'), parameters: { ...payload('text-to-image').parameters, model: COMMUNITY }, validate: false }), /Validate/)
  await assert.rejects(service.run({ ...payload(), validate: false }), /Validate/)
  await assert.rejects(service.run({ ...payload(), parameters: { ...payload().parameters, model: 'unknown-xl.safetensors' } }), /reported/)
})
test('Cancel owns only its job, ignores late output, retains resource lease until backend finishes', async t => {
  const f = await fixture(t, { wait: true }), service = createSdxlService({ pollMs: 2 })
  await service.connect({ host: '127.0.0.1', port: f.port })
  const p = payload(), running = service.run(p)
  for (let n = 0; n < 100 && !f.jobs.size; n++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.equal(f.jobs.size, 1)
  assert.equal(service.cancel(randomUUID()).canceled, false)
  assert.equal(service.cancel(p.id).backendMayContinue, true); assert.equal(service.busy, true)
  await assert.rejects(service.run(payload()), /still active/)
  f.ready(); assert.equal((await running).canceled, true)
  assert.ok(!f.calls.some(call => /interrupt|queue|view/.test(call.url))); assert.equal(service.busy, false)
})
test('Unsafe upload/output destinations, foreign job identity and backend failure never yield images', async t => {
  for (const options of [{ badUpload: true }, { badOutput: true }, { foreign: true }, { failed: true }]) {
    const f = await fixture(t, options), service = createSdxlService({ pollMs: 2 })
    await service.connect({ host: '127.0.0.1', port: f.port })
    await assert.rejects(service.run(payload()))
    assert.ok(!f.calls.some(call => call.url.startsWith('/view')))
  }
})
test('Loopback transport rejects redirects, oversized streams and slow responses', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://example.com' }); res.end() }
    else if (req.url === '/large') res.end(Buffer.alloc(200))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const port = server.address().port
  await assert.rejects(request(port, '/redirect'), /Redirects/)
  await assert.rejects(request(port, '/large', { max: 100 }), /size limit/)
  await assert.rejects(request(port, '/slow', { timeout: 20 }), /timed out/)
})
