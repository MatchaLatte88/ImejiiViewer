const { app, BrowserWindow, Menu, dialog, ipcMain, shell, protocol, net, session } = require('electron')
const path = require('node:path')
const { createFileAccess, saveSelectedFile, IMAGE_EXTENSIONS, MAX_FILES, safeParts, validatedBuffer } = require('./file-access.cjs')
const { APP_URL, developmentURL, assertSender, serveApp } = require('./security.cjs')

const DEV_SERVER_URL = developmentURL(app.isPackaged, process.env.VITE_DEV_SERVER_URL)
const access = createFileAccess()
let mainWindow = null
let rendererReady = false
let dialogBusy = false
let pendingPaths = []
let draining = false
protocol.registerSchemesAsPrivileged([{ scheme: 'imejii', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }])
app.setAppUserModelId('io.imejii.viewer')

function collectImagePaths(argv, cwd) {
  return argv.slice(1).filter(a => typeof a === 'string' && !a.startsWith('-'))
    .map(a => path.resolve(cwd || process.cwd(), a))
    .filter(p => IMAGE_EXTENSIONS.includes(path.extname(p).slice(1).toLowerCase())).slice(0, MAX_FILES)
}
function queueFiles(paths) {
  pendingPaths.push(...paths.slice(0, Math.max(0, MAX_FILES - pendingPaths.length)))
  void drainFiles()
}
async function drainFiles() {
  if (draining || !rendererReady || !mainWindow || !pendingPaths.length) return
  draining = true
  const window = mainWindow
  const paths = pendingPaths.splice(0)
  try {
    const result = await access.grant(paths)
    if (mainWindow === window && !window.isDestroyed() && rendererReady) window.webContents.send('files:opened', result)
    else pendingPaths.unshift(...paths)
  } catch (error) {
    if (!window.isDestroyed()) window.webContents.send('files:opened', { files: [], error: error.message })
  } finally {
    draining = false
    if (rendererReady && pendingPaths.length) void drainFiles()
  }
}
function sendMenuAction(action) {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', action)
}
function createWindow() {
  rendererReady = false
  access.reset()
  const window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0d0f14', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  })
  mainWindow = window
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  const contents = window.webContents
  contents.on('did-start-loading', () => { rendererReady = false })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  for (const eventName of ['will-navigate', 'will-redirect', 'will-attach-webview']) contents.on(eventName, event => event.preventDefault())
  contents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning', message: 'Discard unsaved edits or active work?',
      detail: 'Unsaved edits will be lost. Completed exports are kept.',
      buttons: ['Keep working', 'Discard and leave'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (choice === 1) event.preventDefault()
  })
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || window.isDestroyed()) return
    const choice = dialog.showMessageBoxSync(window, {
      type: 'error', message: 'The image workspace stopped responding.',
      detail: 'Unsaved edits may have been lost. Try a smaller image if this happens again.',
      buttons: ['Reload', 'Close'], defaultId: 0,
    })
    if (choice === 0) { access.reset(); contents.reload() } else window.destroy()
  })
  window.on('closed', () => {
    if (mainWindow === window) { mainWindow = null; rendererReady = false; access.reset() }
  })
  window.loadURL(DEV_SERVER_URL || APP_URL).catch(error => {
    dialog.showErrorBox('Unable to open Imejii', error.message + '\nRun npm run build before starting the desktop app.')
    if (!window.isDestroyed()) window.destroy()
  })
}
function buildMenu() {
  const action = (label, accelerator, command) => ({ label, accelerator, click: () => sendMenuAction(command) })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '&File', submenu: [
      action('Open images...', 'CmdOrCtrl+O', 'open'), action('Save current image...', 'CmdOrCtrl+S', 'save'),
      { type: 'separator' }, action('View mode', 'CmdOrCtrl+1', 'mode:view'),
      action('Logo mode', 'CmdOrCtrl+2', 'mode:logo'), action('Image mode', 'CmdOrCtrl+3', 'mode:images'),
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ] },
    { label: '&Edit', submenu: [
      action('Undo', 'CmdOrCtrl+Z', 'undo'), action('Redo', 'CmdOrCtrl+Shift+Z', 'redo'),
      { type: 'separator' }, { role: 'copy' }, { role: 'paste' },
    ] },
    { label: '&View', submenu: [
      action('Toggle theme', 'CmdOrCtrl+T', 'theme'), { type: 'separator' },
      ...(DEV_SERVER_URL ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { label: '&Help', submenu: [{ label: 'About Imejii', click: () => dialog.showMessageBox(mainWindow, {
      type: 'info', message: 'Imejii ' + app.getVersion(),
      detail: 'View and convert images. Cut out logos and build icon sets.\nElectron ' + process.versions.electron + ' / Chromium ' + process.versions.chrome,
    }) }] },
  ]))
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    assertSender(event, mainWindow, DEV_SERVER_URL)
    return fn(...args)
  })
}
async function withDialog(fn) {
  if (dialogBusy) throw new Error('Another file dialog is already open.')
  dialogBusy = true
  try { return await fn() } finally { dialogBusy = false }
}
handle('dialog:openImages', (options = {}) => withDialog(async () => {
  const multiple = options?.multiple === true
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open images', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
  })
  return result.canceled ? { canceled: true, files: [] } : { canceled: false, ...await access.grant(result.filePaths) }
}))
// Only preload derives this path from an actual native File via webUtils.
handle('files:adopt', filePath => access.grant([filePath]))
handle('files:startup', async () => {
  const result = await access.grant(pendingPaths.splice(0))
  rendererReady = true
  void drainFiles()
  return result
})
handle('files:read', async ids => {
  if (!Array.isArray(ids) || ids.length !== 1) throw new Error('Read exactly one authorized image at a time.')
  return { files: [await access.read(ids[0])], error: null }
})
handle('folder:list', id => access.list(id))
handle('dialog:saveFile', payload => withDialog(async () => {
  const { defaultName, buffer, extension } = payload || {}
  if (safeParts(defaultName).length !== 1 || !['png', 'jpg', 'jpeg', 'webp', 'ico', 'zip'].includes(extension)) throw new Error('Invalid export filename.')
  validatedBuffer(buffer)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save file', defaultPath: defaultName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    properties: ['showOverwriteConfirmation'],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await saveSelectedFile(result.filePath, buffer)
  return { canceled: false, path: result.filePath }
}))
handle('dialog:selectFolder', name => withDialog(async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose parent folder — a new export subfolder will be created', properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? { canceled: true } : { canceled: false, ...await access.begin(result.filePaths[0], name) }
}))
handle('file:writeInto', payload => access.write(payload))
handle('file:finishSet', token => access.finish(token))
handle('shell:showItem', filePath => {
  if (!access.canReveal(filePath)) throw new Error('Unknown export.')
  shell.showItemInFolder(filePath)
})
handle('dialog:confirmDiscard', message => withDialog(async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning', message: String(message).slice(0, 500), buttons: ['Keep working', 'Discard edits'],
    defaultId: 0, cancelId: 0, noLink: true,
  })
  return result.response === 1
}))
handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, electron: process.versions.electron, chrome: process.versions.chrome }))

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('open-file', (event, filePath) => {
    event.preventDefault(); queueFiles([filePath])
    if (app.isReady() && !mainWindow) createWindow()
  })
  app.on('second-instance', (_event, argv, cwd) => {
    queueFiles(collectImagePaths(argv, cwd))
    if (!mainWindow) createWindow()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(() => {
    protocol.handle('imejii', request => serveApp(request, path.join(__dirname, '..', 'dist'), net))
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(contents === mainWindow?.webContents && !details.isMainFrame ? false :
        contents === mainWindow?.webContents && ['clipboard-sanitized-write', 'fullscreen'].includes(permission))
    })
    session.defaultSession.setPermissionCheckHandler((contents, permission) =>
      contents === mainWindow?.webContents && ['clipboard-sanitized-write', 'fullscreen'].includes(permission))
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (details.webContentsId !== mainWindow?.webContents.id) return callback({ cancel: false })
      try {
        const url = new URL(details.url)
        const allowed = ['imejii:', 'blob:', 'data:'].includes(url.protocol) ||
          (DEV_SERVER_URL && ['http:', 'ws:'].includes(url.protocol) && url.host === new URL(DEV_SERVER_URL).host)
        callback({ cancel: !allowed })
      } catch { callback({ cancel: true }) }
    })
    pendingPaths.push(...collectImagePaths(process.argv, process.cwd()))
    buildMenu(); createWindow()
    app.on('activate', () => { if (!mainWindow) createWindow() })
  }).catch(error => { dialog.showErrorBox('Imejii startup failed', error.message); app.quit() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
