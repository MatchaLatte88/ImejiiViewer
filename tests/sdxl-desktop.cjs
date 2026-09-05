// End-to-end protocol/UI fixture. This is deliberately NOT real model inference.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { MODEL, NODE_INPUTS } = require('../electron/sdxl.cjs')
const scratch = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'imejii-sdxl-test-'))
const report = process.env.IMEJII_SDXL_REPORT_DIR
app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile'))
BrowserWindow.prototype.show = function () {}
const fixture = path.resolve(process.env.IMEJII_CUTOUT_FIXTURE || path.join(__dirname, 'fixture.svg'))
const errors = [], results = [], saved = [], jobs = new Map(), uploads = new Map(), requests = []
let complete = true
dialog.showMessageBoxSync = () => 1; dialog.showMessageBox = async () => ({ response: 1 })
dialog.showErrorBox = (title, message) => errors.push(title + ': ' + message)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
dialog.showSaveDialog = async (...args) => { const filePath = path.join(scratch, path.basename(args.at(-1).defaultPath)); saved.push(filePath); return { canceled: false, filePath } }
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => { if (event.level === 'error') errors.push(event.message) }))
const server = http.createServer(async (req, res) => {
  try {
    requests.push(req.url)
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks), send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    if (req.url === '/system_stats') return send({ system: { comfyui_version: 'TEST-FIXTURE-NO-MODEL' }, devices: [] })
    if (req.url.startsWith('/object_info/')) {
      const name = req.url.split('/').pop(), required = Object.fromEntries(NODE_INPUTS[name].map(key => [key, ['STRING']]))
      if (name === 'CheckpointLoaderSimple') required.ckpt_name = [[MODEL]]
      if (name === 'LoadImageMask') required.channel = [['red', 'alpha']]
      if (name === 'KSampler') { required.sampler_name = [['dpmpp_2m_sde']]; required.scheduler = [['karras']] }
      return send({ [name]: { python_module: 'nodes', input: { required } } })
    }
    if (req.url === '/upload/image') {
      const name = /filename="([^"]+)"/.exec(body.toString())?.[1]
      uploads.set(name, body.subarray(body.indexOf(Buffer.from('89504e470d0a1a0a', 'hex')), body.lastIndexOf(Buffer.from('\r\n--'))))
      return send({ name, subfolder: '', type: 'input' })
    }
    if (req.url === '/prompt') { const data = JSON.parse(body), id = randomUUID(); jobs.set(id, data.prompt); return send({ prompt_id: id, node_errors: {} }) }
    if (req.url.startsWith('/history/')) {
      if (!complete) return send({})
      const id = req.url.split('/').pop(), graph = jobs.get(id)
      return send({ [id]: { prompt: [0, id, graph], status: { completed: true, status_str: 'success' }, outputs: { '9': { images: [{ filename: graph['9'].inputs.filename_prefix + '_00001_.png', subfolder: '', type: 'output' }] } } } })
    }
    if (req.url.startsWith('/view?')) {
      const filename = new URL(req.url, 'http://127.0.0.1').searchParams.get('filename'), graph = [...jobs.values()].find(g => filename.startsWith(g['9'].inputs.filename_prefix))
      res.setHeader('Content-Type', 'image/png'); res.end(uploads.get(graph['4'].inputs.image)); return
    }
    res.writeHead(404); res.end()
  } catch (error) { res.writeHead(500); res.end(error.message) }
})
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = setTimeout(() => { console.error('SDXL desktop fixture timeout', errors); app.exit(2) }, 120000)
require(process.env.IMEJII_PACKAGED_MAIN || '../electron/main.cjs')
async function until(fn) { for (let i = 0; i < 250; i++) { if (await fn()) return; await pause(40) }; throw new Error('Desktop fixture state timeout: ' + errors.join('\n')) }
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  if (report) await fs.mkdir(report, { recursive: true })
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0], wc = window.webContents, js = code => wc.executeJavaScript(code)
  window.setSize(1440, 960); wc.setBackgroundThrottling(false)
  await until(async () => { try { return await js("Boolean(document.querySelector('#app')?.__vue_app__)") } catch { return false } })
  await js(`globalThis.stores = () => Reflect.ownKeys(document.querySelector('#app').__vue_app__._context.provides).map(k => document.querySelector('#app').__vue_app__._context.provides[k]).find(v => v?._s); globalThis.studio = stores()._s.get('studio'); globalThis.ui = stores()._s.get('ui'); globalThis.plugins = stores()._s.get('plugins'); globalThis.library = stores()._s.get('library'); void 0`)
  async function check(name, fn) { try { await fn(); results.push({ name, status: 'PASS' }) } catch (error) { results.push({ name, status: 'FAIL', detail: error.message }); throw error } }
  async function click(text, scope = 'body') {
    await js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(text)}); b.click() })()`)
  }
  async function shot(name) { if (report) { await pause(120); await fs.writeFile(path.join(report, name), (await wc.capturePage()).toPNG()) } }
  try {
    await check('Optional Studio mode starts without a source/backend and preserves the Viewer default', async () => {
      assert.equal(await js('ui.mode'), 'view'); assert.equal(await js('plugins.studioEnabled'), false)
      await js("plugins.toggle('sdxl-studio'); ui.setMode('ai-studio')")
      await until(() => js("Boolean(document.querySelector('.ai-studio .empty'))"))
      assert.equal(await js('studio.hasSource'), false); assert.equal(requests.length, 0)
      await shot('sdxl-empty.png')
    })
    await check('Open, brush, undo and mode-switch commands target Studio and keep its source/mask session', async () => {
      wc.send('menu:action', 'open'); await until(() => js("Boolean(studio.source && document.querySelector('.mask-canvas'))"))
      assert.equal(await js('library.items.length'), 0)
      const rect = await js("(() => { const r=document.querySelector('.mask-canvas').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()")
      const x = Math.round(rect.x + rect.width * .5), y = Math.round(rect.y + rect.height * .6)
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseMove', x: x + 50, y }); wc.sendInputEvent({ type: 'mouseUp', x: x + 50, y, button: 'left', clickCount: 1 })
      await until(() => js('studio.document.strokes.length === 1'))
      await js("studio.document.parameters.prompt='A small ceramic planter with a green fern, soft natural light'; studio.document.parameters.seed=2026; studio.flush()")
      wc.send('menu:action', 'undo'); await until(() => js('studio.document.strokes.length === 0'))
      wc.send('menu:action', 'redo'); await until(() => js('studio.document.strokes.length === 1'))
      wc.send('menu:action', 'mode:logo'); await until(() => js("ui.mode === 'logo'"))
      wc.send('menu:action', 'mode:ai-studio'); await until(() => js("!!document.querySelector('.ai-studio')"))
      assert.equal(await js('studio.document.strokes.length'), 1)
      assert.equal(await js("document.querySelector('.ai-studio textarea').value"), await js('studio.document.parameters.prompt'))
      await shot('sdxl-mask-dark.png')
    })
    await check('Desktop broker connects only on action and the explicit validation run yields a preview', async () => {
      await js('studio.port=' + server.address().port + '; studio.connect()')
      assert.equal(await js('studio.connection.validationRequired'), true)
      assert.equal(uploads.size, 0)
      await click('Test local inpainting', '.ai-studio')
      await until(() => js('!studio.busy && studio.document.results.length === 1'))
      assert.equal(await js('library.items.length'), 0)
      assert.equal(await js('studio.selectedResult.provenance.parameters.seed'), 2026)
      await shot('sdxl-fixture-preview.png')
    })
    await check('Narrow layout and light theme expose the canvas, prompt, setup and variant actions', async () => {
      window.setSize(1024, 760); await pause(150)
      const layout = await js("({ overflow: document.documentElement.scrollWidth > innerWidth, canvas: document.querySelector('.source-canvas').getBoundingClientRect().width, prompt: document.querySelector('textarea').getBoundingClientRect().width })")
      assert.equal(layout.overflow, false); assert.ok(layout.canvas > 100 && layout.prompt > 180)
      await shot('sdxl-narrow.png'); wc.send('menu:action', 'theme'); await pause(100); await shot('sdxl-light.png')
      window.setSize(1440, 960)
    })
    await check('Portable Studio project contains checksummed binary artifacts; Ctrl+S exports only selected variant', async () => {
      await js("stores()._s.get('drafts').exportCurrent()")
      const project = await fs.readFile(saved.at(-1)); assert.equal(project.subarray(0, 8).toString(), 'IMEJII02')
      const length = project.readUInt32BE(8), header = JSON.parse(project.subarray(12, 12 + length))
      assert.equal(header.kind, 'studio'); assert.ok(header.entries.length >= 3); assert.ok(header.entries.some(entry => entry.hash === header.state.results[0].provenance.maskSha256)); assert.equal(header.state.parameters.seed, 2026)
      wc.send('menu:action', 'save'); await until(() => saved.at(-1)?.endsWith('.png'))
      await until(async () => { try { return (await fs.stat(saved.at(-1))).size > 0 } catch { return false } })
      assert.equal((await fs.readFile(saved.at(-1))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    })
    await check('Cancel survives mode changes, ignores late backend results and never interrupts other jobs', async () => {
      complete = false; await click('Source + mask', '.ai-studio'); await click('Generate variant', '.ai-studio')
      await until(() => jobs.size === 2)
      await click('Cancel result', '.ai-studio')
      wc.send('menu:action', 'mode:images'); await until(() => js("ui.mode === 'images'"))
      complete = true; await until(() => js('!studio.busy'))
      assert.equal(await js('studio.document.results.length'), 1)
      assert.ok(!requests.some(route => /interrupt|queue/.test(route)))
      wc.send('menu:action', 'mode:ai-studio'); await until(() => js("!!document.querySelector('.ai-studio')"))
    })
    await check('Explicit acceptance opens a new photo with source, seed and workflow provenance', async () => {
      await js('studio.selected=studio.document.results[0].id'); await click('Keep & open in Images', '.ai-studio')
      await until(() => js("ui.mode === 'images' && library.items.length === 1"))
      assert.equal(await js("library.activeItem.extensions['sdxl-studio'].providerVersion"), 'TEST-FIXTURE-NO-MODEL')
      assert.equal(await js('library.activeItem.metadata.Software'), 'Imejii / AI inpainting')
    })
    await check('Reload restores a durable Studio session with its mask, variants and independent activation', async () => {
      await js('studio.flush()'); wc.reload()
      await until(async () => { try { return await js("Boolean(document.querySelector('#app')?.__vue_app__)") } catch { return false } })
      await js(`globalThis.stores=()=>Reflect.ownKeys(document.querySelector('#app').__vue_app__._context.provides).map(k=>document.querySelector('#app').__vue_app__._context.provides[k]).find(v=>v?._s); globalThis.ui=stores()._s.get('ui'); globalThis.studio=stores()._s.get('studio'); ui.setMode('ai-studio'); void 0`)
      await until(() => js('Boolean(studio.source)'))
      assert.equal(await js('studio.document.strokes.length'), 1); assert.equal(await js('studio.document.results.length'), 1)
      assert.equal(await js('studio.connection'), null)
    })
  } catch (error) { console.error(error.message) }
  const summary = { provider: 'TEST FIXTURE — no model inference', results, errors }
  console.log(JSON.stringify(summary, null, 2))
  if (report) await fs.writeFile(path.join(report, process.env.IMEJII_PACKAGED_MAIN ? 'sdxl-asar.json' : 'sdxl-desktop.json'), JSON.stringify(summary, null, 2))
  clearTimeout(deadline); server.close(); server.closeAllConnections(); window.destroy(); app.exit(results.length !== 8 || results.some(r => r.status === 'FAIL') || errors.length ? 1 : 0)
}).catch(error => { console.error(error, errors); clearTimeout(deadline); server.close(); app.exit(2) })
