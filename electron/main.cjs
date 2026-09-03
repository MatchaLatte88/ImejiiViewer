const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

/** Im Entwicklungsmodus setzt das Startskript die Adresse des Vite-Servers. */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || ''
const isDev = Boolean(DEV_SERVER_URL)

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico']

const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

let mainWindow = null

// Dateien, die beim Start oder ueber eine zweite Instanz hereinkommen und noch
// kein Renderer abgeholt hat. Der Renderer meldet sich mit 'files:startup'.
let pendingPaths = []
let rendererReady = false

/**
 * Bildpfade aus einer Kommandozeile. Schalter und Argumente ohne Bildendung
 * (im Entwicklungsmodus etwa der Projektpfad ".") fallen weg.
 */
function collectImagePaths(argv, workingDirectory) {
  return argv
    .slice(1)
    .filter((arg) => typeof arg === 'string' && !arg.startsWith('-'))
    .map((arg) => path.resolve(workingDirectory || process.cwd(), arg))
    .filter((candidate) =>
      IMAGE_EXTENSIONS.includes(path.extname(candidate).slice(1).toLowerCase()),
    )
}

/**
 * Liest Bilddateien fuer den Renderer.
 * @returns {Promise<{files: Array, failed: string[]}>}
 */
async function readImageFiles(filePaths) {
  const files = []
  const failed = []

  for (const filePath of filePaths) {
    try {
      const data = await fs.readFile(filePath)
      const extension = path.extname(filePath).slice(1).toLowerCase()
      files.push({
        name: path.basename(filePath),
        path: filePath,
        type: MIME_BY_EXTENSION[extension] || '',
        buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      })
    } catch (error) {
      failed.push(filePath + ': ' + error.message)
    }
  }

  return { files, failed }
}

/**
 * Nimmt Dateien von aussen an - Doppelklick, "Oeffnen mit", Drag auf das Symbol.
 * Solange der Renderer noch nicht bereit ist, warten sie in pendingPaths.
 */
async function queueFiles(filePaths) {
  if (!filePaths.length) return

  if (!rendererReady || !mainWindow) {
    pendingPaths.push(...filePaths)
    return
  }

  const { files, failed } = await readImageFiles(filePaths)
  mainWindow.webContents.send('files:opened', { files, error: failed.join('; ') || null })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0d0f14',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  // Erst zeigen, wenn gerendert wurde - vermeidet ein weisses Aufblitzen.
  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Externe Links gehoeren in den Systembrowser, nicht in die App.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    const current = new URL(mainWindow.webContents.getURL())
    if (target.origin !== current.origin) {
      event.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Schickt eine Menueaktion an den Renderer, der sie auf den aktiven Modus anwendet. */
function sendMenuAction(action) {
  mainWindow?.webContents.send('menu:action', action)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File',
      submenu: [
        {
          label: 'Open images...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open'),
        },
        {
          label: 'Save current image...',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        { type: 'separator' },
        {
          label: 'View mode',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendMenuAction('mode:view'),
        },
        {
          label: 'Logo mode',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendMenuAction('mode:logo'),
        },
        {
          label: 'Image mode',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendMenuAction('mode:images'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuAction('redo') },
        { type: 'separator' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Toggle theme', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('theme') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About Logo Creator',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Logo Creator',
              message: 'Logo Creator ' + app.getVersion(),
              detail:
                'Cut out logos, build icon sets, view and convert images.\n' +
                'Electron ' + process.versions.electron + ' - Chromium ' + process.versions.chrome,
              buttons: ['OK'],
            })
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- IPC ------------------------------------------------------------------

/** Dateiauswahl. Der Inhalt wandert als ArrayBuffer in den Renderer. */
ipcMain.handle('dialog:openImages', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.multiple ? 'Open images' : 'Open image',
    properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [
      { name: 'Images', extensions: IMAGE_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  })

  if (result.canceled || !result.filePaths.length) return { canceled: true, files: [] }

  const { files, failed } = await readImageFiles(result.filePaths)
  if (failed.length) return { canceled: false, files, error: failed.join('; ') }
  return { canceled: false, files }
})

/**
 * Der Renderer holt beim Start die Dateien ab, mit denen die App geoeffnet
 * wurde. Danach kommen weitere Dateien per 'files:opened' herein.
 */
ipcMain.handle('files:startup', async () => {
  rendererReady = true
  const filePaths = pendingPaths
  pendingPaths = []

  const { files, failed } = await readImageFiles(filePaths)
  return { files, error: failed.join('; ') || null }
})

/**
 * Bilder im Ordner einer Datei - Grundlage fuers Blaettern im Betrachter.
 * Es wandern nur die Namen in den Renderer, nicht die Inhalte.
 */
ipcMain.handle('folder:list', async (_event, filePath) => {
  const dir = path.dirname(filePath)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const names = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        IMAGE_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

  return { dir, names, separator: path.sep }
})

/** Bilder zu bekannten Pfaden nachladen - der Betrachter holt so die Nachbarbilder. */
ipcMain.handle('files:read', async (_event, filePaths) => {
  const { files, failed } = await readImageFiles(filePaths || [])
  return { files, error: failed.join('; ') || null }
})

/** Speichern unter - ersetzt den Browser-Download durch einen echten Dialog. */
ipcMain.handle('dialog:saveFile', async (_event, { defaultName, buffer, extension }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save file',
    defaultPath: defaultName,
    filters: extension
      ? [{ name: extension.toUpperCase(), extensions: [extension] }, { name: 'All files', extensions: ['*'] }]
      : undefined,
  })

  if (result.canceled || !result.filePath) return { canceled: true }

  await fs.writeFile(result.filePath, Buffer.from(buffer))
  return { canceled: false, path: result.filePath }
})

/** Zielordner fuer den Stapelexport - schreibt die Dateien einzeln statt als ZIP. */
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
})

ipcMain.handle('file:writeInto', async (_event, { folder, name, buffer }) => {
  const target = path.join(folder, name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, Buffer.from(buffer))
  return { path: target }
})

ipcMain.handle('shell:showItem', async (_event, filePath) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
}))

// --- Lebenszyklus ---------------------------------------------------------

// Nur eine Instanz - ein zweiter Start holt das vorhandene Fenster nach vorn.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // macOS reicht Dateien ueber dieses Ereignis herein - es kann vor 'ready' feuern.
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    queueFiles([filePath])
  })

  app.on('second-instance', (_event, argv, workingDirectory) => {
    queueFiles(collectImagePaths(argv, workingDirectory))
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    // Windows und Linux uebergeben die Datei als Argument des ersten Starts.
    pendingPaths.push(...collectImagePaths(process.argv, process.cwd()))

    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
