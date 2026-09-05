// Opt-in end-to-end check using real, verified weights. No inference network.
// Optional IMEJII_CUTOUT_FIXTURE points to a local photo; default is fixture.svg.
const { app, BrowserWindow, dialog, utilityProcess } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const catalog = require('../shared/ai-models.json')
const scratch = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'imejii-cutout-test-'))
const report = process.env.IMEJII_AI_REPORT_DIR
app.setPath('userData', path.join(scratch, 'profile')); app.setPath('sessionData', path.join(scratch, 'profile'))
BrowserWindow.prototype.show = function () {}
process.argv.push(path.resolve(process.env.IMEJII_CUTOUT_FIXTURE || path.join(__dirname, 'fixture.svg')))
const errors = [], results = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const nativeChildren = [], fork = utilityProcess.fork.bind(utilityProcess)
utilityProcess.fork = (...args) => {
  const child = fork(...args)
  if (args[0].endsWith('cutout-worker.cjs')) {
    const state = { child, exited: false }; nativeChildren.push(state)
    child.once('exit', () => { state.exited = true })
  }
  return child
}
dialog.showMessageBoxSync = () => 1
dialog.showMessageBox = async () => ({ response: 1 })
dialog.showErrorBox = (title, message) => errors.push(title + ': ' + message)
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(scratch, 'cutout.imejii') })
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => { if (event.level === 'error') errors.push(event.message) }))
const deadline = setTimeout(() => { console.error('Cutout test timeout', errors); app.exit(2) }, 420000)
require(process.env.IMEJII_PACKAGED_MAIN || '../electron/main.cjs')
async function until(test, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await test()) return; await pause(100) }
  throw new Error('Cutout UI state timeout: ' + errors.join('\n'))
}
app.whenReady().then(async () => {
  const cache = path.join(scratch, 'profile/ai-models'); await fs.mkdir(cache, { recursive: true })
  // Cutout must work with LaMa enabled but its model not installed.
  for (const id of ['birefnet-lite-v1']) {
    const name = catalog[id].sha256 + '.onnx'
    await fs.copyFile(path.resolve(__dirname, '../build/ai-models', name), path.join(cache, name))
  }
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0], wc = window.webContents
  // Exercise the responsive layout below the production window's minimum width.
  window.setMinimumSize(500, 600)
  window.setSize(1440, 1000); wc.setBackgroundThrottling(false)
  const ready = async () => { try { return await wc.executeJavaScript("Boolean(document.querySelector('#app')?.__vue_app__)") } catch { return false } }
  await until(ready)
  const storesScript = `globalThis.stores = () => Reflect.ownKeys(document.querySelector('#app').__vue_app__._context.provides).map(key => document.querySelector('#app').__vue_app__._context.provides[key]).find(value => value?._s); globalThis.library = stores()._s.get('library'); globalThis.ui = stores()._s.get('ui'); void 0;`
  await wc.executeJavaScript(storesScript)
  await until(() => wc.executeJavaScript('!!library.previewCanvas && !library.isRendering'))
  const original = await wc.executeJavaScript('JSON.stringify({ name:library.activeItem.name, edits:library.activeItem.edits, width:library.activeItem.width, height:library.activeItem.height })')
  async function check(name, callback) {
    try { const detail = await callback(); results.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); console.log('PASS', name) }
    catch (error) { results.push({ name, status: 'FAIL', detail: error.message }); console.error('FAIL', name, error.message) }
  }
  async function click(text, selector = 'body') {
    await wc.executeJavaScript(`(() => { const b = [...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(text)}); b.click(); })()`); await pause(150)
  }
  async function shot(file, width = 1440, height = 1000) {
    if (!report) return
    window.setSize(width + 1, height); await pause(150); window.setSize(width, height); await pause(200)
    await fs.writeFile(path.join(report, file), (await wc.capturePage()).toPNG())
  }
  await wc.executeJavaScript("ui.setMode('images'); void 0"); await click('Plugins')
  await check('Both plugins enable independently and report their own model readiness', async () => {
    await click('Enable plugin', '.plugin-card:nth-of-type(1)')
    await click('Enable plugin', '.plugin-card:nth-of-type(2)')
    await until(() => wc.executeJavaScript("document.querySelectorAll('.local-model-panel')[1]?.textContent.includes('Model verified')"))
    assert.equal(await wc.executeJavaScript("document.querySelectorAll('.local-model-panel')[0].textContent.includes('Download model · 208 MB')"), true)
    assert.deepEqual(await wc.executeJavaScript("JSON.parse(localStorage.getItem('imejii-plugins-v1'))"), ['ai-remove', 'ai-cutout'])
  })
  await shot('cutout-plugin-setup.png')
  wc.session.enableNetworkEmulation({ offline: true })
  await click('Cut out the subject')
  await until(() => wc.executeJavaScript("!!document.querySelector('dialog.cutout[open]')"))
  await check('Cancel terminates actual BiRefNet inference and permits retry', async () => {
    await until(() => wc.executeJavaScript("document.querySelector('.cutout .workspace-status').textContent.includes('Separating') || !!document.querySelector('.cutout .error')"), 90000)
    assert.equal(await wc.executeJavaScript("document.querySelector('.cutout .error')?.textContent"), undefined)
    assert.equal(nativeChildren.length, 1); assert.ok(nativeChildren[0].child.pid)
    await click('Cancel processing', '.cutout')
    await until(() => nativeChildren.every(state => state.exited))
    assert.equal(await wc.executeJavaScript('library.items.length'), 1)
    assert.equal(await wc.executeJavaScript("[...document.querySelectorAll('.cutout button')].some(b => b.textContent.trim() === 'Remove background' && !b.disabled)"), true)
  })
  await check('Cutout workspace blocks native mode changes and keeps source edits unchanged', async () => {
    wc.send('menu:action', 'mode:logo'); wc.send('menu:action', 'save'); wc.send('menu:action', 'rotate:right'); await pause(100)
    assert.equal(await wc.executeJavaScript('ui.mode'), 'images')
    assert.equal(await wc.executeJavaScript('JSON.stringify({ name:library.activeItem.name, edits:library.activeItem.edits, width:library.activeItem.width, height:library.activeItem.height })'), original)
  })
  await check('Real BiRefNet runs offline under production CSP and produces a soft transparent subject', async () => {
    let peakWorkingSetKiB = 0
    const sample = setInterval(() => {
      const metric = app.getAppMetrics().find(metric => metric.pid === nativeChildren.at(-1)?.child.pid)
      if (metric) peakWorkingSetKiB = Math.max(peakWorkingSetKiB, metric.memory.peakWorkingSetSize, metric.memory.workingSetSize)
    }, 100)
    const started = Date.now(); await click('Remove background', '.cutout')
    try { await until(() => wc.executeJavaScript("[...document.querySelectorAll('.cutout button')].some(b => b.textContent.trim() === 'Apply as new photo' && !b.disabled) || !!document.querySelector('.cutout .error')"), 240000) }
    finally { clearInterval(sample) }
    assert.equal(await wc.executeJavaScript("document.querySelector('.cutout .error')?.textContent"), undefined)
    const counts = await wc.executeJavaScript(`(() => { const c = document.querySelector('.cutout-canvas'), p = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let transparent=0, opaque=0, soft=0; for(let i=3;i<p.length;i+=4) { if(p[i]===0) transparent++; else if(p[i]===255) opaque++; else soft++; } return {transparent,opaque,soft,width:c.width,height:c.height}; })()`)
    assert.ok(counts.transparent > 0 && counts.opaque > 0 && counts.soft > 0, JSON.stringify(counts))
    assert.equal(nativeChildren.length, 2)
    await until(() => nativeChildren.every(state => state.exited))
    return { elapsedMs: Date.now() - started, sampledPeakWorkingSetKiB: peakWorkingSetKiB || null, ...counts }
  })
  await shot('cutout-preview.png')
  if (!results.some(r => r.status === 'FAIL')) {
    await check('Original/cutout comparison and preview backdrops never flatten the canvas', async () => {
      const after = await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()")
      await click('Original', '.cutout'); assert.notEqual(await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()"), after)
      await click('Cutout', '.cutout'); assert.equal(await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()"), after)
      await click('Dark', '.cutout'); assert.equal(await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()"), after)
      await shot('cutout-dark-backdrop.png')
      await click('Light', '.cutout'); assert.equal(await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()"), after)
      await wc.executeJavaScript("document.documentElement.dataset.theme='light'; void 0"); await shot('cutout-light.png')
      await wc.executeJavaScript("document.documentElement.dataset.theme='dark'; void 0"); await click('Transparency', '.cutout')
      await shot('cutout-compact.png', 1024, 640); await shot('cutout-narrow.png', 620, 780); window.setSize(1440, 1000); await pause(200)
    })
    await check('Manual correction, keyboard Undo/Redo and reset are deterministic', async () => {
      await click('Mask', '.cutout .view-switch')
      const before = await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()")
      await click('Remove', '.cutout')
      await wc.executeJavaScript(`(() => {
        const c=document.querySelector('.cutout-canvas'), p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let best=null, distance=Infinity;
        for(let y=0;y<c.height;y+=4) for(let x=0;x<c.width;x+=4) {
          const d=Math.hypot(x/c.width-.5,y/c.height-.5);
          if(p[(y*c.width+x)*4]>128 && d<distance) { best=[x,y]; distance=d; }
        }
        if(!best) throw new Error('No foreground pixel to test a remove stroke');
        const r=c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+best[0]/c.width*r.width,clientY:r.top+best[1]/c.height*r.height,bubbles:true}));
        c.focus(); c.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));
      })()`)
      await pause(100)
      const corrected = await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()")
      assert.ok(corrected !== before, 'Removing a foreground dot did not change the mask')
      await click('Undo', '.cutout'); assert.equal(await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()"), before)
      await click('Redo', '.cutout'); assert.equal(await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()"), corrected)
      await shot('cutout-mask-correction.png'); await click('Reset refinements', '.cutout')
      assert.equal(await wc.executeJavaScript("document.querySelector('.cutout-canvas').toDataURL()"), before)
      await click('Cutout', '.cutout')
    })
    await check('A failed collection restore keeps the preview and retries the same durable variant', async () => {
      await wc.executeJavaScript("globalThis.restoreOriginal = library.restoreDraft; library.restoreDraft = async () => { throw new Error('Simulated collection failure') }; void 0")
      await click('Apply as new photo', '.cutout')
      await until(() => wc.executeJavaScript("!!document.querySelector('.cutout .error') && ![...document.querySelectorAll('.cutout button')].find(b=>b.textContent.trim()==='Apply as new photo')?.disabled"))
      assert.equal(await wc.executeJavaScript('library.items.length'), 1)
      await wc.executeJavaScript("stores()._s.get('drafts').flush()")
      const savedIds = await wc.executeJavaScript("stores()._s.get('drafts').entries.filter(e=>e.state?.extensions?.['ai-cutout']).map(e=>e.id)")
      assert.equal(savedIds.length, 1)
      await wc.executeJavaScript('library.restoreDraft = restoreOriginal; void 0')
      await click('Apply as new photo', '.cutout')
      await until(() => wc.executeJavaScript('library.items.length === 2 && !document.querySelector("dialog.cutout[open]")'))
      assert.equal(await wc.executeJavaScript('library.activeItem.draftId'), savedIds[0])
    })
    await check('Cutout PNG/project persist alpha, source dimensions, edge settings and model provenance', async () => {
      const expected = JSON.parse(original)
      const result = await wc.executeJavaScript('JSON.parse(JSON.stringify({ name:library.activeItem.name,width:library.activeItem.width,height:library.activeItem.height,extensions:library.activeItem.extensions,metadata:library.activeItem.metadata,saved:library.hasSavedEdits(library.activeItem) }))')
      assert.equal(result.width, expected.width); assert.equal(result.height, expected.height); assert.equal(result.saved, true)
      assert.ok(result.name.endsWith('-cutout.png')); assert.equal(result.metadata.Software, 'Imejii / AI background removal')
      assert.equal(result.extensions['ai-cutout'].modelSha256, catalog['birefnet-lite-v1'].sha256)
      await wc.executeJavaScript("stores()._s.get('drafts').exportCurrent()")
      const bytes = await fs.readFile(path.join(scratch, 'cutout.imejii')), length = bytes.readUInt32BE(8)
      const header = JSON.parse(bytes.subarray(12, 12 + length))
      assert.equal(header.state.extensions['ai-cutout'].operation, 'background-removal')
      assert.equal(header.state.extensions['ai-cutout'].edge.feather, 0)
      assert.equal(bytes[12 + length + 25], 6) // PNG IHDR RGBA color type.
      if (report) await fs.writeFile(path.join(report, 'cutout-result.png'), bytes.subarray(12 + length))
    })
    const id = await wc.executeJavaScript('library.activeItem.draftId')
    await click('Disable plugin', '.plugin-card:nth-of-type(2)'); await wc.executeJavaScript("stores()._s.get('drafts').flush()")
    await wc.reload(); await until(ready); await wc.executeJavaScript(storesScript)
    await check('Saved cutout reopens after restart with its plugin disabled and LaMa still enabled', async () => {
      await wc.executeJavaScript(`stores()._s.get('drafts').restore(${JSON.stringify(id)})`)
      assert.equal(await wc.executeJavaScript("library.activeItem.extensions['ai-cutout'].model"), 'birefnet-lite-v1')
      assert.deepEqual(await wc.executeJavaScript("JSON.parse(localStorage.getItem('imejii-plugins-v1'))"), ['ai-remove'])
    })
  }
  console.log(JSON.stringify({ results, errors, scratch }, null, 2))
  if (report) await fs.writeFile(path.join(report, process.env.IMEJII_PACKAGED_MAIN ? 'cutout-asar.json' : 'cutout-desktop.json'), JSON.stringify({ results, errors }, null, 2))
  clearTimeout(deadline); window.destroy(); app.exit(results.some(r => r.status === 'FAIL') || errors.length ? 1 : 0)
}).catch(error => { console.error(error, errors); clearTimeout(deadline); app.exit(2) })
