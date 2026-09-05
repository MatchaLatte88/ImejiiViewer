// Opt-in real model regression. No network: uses the explicitly downloaded test cache.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const catalog = require('../shared/ai-models.json')
const scratch = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'imejii-ai-test-'))
app.setPath('userData', path.join(scratch, 'profile'))
app.setPath('sessionData', path.join(scratch, 'profile'))
BrowserWindow.prototype.show = function () {}
process.argv.push(path.resolve(__dirname, 'fixture.svg'))
const errors = [], results = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms))
dialog.showMessageBoxSync = () => 1
dialog.showMessageBox = async () => ({ response: 1 })
dialog.showErrorBox = (title, message) => errors.push(title + ': ' + message)
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(scratch, 'result.imejii') })
app.on('web-contents-created', (_event, wc) => wc.on('console-message', event => { if (event.level === 'error') errors.push(event.message) }))
const deadline = setTimeout(() => { console.error('AI test timeout', errors); app.exit(2) }, 240000)
require(process.env.IMEJII_PACKAGED_MAIN || '../electron/main.cjs')
async function until(test, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await test()) return; await pause(100) }
  throw new Error('AI UI state timeout: ' + errors.join('\n'))
}
app.whenReady().then(async () => {
  const name = catalog['lama-v1'].sha256 + '.onnx'
  await fs.mkdir(path.join(scratch, 'profile/ai-models'), { recursive: true })
  await fs.copyFile(path.resolve(__dirname, '../build/ai-models', name), path.join(scratch, 'profile/ai-models', name))
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0], wc = window.webContents
  wc.setBackgroundThrottling(false); window.setSize(1440, 1000)
  await until(async () => { try { return await wc.executeJavaScript("Boolean(document.querySelector('#app')?.__vue_app__)") } catch { return false } })
  const storesScript = `globalThis.stores = () => Reflect.ownKeys(document.querySelector('#app').__vue_app__._context.provides).map(key => document.querySelector('#app').__vue_app__._context.provides[key]).find(value => value?._s); globalThis.library = stores()._s.get('library'); globalThis.ui = stores()._s.get('ui'); void 0;`
  await wc.executeJavaScript(storesScript)
  await until(() => wc.executeJavaScript('!!library.previewCanvas && !library.isRendering'))
  async function check(name, callback) {
    try { const detail = await callback(); results.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); console.log('PASS', name) }
    catch (error) { results.push({ name, status: 'FAIL', detail: error.message }); console.error('FAIL', name, error.message) }
  }
  async function click(text) { await wc.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(text)}); b.click(); })()`); await pause(150) }
  async function shot(file) {
    if (!process.env.IMEJII_AI_REPORT_DIR) return
    await wc.capturePage(); window.setSize(1441, 1000); await pause(200); window.setSize(1440, 1000); await pause(200)
    await fs.writeFile(path.join(process.env.IMEJII_AI_REPORT_DIR, file), (await wc.capturePage()).toPNG())
  }
  await check('AI IPC rejects arbitrary model IDs, URLs and paths', async () => {
    const rejected = await wc.executeJavaScript(`Promise.all([desktopApi.aiModelRead('../secret'), desktopApi.aiModelInstall('https://example.com/model'), desktopApi.aiModelRemove({id:'lama-v1'})].map(p => p.then(() => false, () => true)))`)
    assert.deepEqual(rejected, [true, true, true])
  })
  await wc.executeJavaScript("ui.setMode('images'); void 0")
  await click('Plugins'); await click('Enable plugin')
  await until(() => wc.executeJavaScript("document.body.textContent.includes('Model verified')"))
  await shot('ai-plugin-setup.png')
  wc.session.enableNetworkEmulation({ offline: true })
  await click('Remove an object')
  await until(() => wc.executeJavaScript("!!document.querySelector('dialog.removal[open]')"))
  await check('Isolated workspace blocks native edit/mode shortcuts', async () => {
    wc.send('menu:action', 'mode:logo'); wc.send('menu:action', 'save'); await pause(100)
    assert.equal(await wc.executeJavaScript('ui.mode'), 'images')
    assert.equal(await wc.executeJavaScript('library.items.length'), 1)
  })
  // Synthetic fixture: select the green circle, preserving the rest of the canvas.
  await wc.executeJavaScript(`(() => {
    const range = document.querySelector('#removal-brush'); range.value = '25'; range.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await pause(50)
  const rect = await wc.executeJavaScript(`(() => { const r = document.querySelector('.paint-canvas').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`)
  const pos = (x, y) => ({ x: Math.round(rect.x + x * rect.width), y: Math.round(rect.y + y * rect.height) })
  for (const y of [.17, .27, .37]) {
    wc.sendInputEvent({ type: 'mouseMove', ...pos(.70, y) }); wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...pos(.70, y) })
    for (const x of [.72, .74, .76, .78, .80]) wc.sendInputEvent({ type: 'mouseMove', ...pos(x, y) })
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...pos(.80, y) }); await pause(50)
  }
  await shot('ai-removal-mask.png')
  await wc.executeJavaScript("document.documentElement.dataset.theme = 'light'; void 0")
  await shot('ai-removal-light.png')
  await wc.executeJavaScript("document.documentElement.dataset.theme = 'dark'; void 0")
  window.setSize(1024, 640); await pause(200)
  if (process.env.IMEJII_AI_REPORT_DIR) await fs.writeFile(path.join(process.env.IMEJII_AI_REPORT_DIR, 'ai-removal-compact.png'), (await wc.capturePage()).toPNG())
  window.setSize(1440, 1000); await pause(200)
  await check('Real mask Undo and Redo preserve pixels', async () => {
    const before = await wc.executeJavaScript("document.querySelector('.paint-canvas').toDataURL()")
    await click('Undo'); await click('Redo')
    assert.equal(await wc.executeJavaScript("document.querySelector('.paint-canvas').toDataURL()"), before)
  })
  await check('Cancel terminates real inference and retains the editable mask', async () => {
    const before = await wc.executeJavaScript("document.querySelector('.paint-canvas').toDataURL()")
    await click('Remove object')
    await until(() => wc.executeJavaScript("document.querySelector('.workspace-status').textContent.includes('Reconstructing') || !!document.querySelector('.removal .error')"), 60000)
    await click('Cancel processing')
    assert.equal(await wc.executeJavaScript("document.querySelector('.paint-canvas').toDataURL()"), before)
    assert.equal(await wc.executeJavaScript('library.items.length'), 1)
    assert.equal(await wc.executeJavaScript("[...document.querySelectorAll('.removal button')].some(b => b.textContent.trim() === 'Remove object' && !b.disabled)"), true)
  })
  const started = Date.now()
  await click('Remove object')
  await check('Real LaMa inference runs offline in the production CSP worker', async () => {
    await until(() => wc.executeJavaScript("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Apply as new photo' && !b.disabled) || !!document.querySelector('.removal .error')"), 180000)
    const error = await wc.executeJavaScript("document.querySelector('.removal .error')?.textContent")
    assert.equal(error, undefined)
    return { elapsedMs: Date.now() - started }
  })
  await shot('ai-removal-preview.png')
  if (!results.some(entry => entry.status === 'FAIL')) {
    await check('Before/After is reversible without modifying the source', async () => {
      const after = await wc.executeJavaScript("document.querySelector('.source-canvas').toDataURL()")
      await click('Before')
      assert.notEqual(await wc.executeJavaScript("document.querySelector('.source-canvas').toDataURL()"), after)
      await click('After')
      assert.equal(await wc.executeJavaScript("document.querySelector('.source-canvas').toDataURL()"), after)
      assert.equal(await wc.executeJavaScript('library.items.length'), 1)
    })
    await click('Apply as new photo')
    await until(() => wc.executeJavaScript('library.items.length === 2 && !document.querySelector("dialog.removal[open]")'))
    await check('Applied raster and provenance are saved before returning to the editor', async () => {
      const result = await wc.executeJavaScript(`JSON.parse(JSON.stringify({name:library.activeItem.name, width:library.activeItem.width, height:library.activeItem.height, extensions:library.activeItem.extensions, saved:library.hasSavedEdits(library.activeItem), original:library.items[0].edits}))`)
      assert.equal(result.width, 800); assert.equal(result.height, 400); assert.equal(result.saved, true)
      assert.equal(result.extensions['ai-remove'].modelSha256, catalog['lama-v1'].sha256)
      assert.equal(result.original.rotate, 0)
      await wc.executeJavaScript("stores()._s.get('drafts').exportCurrent()")
      const bytes = await fs.readFile(path.join(scratch, 'result.imejii')), length = bytes.readUInt32BE(8)
      const header = JSON.parse(bytes.subarray(12, 12 + length))
      assert.equal(header.state.extensions['ai-remove'].operation, 'object-removal')
      if (process.env.IMEJII_AI_REPORT_DIR) await fs.writeFile(path.join(process.env.IMEJII_AI_REPORT_DIR, 'ai-result.png'), bytes.subarray(12 + length))
    })
    await click('Disable plugin')
    await wc.executeJavaScript("stores()._s.get('drafts').flush()")
    const id = await wc.executeJavaScript('library.activeItem.draftId')
    await wc.reload()
    await until(async () => { try { return await wc.executeJavaScript("Boolean(document.querySelector('#app')?.__vue_app__)") } catch { return false } })
    await wc.executeJavaScript(storesScript)
    await check('Saved AI photo restores after restart with the plugin disabled', async () => {
      await wc.executeJavaScript(`stores()._s.get('drafts').restore(${JSON.stringify(id)})`)
      assert.equal(await wc.executeJavaScript("library.activeItem.extensions['ai-remove'].model"), 'lama-v1')
      assert.equal(await wc.executeJavaScript("JSON.parse(localStorage.getItem('imejii-plugins-v1')).length"), 0)
    })
  }
  console.log(JSON.stringify({ results, errors, scratch }, null, 2))
  if (process.env.IMEJII_AI_REPORT_DIR) await fs.writeFile(path.join(process.env.IMEJII_AI_REPORT_DIR, process.env.IMEJII_PACKAGED_MAIN ? 'ai-asar.json' : 'ai-desktop.json'), JSON.stringify({ results, errors }, null, 2))
  clearTimeout(deadline); window.destroy(); app.exit(results.some(r => r.status === 'FAIL') || errors.length ? 1 : 0)
}).catch(error => { console.error(error, errors); clearTimeout(deadline); app.exit(2) })
