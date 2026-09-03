export const MAX_IMAGE_BYTES = 128 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export const MAX_IMAGE_EDGE = 16384
export function checkDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
      width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('Image exceeds the safety limit: 40 megapixels or 16,384 pixels per edge.')
  }
}
export async function checkImageFile(file) {
  if (!file?.size || file.size > MAX_IMAGE_BYTES) throw new Error('Image must be non-empty and at most 128 MiB.')
  // Reject oversized common raster headers before invoking the browser decoder.
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const view = new DataView(bytes.buffer)
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    checkDimensions(view.getUint32(16), view.getUint32(20))
  } else if (bytes.length >= 10 && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') {
    checkDimensions(view.getUint16(6, true), view.getUint16(8, true))
  } else if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
    const dib = view.getUint32(14, true)
    if (dib === 12) checkDimensions(view.getUint16(18, true), view.getUint16(20, true))
    else if (dib >= 40) checkDimensions(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)))
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 8 < bytes.length && bytes[offset] === 255) {
      const marker = bytes[offset + 1]
      if (marker === 218 || marker === 217) break
      if (marker === 255) { offset++; continue }
      const length = view.getUint16(offset + 2)
      if (length < 2) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        checkDimensions(view.getUint16(offset + 7), view.getUint16(offset + 5)); break
      }
      offset += 2 + length
    }
  }
}
