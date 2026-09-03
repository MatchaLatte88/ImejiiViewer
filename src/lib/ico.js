import { canvasToBlob, renderToSize } from './exportImage.js'

/** ICO erlaubt maximal 256 px Kantenlaenge pro eingebettetem Bild. */
export const ICO_MAX_SIZE = 256

export const DEFAULT_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * Baut eine .ico-Datei mit eingebetteten PNGs (Vista+ Format).
 *
 * Aufbau: 6 Byte Header, danach je 16 Byte Verzeichniseintrag pro Bild,
 * anschliessend die PNG-Daten am jeweils angegebenen Offset.
 *
 * @param {HTMLCanvasElement} source fertig verarbeitetes Bild
 * @param {number[]} sizes Kantenlaengen (<= 256)
 * @returns {Promise<Blob>}
 */
export async function createIcoBlob(source, sizes = DEFAULT_ICO_SIZES) {
  const unique = [...new Set(sizes.map((s) => Math.min(ICO_MAX_SIZE, Math.round(s))))]
    .filter((s) => s > 0)
    .sort((a, b) => a - b)

  if (!unique.length) throw new Error('The ICO export needs at least one size.')

  const images = []
  for (const size of unique) {
    const blob = await canvasToBlob(renderToSize(source, size, size), 'png')
    images.push({ size, buffer: new Uint8Array(await blob.arrayBuffer()) })
  }

  const headerSize = 6
  const directorySize = 16 * images.length
  const totalSize = headerSize + directorySize + images.reduce((sum, i) => sum + i.buffer.length, 0)

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint16(0, 0, true) // reserviert
  view.setUint16(2, 1, true) // Typ 1 = Icon
  view.setUint16(4, images.length, true)

  let offset = headerSize + directorySize
  images.forEach((image, index) => {
    const entry = headerSize + index * 16
    // 256 wird als 0 kodiert.
    view.setUint8(entry, image.size >= 256 ? 0 : image.size)
    view.setUint8(entry + 1, image.size >= 256 ? 0 : image.size)
    view.setUint8(entry + 2, 0) // Palettenfarben
    view.setUint8(entry + 3, 0) // reserviert
    view.setUint16(entry + 4, 1, true) // Farbebenen
    view.setUint16(entry + 6, 32, true) // Bit pro Pixel
    view.setUint32(entry + 8, image.buffer.length, true)
    view.setUint32(entry + 12, offset, true)

    bytes.set(image.buffer, offset)
    offset += image.buffer.length
  })

  return new Blob([buffer], { type: 'image/x-icon' })
}
