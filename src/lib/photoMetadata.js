import { parse } from 'exifr'
import { SRGB_PROFILE } from './colorProfiles.js'

const cached = new WeakMap()
export const DEFAULT_METADATA = { keepCamera: true, keepGps: false, artist: '', copyright: '' }
async function exifInput(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (String.fromCharCode(...head.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...head.subarray(8, 12)) !== 'WEBP') return file
  for (let at = 12, count = 0; at + 8 <= file.size && count < 10000; count++) {
    const header = new Uint8Array(await file.slice(at, at + 8).arrayBuffer()), length = new DataView(header.buffer).getUint32(4, true)
    if (at + 8 + length > file.size) throw new Error('Invalid WebP metadata chunk.')
    if (String.fromCharCode(...header.subarray(0, 4)) === 'EXIF') {
      if (length > 2 * 1024 ** 2) throw new Error('WebP EXIF exceeds the metadata limit.')
      const bytes = new Uint8Array(await file.slice(at + 8, at + 8 + length).arrayBuffer())
      return String.fromCharCode(...bytes.subarray(0, 6)) === 'Exif\0\0' ? bytes.subarray(6) : bytes
    }
    at += 8 + length + length % 2
  }
  return null
}
export function readPhotoMetadata(file) {
  if (!cached.has(file)) cached.set(file, exifInput(file).then(input => input ? parse(input, {
    tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false,
    translateValues: false, reviveValues: false,
  }) : {}).then(result => result || {}).catch(() => ({})))
  return cached.get(file)
}
export function displayMetadata(raw) {
  return {
    make: raw.Make, model: raw.Model, orientation: raw.Orientation || 1,
    dateTimeOriginal: raw.DateTimeOriginal, dateTime: raw.ModifyDate,
    exposureTime: raw.ExposureTime, fNumber: raw.FNumber, iso: raw.ISO,
    focalLength: raw.FocalLength, software: raw.Software,
  }
}
const ascii = value => String(value ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 255) + '\0'
const tag = (id, type, values) => ({ id, type, values: typeof values === 'string' ? Array.from(values, c => c.charCodeAt(0)) : Array.from(values) })
const rational = value => [Math.round(Math.abs(Number(value)) * 1000000), 1000000]
function metadataTags(raw, options, width, height) {
  const root = [tag(274, 3, [1]), tag(305, 2, ascii('Imejii'))]
  const exif = [tag(40961, 3, [1]), tag(40962, 4, [width]), tag(40963, 4, [height])]
  const gps = []
  if (options.keepCamera) {
    for (const [id, key] of [[271, 'Make'], [272, 'Model'], [306, 'ModifyDate']]) if (raw[key]) root.push(tag(id, 2, ascii(raw[key])))
    for (const [id, key] of [[36867, 'DateTimeOriginal'], [36868, 'CreateDate'], [42036, 'LensModel']]) if (raw[key]) exif.push(tag(id, 2, ascii(raw[key])))
    for (const [id, key] of [[33434, 'ExposureTime'], [33437, 'FNumber'], [37386, 'FocalLength']]) if (Number.isFinite(raw[key]) && raw[key] > 0 && raw[key] < 4294) exif.push(tag(id, 5, rational(raw[key])))
    if (Number.isFinite(raw.ISO)) exif.push(tag(34855, 3, [Math.max(0, Math.min(65535, raw.ISO))]))
  }
  const artist = options.artist || (options.keepCamera ? raw.Artist : '')
  const copyright = options.copyright || (options.keepCamera ? raw.Copyright : '')
  if (artist) root.push(tag(315, 2, ascii(artist)))
  if (copyright) root.push(tag(33432, 2, ascii(copyright)))
  if (options.keepGps) {
    for (const [id, key, refId, refKey] of [[2, 'GPSLatitude', 1, 'GPSLatitudeRef'], [4, 'GPSLongitude', 3, 'GPSLongitudeRef']]) {
      const values = raw[key]
      if (Array.isArray(values) && values.length === 3 && values.every(v => Number.isFinite(v) && v >= 0) && values[0] <= (id === 2 ? 90 : 180) && values[1] < 60 && values[2] < 60 && (id === 2 ? ['N', 'S'] : ['E', 'W']).includes(raw[refKey])) {
        gps.push(tag(id, 5, values.flatMap(rational)), tag(refId, 2, ascii(raw[refKey])))
      }
    }
    if (gps.length) gps.push(tag(0, 1, [2, 3, 0, 0]))
  }
  return { root, exif, gps }
}
// Small allow-list EXIF writer. Never copies source thumbnails, MakerNotes, XMP,
// orientation or profile tags that would describe the unedited source incorrectly.
export function encodePhotoTiff(raw = {}, options = {}, width = 1, height = 1, rgba = null) {
  const { root, exif, gps } = metadataTags(raw, { ...DEFAULT_METADATA, ...options }, width, height)
  if (rgba) root.push(tag(256, 4, [width]), tag(257, 4, [height]), tag(258, 3, [8, 8, 8, 8]), tag(259, 3, [1]), tag(262, 3, [2]), tag(273, 4, [0]), tag(277, 3, [4]), tag(278, 4, [height]), tag(279, 4, [rgba.length]), tag(284, 3, [1]), tag(338, 3, [2]), tag(34675, 7, SRGB_PROFILE))
  root.push(tag(34665, 4, [0]))
  if (gps.length) root.push(tag(34853, 4, [0]))
  const groups = [root, exif, ...(gps.length ? [gps] : [])]
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 7: 1 }
  let end = 8
  const offsets = groups.map(group => { const offset = end; end += 2 + group.length * 12 + 4; return offset })
  root.find(t => t.id === 34665).values[0] = offsets[1]
  if (gps.length) root.find(t => t.id === 34853).values[0] = offsets[2]
  const extra = []
  for (const group of groups) for (const item of group) if (item.values.length * sizes[item.type] > 4) {
    item.offset = end; extra.push(item); end += item.values.length * sizes[item.type]; if (end % 2) end++
  }
  if (rgba) root.find(t => t.id === 273).values[0] = end
  const bytes = new Uint8Array(end + (rgba?.length || 0)), view = new DataView(bytes.buffer)
  bytes.set([73, 73, 42, 0, 8, 0, 0, 0])
  const writeValues = (item, offset) => item.values.forEach((v, i) => {
    const size = sizes[item.type], position = offset + i * size
    if (size === 1) view.setUint8(position, v)
    else if (size === 2) view.setUint16(position, v, true)
    else view.setUint32(position, v, true)
  })
  groups.forEach((group, index) => {
    group.sort((a, b) => a.id - b.id)
    view.setUint16(offsets[index], group.length, true)
    group.forEach((item, i) => {
      const position = offsets[index] + 2 + i * 12
      view.setUint16(position, item.id, true); view.setUint16(position + 2, item.type, true)
      view.setUint32(position + 4, item.values.length / (item.type === 5 ? 2 : 1), true)
      if (item.offset) view.setUint32(position + 8, item.offset, true)
      else writeValues(item, position + 8)
    })
  })
  for (const item of extra) writeValues(item, item.offset)
  if (rgba) bytes.set(rgba, end)
  return bytes
}
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}
const encodeText = text => new TextEncoder().encode(text)
export function pngChunk(type, data) {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
  view.setUint32(0, data.length); result.set(encodeText(type), 4); result.set(data, 8)
  view.setUint32(result.length - 4, crc32(result.subarray(4, -4)))
  return result
}
export async function pngWithProfile(blob, profile = SRGB_PROFILE, exif = null) {
  const compressed = new Uint8Array(await new Response(new Blob([profile]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const data = new Uint8Array(5 + compressed.length); data.set([73, 67, 67, 0, 0], 0); data.set(compressed, 5)
  // 4-byte name including NUL, compression method, then compressed profile.
  const icc = pngChunk('iCCP', data)
  const bytes = new Uint8Array(await blob.arrayBuffer()), chunks = [bytes.subarray(0, 33), icc]
  if (exif) chunks.push(pngChunk('eXIf', exif))
  let offset = 33
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer).getUint32(offset), end = offset + length + 12
    if (end > bytes.length) throw new Error('Invalid PNG export.')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (!['iCCP', 'sRGB', 'gAMA', 'cHRM', 'eXIf'].includes(type)) chunks.push(bytes.subarray(offset, end))
    offset = end
  }
  return new Blob(chunks, { type: 'image/png' })
}
function jpegSegment(marker, data) {
  if (data.length > 65533) throw new Error('Metadata is too large for JPEG.')
  const bytes = new Uint8Array(data.length + 4)
  bytes.set([255, marker]); new DataView(bytes.buffer).setUint16(2, data.length + 2); bytes.set(data, 4)
  return bytes
}
function webpChunk(type, data) {
  const bytes = new Uint8Array(8 + data.length + data.length % 2)
  bytes.set(encodeText(type)); new DataView(bytes.buffer).setUint32(4, data.length, true); bytes.set(data, 8)
  return bytes
}
export async function decoratePhotoBlob(blob, width, height, raw = {}, options = {}) {
  const exif = encodePhotoTiff(raw, options, width, height)
  if (blob.type === 'image/png') return pngWithProfile(blob, SRGB_PROFILE, exif)
  if (blob.type === 'image/jpeg') {
    const icc = new Uint8Array(14 + SRGB_PROFILE.length); icc.set(encodeText('ICC_PROFILE\0')); icc.set([1, 1], 12); icc.set(SRGB_PROFILE, 14)
    const metadata = new Uint8Array(6 + exif.length); metadata.set(encodeText('Exif\0\0')); metadata.set(exif, 6)
    return new Blob([blob.slice(0, 2), jpegSegment(225, metadata), jpegSegment(226, icc), blob.slice(2)], { type: blob.type })
  }
  if (blob.type === 'image/webp') {
    const bytes = new Uint8Array(await blob.arrayBuffer()), chunks = [], extended = new Uint8Array(10)
    extended[0] = 0x28
    for (let i = 0; i < 3; i++) { extended[4 + i] = (width - 1) >>> (i * 8); extended[7 + i] = (height - 1) >>> (i * 8) }
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const type = String.fromCharCode(...bytes.subarray(offset, offset + 4)), size = new DataView(bytes.buffer).getUint32(offset + 4, true), end = offset + 8 + size + size % 2
      if (end > bytes.length) throw new Error('Invalid WebP export.')
      if (type === 'VP8X') extended[0] |= bytes[offset + 8] & 0x10
      else if (!['EXIF', 'ICCP', 'XMP '].includes(type)) {
        if (type === 'ALPH' || (type === 'VP8L' && (bytes[offset + 12] & 16))) extended[0] |= 0x10
        chunks.push(bytes.subarray(offset, end))
      }
      offset = end
    }
    const parts = [webpChunk('VP8X', extended), webpChunk('ICCP', SRGB_PROFILE), ...chunks, webpChunk('EXIF', exif)]
    const head = new Uint8Array(12); head.set(encodeText('RIFF')); head.set(encodeText('WEBP'), 8)
    new DataView(head.buffer).setUint32(4, 4 + parts.reduce((sum, part) => sum + part.length, 0), true)
    return new Blob([head, ...parts], { type: blob.type })
  }
  return blob
}
