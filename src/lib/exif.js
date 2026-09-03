/**
 * Minimaler EXIF-Leser fuer JPEG (APP1/TIFF). Liest nur die Felder, die im
 * Viewer angezeigt werden - bewusst ohne externe Abhaengigkeit.
 */

const TAGS = {
  0x010f: 'make',
  0x0110: 'model',
  0x0112: 'orientation',
  0x011a: 'xResolution',
  0x0132: 'dateTime',
  0x829a: 'exposureTime',
  0x829d: 'fNumber',
  0x8827: 'iso',
  0x9003: 'dateTimeOriginal',
  0x920a: 'focalLength',
  0xa002: 'pixelXDimension',
  0xa003: 'pixelYDimension',
  0xa430: 'ownerName',
  0x0131: 'software',
  0x8769: 'exifOffset',
}

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

/**
 * @param {ArrayBuffer} buffer komplette Datei (oder die ersten ~128 KB)
 * @returns {object|null} gefundene Felder oder null, wenn kein EXIF vorhanden
 */
export function readExif(buffer) {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null // kein JPEG

  let offset = 2
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset, false)
    if ((marker & 0xff00) !== 0xff00) break
    const size = view.getUint16(offset + 2, false)

    if (marker === 0xffe1) {
      const start = offset + 4
      // "Exif\0\0"
      if (view.getUint32(start, false) !== 0x45786966) return null
      return parseTiff(view, start + 6)
    }

    if (marker === 0xffda) break // Beginn der Bilddaten
    offset += 2 + size
  }
  return null
}

function parseTiff(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return null
  const little = view.getUint16(tiffStart, false) === 0x4949
  if (view.getUint16(tiffStart + 2, little) !== 42) return null

  const result = {}
  const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little)
  readDirectory(view, ifd0, tiffStart, little, result)

  if (result.exifOffset) {
    readDirectory(view, tiffStart + result.exifOffset, tiffStart, little, result)
    delete result.exifOffset
  }
  return Object.keys(result).length ? result : null
}

function readDirectory(view, dirStart, tiffStart, little, target) {
  if (dirStart + 2 > view.byteLength) return
  const entries = view.getUint16(dirStart, little)

  for (let i = 0; i < entries; i++) {
    const entry = dirStart + 2 + i * 12
    if (entry + 12 > view.byteLength) return

    const tag = view.getUint16(entry, little)
    const name = TAGS[tag]
    if (!name) continue

    const type = view.getUint16(entry + 2, little)
    const count = view.getUint32(entry + 4, little)
    const byteLength = (TYPE_SIZES[type] || 0) * count
    if (!byteLength) continue

    const valueOffset =
      byteLength <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little)
    if (valueOffset + byteLength > view.byteLength) continue

    target[name] = readValue(view, valueOffset, type, count, little)
  }
}

function readValue(view, offset, type, count, little) {
  switch (type) {
    case 1:
    case 7:
      return view.getUint8(offset)
    case 2: {
      let text = ''
      for (let i = 0; i < count - 1; i++) text += String.fromCharCode(view.getUint8(offset + i))
      return text.trim()
    }
    case 3:
      return view.getUint16(offset, little)
    case 4:
      return view.getUint32(offset, little)
    case 5: {
      const numerator = view.getUint32(offset, little)
      const denominator = view.getUint32(offset + 4, little)
      return denominator ? numerator / denominator : 0
    }
    case 10: {
      const numerator = view.getInt32(offset, little)
      const denominator = view.getInt32(offset + 4, little)
      return denominator ? numerator / denominator : 0
    }
    default:
      return null
  }
}

/**
 * Bereitet die Rohwerte fuer die Anzeige auf.
 * @returns {Array<{label: string, value: string}>}
 */
export function formatExif(exif) {
  if (!exif) return []
  const rows = []
  const push = (label, value) => {
    if (value !== undefined && value !== null && value !== '') rows.push({ label, value: String(value) })
  }

  push('Camera', [exif.make, exif.model].filter(Boolean).join(' '))
  push('Software', exif.software)
  const taken = exif.dateTimeOriginal || exif.dateTime
  push('Taken', taken ? taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : null)
  if (exif.exposureTime) {
    push(
      'Exposure',
      exif.exposureTime >= 1
        ? exif.exposureTime.toFixed(1) + ' s'
        : '1/' + Math.round(1 / exif.exposureTime) + ' s',
    )
  }
  if (exif.fNumber) push('Aperture', 'f/' + exif.fNumber.toFixed(1))
  push('ISO', exif.iso)
  if (exif.focalLength) push('Focal length', Math.round(exif.focalLength) + ' mm')

  return rows
}

/**
 * EXIF-Orientation (1..8) als Canvas-Transformation.
 * @returns {{swap: boolean, transform: (ctx: CanvasRenderingContext2D, w: number, h: number) => void}}
 */
export function orientationTransform(orientation) {
  const swap = orientation >= 5 && orientation <= 8
  return {
    swap,
    transform(ctx, width, height) {
      switch (orientation) {
        case 2:
          ctx.transform(-1, 0, 0, 1, width, 0)
          break
        case 3:
          ctx.transform(-1, 0, 0, -1, width, height)
          break
        case 4:
          ctx.transform(1, 0, 0, -1, 0, height)
          break
        case 5:
          ctx.transform(0, 1, 1, 0, 0, 0)
          break
        case 6:
          ctx.transform(0, 1, -1, 0, height, 0)
          break
        case 7:
          ctx.transform(0, -1, -1, 0, height, width)
          break
        case 8:
          ctx.transform(0, -1, 1, 0, 0, width)
          break
        default:
          break
      }
    },
  }
}
