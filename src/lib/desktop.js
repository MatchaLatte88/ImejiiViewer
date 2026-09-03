import { createZip, downloadBlob } from './download.js'
const api = typeof window !== 'undefined' ? window.desktopApi : null
export const isDesktop = Boolean(api?.isDesktop)

export function toFiles(entries) {
  return (entries || []).map(entry => {
    const file = entry.buffer
      ? new File([entry.buffer], entry.name, { type: entry.type, lastModified: entry.lastModified })
      : { name: entry.name, type: entry.type, size: entry.size, lastModified: entry.lastModified }
    if (entry.id) file.desktopId = entry.id
    return file
  })
}
export async function resolveImageFile(file) {
  if (file instanceof Blob) return file
  if (!isDesktop || !file?.desktopId) throw new Error('Image is no longer available.')
  const result = await api.readImages([file.desktopId])
  if (!result.files?.length) throw new Error(result.error || 'Unable to read image.')
  return toFiles(result.files)[0]
}
export async function adoptFiles(files) {
  const accepted = []
  const errors = []
  for (const file of files) {
    try {
      if (!isDesktop || file.desktopId) { accepted.push(file); continue }
      const result = await api.adoptFile(file)
      if (result.error) errors.push(result.error)
      if (result.files?.length) accepted.push(...toFiles(result.files))
      else if (!result.error) accepted.push(file)
    } catch (error) { errors.push(error.message) }
  }
  return { files: accepted, error: errors.join('; ') || null }
}
export async function pickImages({ multiple = true } = {}) {
  if (!isDesktop) return null
  const result = await api.openImages({ multiple })
  return result.canceled ? null : { files: toFiles(result.files), error: result.error }
}
export async function getStartupFiles() {
  if (!isDesktop) return { files: [], error: null }
  const result = await api.getStartupFiles()
  return { files: toFiles(result.files), error: result.error }
}
export function onFilesOpened(handler) {
  if (!isDesktop) return () => {}
  return api.onFilesOpened(payload => handler({ files: toFiles(payload.files), error: payload.error }))
}
export async function listFolderImages(id) {
  return isDesktop && id ? api.listFolder(id) : null
}
export async function readImagesById(ids) {
  if (!isDesktop) return { files: [], error: null }
  const result = await api.readImages(ids)
  return { files: toFiles(result.files), error: result.error }
}
export function confirmDiscard(message) {
  return isDesktop ? api.confirmDiscard(message) : Promise.resolve(window.confirm(message))
}
export async function saveBlob(blob, filename, { signal } = {}) {
  signal?.throwIfAborted()
  if (!isDesktop) { downloadBlob(blob, filename); return { saved: true } }
  const buffer = await blob.arrayBuffer()
  signal?.throwIfAborted()
  const result = await api.saveFile({
    defaultName: filename, extension: (filename.split('.').pop() || '').toLowerCase(),
    buffer,
  })
  return result.canceled ? { saved: false } : { saved: true, path: result.path }
}
export async function beginFileSet({ zipName }) {
  const target = isDesktop ? await api.selectFolder(zipName.replace(/\.zip$/i, '')) : null
  if (target?.canceled) return null
  const files = []
  let bytes = 0, count = 0, closed = false
  return {
    path: target?.path,
    async write(file) {
      if (closed) throw new Error('Export already closed.')
      const blob = file.blob || new Blob([file.text || ''], { type: 'text/plain' })
      if (isDesktop) await api.writeInto({ token: target.token, name: file.name, buffer: await blob.arrayBuffer() })
      else {
        bytes += blob.size
        if (bytes > 256 * 1024 * 1024) throw new Error('Browser ZIP limit is 256 MiB. Export fewer images or use the desktop app.')
        files.push({ name: file.name, blob })
      }
      count++
    },
    async finish({ canceled = false } = {}) {
      if (closed) return { mode: 'canceled', count, path: target?.path }
      closed = true
      if (isDesktop) return { ...await api.finishFileSet(target.token), mode: 'folder', canceled }
      if (!canceled && files.length) downloadBlob(await createZip(files), zipName)
      return { mode: canceled ? 'canceled' : 'zip', count }
    },
  }
}
export async function saveFileSet(files, options) {
  if (!files.length) return { mode: 'canceled', count: 0 }
  options.signal?.throwIfAborted()
  const session = await beginFileSet(options)
  if (!session) return { mode: 'canceled', count: 0 }
  try {
    for (const file of files) {
      options.signal?.throwIfAborted()
      await session.write(file)
    }
    options.signal?.throwIfAborted()
    return await session.finish()
  } catch (error) {
    const result = await session.finish({ canceled: true })
    throw new Error(error.message + (result.path ? ' Completed files kept in: ' + result.path : ''), { cause: error })
  }
}
export function revealFile(filePath) {
  return isDesktop && filePath ? api.showItemInFolder(filePath) : Promise.resolve()
}
export function onMenuAction(handler) {
  return isDesktop ? api.onMenuAction(handler) : () => {}
}
export function getAppInfo() {
  return isDesktop ? api.getAppInfo() : Promise.resolve(null)
}
