// Actual application main/preload/protocol with native dialogs redirected to owned temp fixtures.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const scratch = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'imejii-desktop-test-'))
app.setPath('userData', path.join(scratch, 'profile'))
app.setPath('sessionData', path.join(scratch, 'profile'))
BrowserWindow.prototype.show = function () {}
const fixture = path.resolve(__dirname, 'fixture.svg')
process.argv.push(fixture)
let discard = false, closePrompts = 0
const consoleErrors = [], results = []
dialog.showMessageBoxSync = () => { closePrompts++; return discard ? 1 : 0 }
dialog.showMessageBox = async () => ({ response: discard ? 1 : 0 })
dialog.showErrorBox = (title, message) => { consoleErrors.push(title + ': ' + message) }
dialog.showOpenDialog = async (_window, options) => ({
  canceled: false, filePaths: options.properties.includes('openDirectory') ? [scratch] : [fixture, path.join(scratch, 'missing.png')],
})
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(scratch, 'saved.png') })
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') consoleErrors.push(event.message) })
})
const deadline = setTimeout(() => { console.error('Desktop smoke timeout', consoleErrors); app.exit(2) }, 60000)
require(process.env.IMEJII_PACKAGED_MAIN || '../electron/main.cjs')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(test) { for (let i = 0; i < 200; i++) { if (await test()) return; await pause(50) } throw new Error('Timed out waiting for UI state') }
app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0], wc = window.webContents
  await until(async () => {
    try { return await wc.executeJavaScript("Boolean(document.querySelector('#app')?.__vue_app__)") } catch { return false }
  })
  await wc.executeJavaScript(`
    globalThis.stores = () => Object.values(document.querySelector('#app').__vue_app__._context.provides).find(value => value?._s)
      || Reflect.ownKeys(document.querySelector('#app').__vue_app__._context.provides).map(key => document.querySelector('#app').__vue_app__._context.provides[key]).find(value => value?._s);
    globalThis.library = stores()._s.get('library');
    globalThis.editor = stores()._s.get('editor');
    globalThis.ui = stores()._s.get('ui');
    void 0;
  `)
  await until(() => wc.executeJavaScript('Boolean(library.previewCanvas)'))
  async function check(name, callback) {
    try { await callback(); results.push({ name, status: 'PASS' }) }
    catch (error) { results.push({ name, status: 'FAIL', detail: error.message }) }
  }
  await check('Production app starts via secure custom protocol with sandboxed bridge', async () => {
    assert.equal(wc.getURL(), 'imejii://app/index.html')
    const state = await wc.executeJavaScript("({ node: typeof window.require, bridge: !!desktopApi, title: document.title, width: library.previewCanvas.width })")
    assert.equal(state.node, 'undefined'); assert.equal(state.bridge, true); assert.equal(state.title, 'Imejii'); assert.equal(state.width, 800)
    const prefs = wc.getLastWebPreferences(); assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false)
  })
  await check('Every native file operation rejects ungranted renderer paths', async () => {
    const result = await wc.executeJavaScript(`Promise.all([
      desktopApi.readImages(['C:/Windows/win.ini']), desktopApi.listFolder('C:/Windows/win.ini'),
      desktopApi.writeInto({folder:'C:/Windows',name:'x.png',buffer:new Uint8Array([1])})
    ].map(p => p.then(() => false, () => true)))`)
    assert.deepEqual(result, [true, true, true])
  })
  await check('Preload refuses a fabricated File path and does not expose ipcRenderer', async () => {
    const result = await wc.executeJavaScript(`(async () => {
      const file = new File(['x'], 'x.png'); file.path = 'C:/Windows/win.ini';
      const adopted = await desktopApi.adoptFile(file);
      return { count: adopted.files.length, rawIPC: typeof desktopApi.invoke };
    })()`)
    assert.equal(result.count, 0); assert.equal(result.rawIPC, 'undefined')
  })
  await check('Real native open returns valid selections alongside per-file errors', async () => {
    const result = await wc.executeJavaScript('desktopApi.openImages({multiple:true})')
    assert.equal(result.files.length, 1); assert.ok(result.files[0].id); assert.equal(result.files[0].buffer, undefined); assert.match(result.error, /missing.png/)
  })
  await check('Production CSP blocks inline script execution', async () => {
    const blocked = await wc.executeJavaScript(`new Promise(resolve => {
      document.addEventListener('securitypolicyviolation', () => resolve(true), {once:true});
      const script = document.createElement('script'); script.textContent = 'globalThis.inlineScriptRan = true'; document.body.append(script);
      setTimeout(() => resolve(!globalThis.inlineScriptRan), 100);
    })`)
    assert.equal(blocked, true)
  })
  await check('Actual renderer edit updates Undo and can be reversed', async () => {
    await wc.executeJavaScript("ui.setMode('images'); library.rotateBy(90); void 0")
    await until(() => wc.executeJavaScript('library.previewCanvas?.width === 400 && !library.isRendering'))
    assert.equal(await wc.executeJavaScript('library.canUndo'), true)
    await wc.executeJavaScript('library.undo(); void 0')
    await until(() => wc.executeJavaScript('library.previewCanvas?.width === 800 && !library.isRendering'))
  })
  await check('Real export uses the main-process save path and PNG bytes', async () => {
    await wc.executeJavaScript("library.saveActiveAs('png')")
    const bytes = await fs.readFile(path.join(scratch, 'saved.png'))
    assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71])
  })
  await check('Color-only photo edits render through the real worker', async () => {
    const version = await wc.executeJavaScript('library.renderVersion')
    await wc.executeJavaScript("library.patchEdits({adjustments:{...library.activeItem.edits.adjustments,grayscale:100}}); void 0")
    await until(() => wc.executeJavaScript('library.renderVersion > ' + version + ' && !library.isRendering'))
    const gray = await wc.executeJavaScript(`(() => {
      const c = library.previewCanvas, data = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for(let i=0;i<data.length;i+=4) if(data[i] !== data[i+1] || data[i] !== data[i+2]) return false;
      return true;
    })()`)
    assert.equal(gray, true)
    await wc.executeJavaScript('library.undo(); void 0')
    await until(() => wc.executeJavaScript('!library.isRendering'))
  })
  await check('Mode handover uses the actually loaded logo source, not stale history', async () => {
    wc.send('menu:action', 'mode:logo')
    await until(() => wc.executeJavaScript("ui.mode === 'logo' && editor.source?.name === 'fixture.svg'"))
    await wc.executeJavaScript(`(async () => {
      const blob = await new Promise(resolve => editor.originalCanvas.toBlob(resolve));
      await editor.loadFile(new File([blob], 'replacement-B.png', {type:'image/png'}));
    })()`)
    assert.equal(await wc.executeJavaScript('editor.source.name'), 'replacement-B.png')
    wc.send('menu:action', 'mode:view')
    await until(() => wc.executeJavaScript("ui.mode === 'view'"))
    wc.send('menu:action', 'mode:logo')
    await until(() => wc.executeJavaScript("ui.mode === 'logo' && editor.source?.name === 'fixture.svg'"))
    wc.send('menu:action', 'mode:images')
    await until(() => wc.executeJavaScript("ui.mode === 'images'"))
  })
  await check('Real folder batch creates a unique child and reports success', async () => {
    await wc.executeJavaScript("library.batch.format = 'png'; library.runBatch()")
    const entries = await fs.readdir(scratch)
    const output = entries.find(name => name.startsWith('images-1-'))
    assert.ok(output)
    assert.deepEqual(await fs.readdir(path.join(scratch, output)), ['fixture.png'])
  })
  await check('Rendered numeric controls and thumbnails have accessible names', async () => {
    const result = await wc.executeJavaScript(`({
      unnamed: [...document.querySelectorAll('input[type=number]')].filter(input => !input.getAttribute('aria-label') && !input.closest('label')).length,
      thumbnail: Boolean(document.querySelector('button.thumb__select[aria-label]'))
    })`)
    assert.equal(result.unnamed, 0); assert.equal(result.thumbnail, true)
  })
  await check('Dirty window close asks and keeps the window on cancellation', async () => {
    await wc.executeJavaScript('library.rotateBy(90); void 0')
    window.close(); await pause(200)
    assert.equal(window.isDestroyed(), false)
    assert.ok(closePrompts >= 1)
  })
  // The single intentional CSP violation is expected and recorded separately.
  const unexpectedErrors = consoleErrors.filter(message => !/Executing inline script violates|Refused to execute inline script/.test(message))
  console.log(JSON.stringify({ results, consoleErrors: unexpectedErrors, scratch }, null, 2))
  if (process.env.IMEJII_TEST_REPORT) await fs.writeFile(process.env.IMEJII_TEST_REPORT, JSON.stringify({ results, consoleErrors: unexpectedErrors }, null, 2))
  if (process.env.IMEJII_REPORT_DIR) await fs.writeFile(path.join(process.env.IMEJII_REPORT_DIR, process.env.IMEJII_PACKAGED_MAIN ? 'packaged-results-fixed.json' : 'desktop-results-fixed.json'), JSON.stringify({ results, consoleErrors: unexpectedErrors }, null, 2))
  clearTimeout(deadline); discard = true; window.destroy()
  app.exit(results.some(r => r.status === 'FAIL') || unexpectedErrors.length ? 1 : 0)
}).catch(error => { console.error(error, consoleErrors); clearTimeout(deadline); app.exit(2) })
