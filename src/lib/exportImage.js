import { createCanvas, resizeCanvas } from './transform.js'

export const EXPORT_FORMATS = {
  png: { mime: 'image/png', extension: 'png', label: 'PNG', supportsAlpha: true },
  webp: { mime: 'image/webp', extension: 'webp', label: 'WebP', supportsAlpha: true },
  jpeg: { mime: 'image/jpeg', extension: 'jpg', label: 'JPG', supportsAlpha: false },
}

/** Canvas -> Blob. Wirft, wenn der Browser das Format nicht kodieren kann. */
export function canvasToBlob(canvas, format = 'png', quality = 0.92) {
  const config = EXPORT_FORMATS[format] || EXPORT_FORMATS.png
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Export failed: ' + config.label + ' is not supported.'))
          return
        }
        resolve(blob)
      },
      config.mime,
      quality,
    )
  })
}

/**
 * Rendert das Ergebnis in eine Zielgroesse.
 * @param {HTMLCanvasElement} source
 * @param {number} width
 * @param {number} height
 * @param {{fit?: 'contain'|'cover', background?: string|null}} [options]
 */
export function renderToSize(source, width, height, options = {}) {
  const fit = options.fit || 'contain'
  const background = options.background || null

  if (!background) return resizeCanvas(source, width, height, fit)

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(resizeCanvas(source, width, height, fit), 0, 0)
  return canvas
}

/** Menschenlesbare Dateigroesse - fuer Live-Schaetzungen neben dem Qualitaetsregler. */
export function formatBytes(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/** Dateiname ohne Erweiterung, auf sichere Zeichen reduziert. */
export function slugify(name) {
  return (
    (name || 'logo')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'logo'
  )
}

/**
 * Erzeugt fuer jede Groesse einen Blob.
 * @returns {Promise<Array<{name: string, size: number, blob: Blob}>>}
 */
export async function renderSizeSet(source, sizes, options = {}) {
  const format = options.format || 'png'
  const quality = options.quality ?? 0.92
  const baseName = options.baseName || 'logo'
  const config = EXPORT_FORMATS[format] || EXPORT_FORMATS.png
  const background = config.supportsAlpha ? options.background || null : options.background || '#ffffff'

  const results = []
  for (const size of sizes) {
    const width = typeof size === 'number' ? size : size.width
    const height = typeof size === 'number' ? size : size.height
    const label = typeof size === 'number' ? null : size.name
    const canvas = renderToSize(source, width, height, { fit: options.fit, background })
    const blob = await canvasToBlob(canvas, format, quality)
    results.push({
      name: label || baseName + '-' + width + 'x' + height + '.' + config.extension,
      size: width,
      width,
      height,
      blob,
    })
  }
  return results
}
