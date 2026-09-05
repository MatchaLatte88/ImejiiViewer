const { contextBridge, ipcRenderer, webUtils } = require('electron')

/**
 * Schmale, klar umrissene Bruecke in den Main-Prozess. Der Renderer bekommt
 * keinen Zugriff auf Node - nur auf diese Funktionen.
 */
contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,

  openImages: (options) => ipcRenderer.invoke('dialog:openImages', options || {}),

  saveFile: (payload) => ipcRenderer.invoke('dialog:saveFile', payload),

  selectFolder: (name) => ipcRenderer.invoke('dialog:selectFolder', name),
  finishFileSet: (token) => ipcRenderer.invoke('file:finishSet', token),
  confirmDiscard: (message) => ipcRenderer.invoke('dialog:confirmDiscard', message),
  adoptFile: (file) => {
    const filePath = webUtils.getPathForFile(file)
    return filePath ? ipcRenderer.invoke('files:adopt', filePath) : Promise.resolve({ files: [], error: null })
  },

  writeInto: (payload) => ipcRenderer.invoke('file:writeInto', payload),

  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),

  getAppInfo: () => ipcRenderer.invoke('app:info'),

  aiModelStatus: id => ipcRenderer.invoke('ai:model-status', id),
  aiModelInstall: id => ipcRenderer.invoke('ai:model-install', id),
  aiModelRead: id => ipcRenderer.invoke('ai:model-read', id),
  aiModelRemove: id => ipcRenderer.invoke('ai:model-remove', id),
  aiModelCancel: id => ipcRenderer.invoke('ai:model-cancel', id),
  aiCutoutRun: payload => ipcRenderer.invoke('ai:cutout-run', payload),
  aiCutoutCancel: id => ipcRenderer.invoke('ai:cutout-cancel', id),
  aiStudioConnect: config => ipcRenderer.invoke('ai:studio-connect', config),
  aiStudioRun: payload => ipcRenderer.invoke('ai:studio-run', payload),
  aiStudioCancel: id => ipcRenderer.invoke('ai:studio-cancel', id),
  aiStudioDisconnect: () => ipcRenderer.invoke('ai:studio-disconnect'),
  onAiStudioProgress: handler => {
    const listener = (_event, progress) => handler(progress)
    ipcRenderer.on('ai:studio-progress', listener)
    return () => ipcRenderer.off('ai:studio-progress', listener)
  },
  onAiCutoutProgress: handler => {
    const listener = (_event, progress) => handler(progress)
    ipcRenderer.on('ai:cutout-progress', listener)
    return () => ipcRenderer.off('ai:cutout-progress', listener)
  },
  onAiModelProgress: handler => {
    const listener = (_event, progress) => handler(progress)
    ipcRenderer.on('ai:model-progress', listener)
    return () => ipcRenderer.off('ai:model-progress', listener)
  },

  /** Dateien, mit denen die App geoeffnet wurde ("Oeffnen mit", Doppelklick). */
  getStartupFiles: () => ipcRenderer.invoke('files:startup'),

  /** Bildnamen im Ordner einer Datei - fuers Blaettern im Betrachter. */
  listFolder: (filePath) => ipcRenderer.invoke('folder:list', filePath),

  /** Bilder zu bekannten Pfaden nachladen. */
  readImages: (filePaths) => ipcRenderer.invoke('files:read', filePaths),

  /** Spaeter hereingereichte Dateien. Gibt eine Funktion zum Abmelden zurueck. */
  onFilesOpened: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('files:opened', listener)
    return () => ipcRenderer.off('files:opened', listener)
  },

  /** Menuebefehle. Gibt eine Funktion zum Abmelden zurueck. */
  onMenuAction: (handler) => {
    const listener = (_event, action) => handler(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.off('menu:action', listener)
  },
})
