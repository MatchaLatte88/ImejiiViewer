const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const scratch = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'imejii-tests-'))
app.setPath('userData', path.join(scratch, 'profile'))
app.setPath('sessionData', path.join(scratch, 'profile'))
const deadline = setTimeout(() => { console.error('Regression timeout'); app.exit(2) }, 120000)
app.whenReady().then(async () => {
  const { build } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  await build({ configFile: false, root: path.resolve(__dirname, '..'), base: './',
    plugins: [vue()],
    build: { target: 'esnext', outDir: path.join(scratch, 'bundle'), emptyOutDir: false,
      rollupOptions: { input: [path.join(__dirname, 'renderer.html'), path.join(__dirname, 'browser.html')] } },
  })
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  const errors = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await window.loadFile(path.join(scratch, 'bundle/tests/renderer.html'))
  for (let i = 0; i < 100; i++) {
    if (await window.webContents.executeJavaScript('globalThis.imejiiTestReady === true')) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const result = await window.webContents.executeJavaScript('runImejiiAudit()')
  const browser = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  browser.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await browser.loadFile(path.join(scratch, 'bundle/tests/browser.html'))
  for (let i = 0; i < 100; i++) {
    if (await browser.webContents.executeJavaScript('globalThis.imejiiTestReady === true')) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  result.results.push(...(await browser.webContents.executeJavaScript('runBrowserChecks()')).results)
  console.log(JSON.stringify({ ...result, errors }, null, 2))
  if (process.env.IMEJII_TEST_REPORT) await fs.writeFile(process.env.IMEJII_TEST_REPORT, JSON.stringify({ ...result, errors }, null, 2))
  if (process.env.IMEJII_REPORT_DIR) await fs.writeFile(path.join(process.env.IMEJII_REPORT_DIR, 'renderer-results-fixed.json'), JSON.stringify({ ...result, errors }, null, 2))
  clearTimeout(deadline); window.destroy(); browser.destroy()
  app.exit(result.results.some(r => r.status === 'FAIL') || errors.length ? 1 : 0)
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(2) })
