import { decodeViaImageElement, isSupportedFile } from './imageLoader.js'
import { orientationTransform, readExif } from './exif.js'
import { createCanvas } from './transform.js'

/** Nur der Dateianfang wird nach EXIF durchsucht - mehr braucht APP1 nie. */
const EXIF_SCAN_BYTES = 256 * 1024

/** Kantenlaenge der Vorschaubilder in der Bibliotheksleiste. */
export const THUMBNAIL_SIZE = 240

export { isSupportedFile }

async function readOrientation(file) {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name || '')) return { exif: null, orientation: 1 }
  try {
    const head = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer()
    const exif = readExif(head)
    return { exif, orientation: exif?.orientation || 1 }
  } catch {
    return { exif: null, orientation: 1 }
  }
}

/**
 * Zeichnet ein dekodiertes Bild unter Beruecksichtigung der EXIF-Ausrichtung.
 * @returns {HTMLCanvasElement}
 */
function drawOriented(img, width, height, orientation) {
  const { swap, transform } = orientationTransform(orientation)
  const canvas = createCanvas(swap ? height : width, swap ? width : height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  transform(ctx, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

/**
 * Liest Kopfdaten und erzeugt ein Vorschaubild - laeuft beim Hinzufuegen zur
 * Bibliothek. Das Vollbild bleibt bewusst ungeladen (Speicher).
 */
export async function readPhotoInfo(file) {
  if (!isSupportedFile(file)) {
    throw new Error('Unsupported format: ' + (file?.name || 'unknown'))
  }

  const { exif, orientation } = await readOrientation(file)
  const url = URL.createObjectURL(file)
  try {
    const img = await decodeViaImageElement(url)
    const naturalWidth = img.naturalWidth || img.width || 1
    const naturalHeight = img.naturalHeight || img.height || 1
    const swap = orientation >= 5 && orientation <= 8

    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(naturalWidth, naturalHeight))
    const thumbCanvas = drawOriented(
      img,
      Math.max(1, Math.round(naturalWidth * scale)),
      Math.max(1, Math.round(naturalHeight * scale)),
      orientation,
    )

    return {
      name: file.name || 'image',
      type: file.type || '',
      size: file.size || 0,
      lastModified: file.lastModified || Date.now(),
      width: swap ? naturalHeight : naturalWidth,
      height: swap ? naturalWidth : naturalHeight,
      orientation,
      exif,
      thumbnail: thumbCanvas.toDataURL('image/png'),
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Dekodiert eine Datei in voller (oder begrenzter) Aufloesung.
 * @param {File} file
 * @param {{maxSize?: number, orientation?: number}} options
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function decodePhoto(file, { maxSize = 0, orientation = 1 } = {}) {
  const url = URL.createObjectURL(file)
  try {
    const img = await decodeViaImageElement(url)
    let width = img.naturalWidth || img.width || 1
    let height = img.naturalHeight || img.height || 1

    if (maxSize) {
      const longest = Math.max(width, height)
      if (longest > maxSize) {
        const factor = maxSize / longest
        width = Math.max(1, Math.round(width * factor))
        height = Math.max(1, Math.round(height * factor))
      }
    }

    return drawOriented(img, width, height, orientation)
  } finally {
    URL.revokeObjectURL(url)
  }
}
