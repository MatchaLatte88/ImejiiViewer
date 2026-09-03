const { contextBridge, ipcRenderer } = require('electron')

/**
 * Schmale, klar umrissene Bruecke in den Main-Prozess. Der Renderer bekommt
 * keinen Zugriff auf Node - nur auf diese Funktionen.
 */
contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,

  openImages: (options) => ipcRenderer.invoke('dialog:openImages', options || {}),

  saveFile: (payload) => ipcRenderer.invoke('dialog:saveFile', payload),

  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  writeInto: (payload) => ipcRenderer.invoke('file:writeInto', payload),

  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),

  getAppInfo: () => ipcRenderer.invoke('app:info'),

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
