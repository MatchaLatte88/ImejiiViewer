import { decodeViaImageElement, isSupportedFile } from './imageLoader.js'
import { readExif } from './exif.js'
import { createCanvas } from './transform.js'
import { resolveImageFile } from './desktop.js'
import { checkImageFile, checkDimensions } from './imageLimits.js'

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
function drawOriented(img, width, height) {
  // HTMLImageElement has already applied EXIF orientation, including mirroring.
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

/**
 * Liest Kopfdaten und erzeugt ein Vorschaubild - laeuft beim Hinzufuegen zur
 * Bibliothek. Der Browser dekodiert für die Vorschau; nur das Thumbnail und
 * (auf dem Desktop) ein Datei-Handle bleiben danach in der Bibliothek.
 */
export async function readPhotoInfo(file) {
  if (!isSupportedFile(file)) {
    throw new Error('Unsupported format: ' + (file?.name || 'unknown'))
  }

  file = await resolveImageFile(file)
  await checkImageFile(file)
  const { exif, orientation } = await readOrientation(file)
  const url = URL.createObjectURL(file)
  try {
    const img = await decodeViaImageElement(url)
    const naturalWidth = img.naturalWidth || img.width || 1
    const naturalHeight = img.naturalHeight || img.height || 1
    checkDimensions(naturalWidth, naturalHeight)

    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(naturalWidth, naturalHeight))
    const thumbCanvas = drawOriented(
      img,
      Math.max(1, Math.round(naturalWidth * scale)),
      Math.max(1, Math.round(naturalHeight * scale)),
    )

    return {
      name: file.name || 'image',
      type: file.type || '',
      size: file.size || 0,
      lastModified: file.lastModified || Date.now(),
      width: naturalWidth,
      height: naturalHeight,
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
export async function decodePhoto(file, { maxSize = 0 } = {}) {
  file = await resolveImageFile(file)
  await checkImageFile(file)
  const url = URL.createObjectURL(file)
  try {
    const img = await decodeViaImageElement(url)
    let width = img.naturalWidth || img.width || 1
    let height = img.naturalHeight || img.height || 1

    checkDimensions(width, height)
    if (maxSize) {
      const longest = Math.max(width, height)
      if (longest > maxSize) {
        const factor = maxSize / longest
        width = Math.max(1, Math.round(width * factor))
        height = Math.max(1, Math.round(height * factor))
      }
    }

    return drawOriented(img, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}
