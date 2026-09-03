import { createZip, downloadBlob } from './download.js'

/**
 * Bruecke zur Desktop-Variante (Electron). Laeuft die App im Browser, greifen
 * automatisch die Web-Entsprechungen - der uebrige Code kennt den Unterschied nicht.
 */
const api = typeof window !== 'undefined' ? window.desktopApi : null

export const isDesktop = Boolean(api && api.isDesktop)

/** Wandelt die Rohdaten aus dem Hauptprozess in File-Objekte um. */
function toFiles(entries) {
  return (entries || []).map((entry) => {
    const file = new File([entry.buffer], entry.name, { type: entry.type })
    // Der File-Konstruktor kennt keinen Pfad - fuers Blaettern im Ordner
    // braucht der Betrachter ihn aber.
    if (entry.path) file.desktopPath = entry.path
    return file
  })
}

/**
 * Dateiauswahl ueber den Systemdialog.
 * @returns {Promise<File[]|null>} null bedeutet abgebrochen
 */
export async function pickImages({ multiple = true } = {}) {
  if (!isDesktop) return null
  const result = await api.openImages({ multiple })
  if (result.canceled) return null
  if (result.error) throw new Error(result.error)

  return toFiles(result.files)
}

/**
 * Dateien, mit denen die App geoeffnet wurde - etwa per Doppelklick im
 * Explorer. Im Browser gibt es sie nicht.
 * @returns {Promise<{files: File[], error: string|null}>}
 */
export async function getStartupFiles() {
  if (!isDesktop) return { files: [], error: null }
  const result = await api.getStartupFiles()
  return { files: toFiles(result.files), error: result.error }
}

/**
 * Dateien, die waehrend des Betriebs hereingereicht werden (zweite Instanz).
 * @returns {() => void} Funktion zum Abmelden
 */
export function onFilesOpened(handler) {
  if (!isDesktop) return () => {}
  return api.onFilesOpened((payload) =>
    handler({ files: toFiles(payload.files), error: payload.error }),
  )
}

/**
 * Bilder im Ordner einer Datei - alphabetisch, ohne die Inhalte zu lesen.
 * @returns {Promise<{dir: string, names: string[], separator: string}|null>} null im Browser
 */
export async function listFolderImages(filePath) {
  if (!isDesktop || !filePath) return null
  return api.listFolder(filePath)
}

/**
 * Bilder zu bekannten Pfaden nachladen.
 * @returns {Promise<{files: File[], error: string|null}>}
 */
export async function readImagesByPath(filePaths) {
  if (!isDesktop) return { files: [], error: null }
  const result = await api.readImages(filePaths)
  return { files: toFiles(result.files), error: result.error }
}

/**
 * Einzelne Datei sichern: im Desktop mit "Speichern unter", im Browser als Download.
 * @returns {Promise<{saved: boolean, path?: string}>}
 */
export async function saveBlob(blob, filename) {
  if (!isDesktop) {
    downloadBlob(blob, filename)
    return { saved: true }
  }

  const extension = (filename.split('.').pop() || '').toLowerCase()
  const result = await api.saveFile({
    defaultName: filename,
    extension,
    buffer: await blob.arrayBuffer(),
  })
  return result.canceled ? { saved: false } : { saved: true, path: result.path }
}

/**
 * Mehrere Dateien sichern. Auf dem Desktop wandern sie in einen gewaehlten
 * Ordner, im Browser in ein ZIP-Archiv.
 * @param {Array<{name: string, blob?: Blob, text?: string}>} files
 * @param {{zipName: string}} options
 * @returns {Promise<{mode: 'folder'|'zip'|'canceled', count: number, path?: string}>}
 */
export async function saveFileSet(files, { zipName }) {
  if (!files.length) return { mode: 'canceled', count: 0 }

  if (!isDesktop) {
    const zip = await createZip(files)
    downloadBlob(zip, zipName)
    return { mode: 'zip', count: files.length }
  }

  const folder = await api.selectFolder()
  if (folder.canceled) return { mode: 'canceled', count: 0 }

  for (const file of files) {
    const buffer = file.blob
      ? await file.blob.arrayBuffer()
      : new TextEncoder().encode(file.text || '').buffer
    await api.writeInto({ folder: folder.path, name: file.name, buffer })
  }

  return { mode: 'folder', count: files.length, path: folder.path }
}

/** Zeigt eine gespeicherte Datei im Dateimanager - nur auf dem Desktop. */
export function revealFile(filePath) {
  if (isDesktop && filePath) api.showItemInFolder(filePath)
}

/**
 * Menuebefehle des Hauptprozesses abonnieren.
 * @returns {() => void} Funktion zum Abmelden
 */
export function onMenuAction(handler) {
  if (!isDesktop) return () => {}
  return api.onMenuAction(handler)
}

export function getAppInfo() {
  return isDesktop ? api.getAppInfo() : Promise.resolve(null)
}
