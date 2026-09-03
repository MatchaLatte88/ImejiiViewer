/** Loest einen Datei-Download im Browser aus. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Etwas Luft lassen, bevor die URL freigegeben wird - sonst bricht der Download in Safari ab.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Packt Dateien in ein ZIP-Archiv. JSZip wird erst bei Bedarf geladen.
 * @param {Array<{name: string, blob?: Blob, text?: string}>} files
 * @returns {Promise<Blob>}
 */
export async function createZip(files) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const file of files) {
    if (file.blob) zip.file(file.name, file.blob, { compression: 'STORE' })
    else if (typeof file.text === 'string') zip.file(file.name, file.text)
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, exponent)
  return (exponent === 0 ? value : value.toFixed(value < 10 ? 1 : 0)) + ' ' + units[exponent]
}
