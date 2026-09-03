// Hidden, isolated Electron test window. Dialogs and writes are in-memory stubs.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '../..')
const scratch = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'imejii-audit-'))
app.setPath('userData', scratch)
app.setPath('sessionData', scratch)
app.setName('Imejii Audit')
ipcMain.handle('files:startup', () => ({ files: [], error: null }))
const deadline = setTimeout(() => { console.error('Audit timeout'); app.exit(2) }, 60000)

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1500, height: 940, webPreferences: {
    preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } })
  const consoleErrors = []
  window.webContents.on('console-message', (event) => { if (event.level === 'warning' || event.level === 'error') consoleErrors.push(event.message) })
  await window.loadFile(path.join(root, 'dist/index.html'))
  const smoke = await window.webContents.executeJavaScript(`({ title: document.title, rootChildren: document.querySelector('#app').children.length, bridge: !!window.desktopApi, node: typeof window.require, csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') })`)
  const bundled = await build({ entryPoints: [path.join(__dirname, 'renderer-checks.js')], bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } })
  // Fresh page: real source modules use this in-memory adapter instead of real dialogs/files.
  const testWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await testWindow.loadURL('about:blank')
  await testWindow.webContents.executeJavaScript(`
    globalThis.auditWrites = [];
    globalThis.desktopApi = {
      isDesktop: true,
      selectFolder: async () => ({canceled: false, path: 'D:\\\\audit-output'}),
      writeInto: async (payload) => { auditWrites.push(payload); return {path: payload.name} },
      saveFile: async () => ({canceled: true}),
      listFolder: async () => ({dir: 'D:\\\\audit-fixtures', names: ['a.png', 'b.png'], separator: '\\\\'}),
      readImages: async () => ({ files: [globalThis.auditFolderFile], error: null })
    };
    void 0;
  `)
  await testWindow.webContents.executeJavaScript(bundled.outputFiles[0].text + '\nvoid 0;')
  const checks = await testWindow.webContents.executeJavaScript('runImejiiAudit()')
  const output = JSON.stringify({ smoke, consoleErrors, ...checks }, null, 2)
  await fs.writeFile(path.join(__dirname, 'renderer-results.json'), output + '\n')
  console.log(output)
  clearTimeout(deadline)
  window.destroy(); testWindow.destroy()
  app.exit(checks.results.some(r => r.status === 'FAIL') ? 1 : 0)
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(2) })
