import UTIF from 'utif2'
import { checkDimensions } from './imageLimits.js'
import { validateRGBProfile } from './colorProfiles.js'
// Preflight directory chains before handing data to the general TIFF decoder.
function inspect(buffer) {
  if (buffer.byteLength < 8) throw new Error('Incomplete TIFF header.')
  const view = new DataView(buffer), little = view.getUint16(0) === 0x4949
  if (![0x4949, 0x4d4d].includes(view.getUint16(0)) || view.getUint16(2, little) !== 42) throw new Error('Only classic TIFF is supported; BigTIFF requires conversion.')
  const seen = new Set()
  function directory(offset, depth = 0) {
    if (!offset) return
    if (depth > 8 || seen.size > 64 || seen.has(offset) || offset + 2 > buffer.byteLength) throw new Error('Invalid TIFF directory chain.')
    seen.add(offset)
    const count = view.getUint16(offset, little)
    if (count > 1024 || offset + 6 + count * 12 > buffer.byteLength) throw new Error('Invalid TIFF directory.')
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12, tag = view.getUint16(at, little), size = view.getUint32(at + 4, little)
      const type = view.getUint16(at + 2, little), unit = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 })[type]
      if (!unit || (size * unit > 4 && view.getUint32(at + 8, little) + size * unit > buffer.byteLength)) throw new Error('Invalid TIFF tag data.')
      if (size > 1024 * 1024) throw new Error('TIFF tag exceeds the safe limit.')
      if (tag === 330) throw new Error('Layered/pyramidal TIFF needs flattening before import.')
      if ([34665, 34853].includes(tag)) directory(view.getUint32(at + 8, little), depth + 1)
    }
    directory(view.getUint32(offset + 2 + count * 12, little), depth + 1)
  }
  directory(view.getUint32(4, little))
}
self.onmessage = async ({ data: { buffer } }) => {
  try {
    inspect(buffer)
    const pages = UTIF.decode(buffer), first = pages[0]
    if (!first) throw new Error('TIFF contains no image.')
    checkDimensions(first.t256?.[0], first.t257?.[0])
    const photometric = first.t262?.[0], bits = first.t258?.[0] || 1, samples = first.t277?.[0] || 1
    const supportedBits = photometric === 2 ? [8, 16] : photometric === 0 ? [1, 4, 8, 16] : photometric === 1 ? [1, 2, 8, 16] : [1, 2, 4, 8]
    if (![0, 1, 2, 3].includes(photometric) || !supportedBits.includes(bits) || !(photometric === 2 ? [3, 4] : [1]).includes(samples) || first.t258?.some(value => value !== bits) || first.t339?.some(value => value !== 1) || (first.t284?.[0] || 1) !== 1) throw new Error('Unsupported TIFF color/sample layout. Convert to interleaved unsigned RGB/gray TIFF first.')
    const compression = first.t259?.[0] || 1
    if (![1, 2, 3, 4, 5, 7, 8, 32773, 32946].includes(compression)) throw new Error('Unsupported TIFF compression. Save as uncompressed, LZW or Deflate TIFF.')
    const tiled = Boolean(first.t322), blockWidth = tiled ? first.t322[0] : first.t256[0], blockHeight = tiled ? first.t323?.[0] : Math.min(first.t278?.[0] || first.t257[0], first.t257[0])
    checkDimensions(blockWidth, blockHeight)
    const offsets = tiled ? first.t324 : first.t273, lengths = tiled ? first.t325 : first.t279
    const expectedBlocks = tiled ? Math.ceil(first.t256[0] / blockWidth) * Math.ceil(first.t257[0] / blockHeight) : Math.ceil(first.t257[0] / blockHeight)
    if (!offsets || !lengths || offsets.length !== expectedBlocks || lengths.length !== expectedBlocks || offsets.some((offset, i) => offset < 0 || lengths[i] < 1 || offset + lengths[i] > buffer.byteLength)) throw new Error('Incomplete TIFF strips or tiles.')
    // Bound Deflate output before UTIF's all-at-once inflate allocation.
    if ([8, 32946].includes(compression)) for (let i = 0; i < offsets.length; i++) {
      const reader = new Blob([new Uint8Array(buffer, offsets[i], lengths[i])]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
      let bytes = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.length
          if (bytes > Math.ceil(blockWidth * samples * bits / 8) * blockHeight) throw new Error('TIFF decompressed strip exceeds its dimensions.')
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
    UTIF.decodeImage(buffer, first)
    const rgba = UTIF.toRGBA8(first)
    if (rgba.length !== first.width * first.height * 4) throw new Error('TIFF pixel data is incomplete.')
    if (samples === 4) for (let i = 0; i < rgba.length; i += 4) {
      if (first.t338?.[0] === 1) {
        for (let channel = 0; channel < 3; channel++) rgba[i + channel] = rgba[i + 3] ? Math.min(255, Math.round(rgba[i + channel] * 255 / rgba[i + 3])) : 0
      } else if (first.t338?.[0] !== 2) rgba[i + 3] = 255
    }
    const profile = first.t34675 ? new Uint8Array(first.t34675) : null
    const warnings = []
    if (pages.length > 1) warnings.push('Multi-page TIFF: first page only.')
    if (bits > 8) warnings.push('16-bit TIFF converted to the 8-bit working space. Original retained.')
    if (profile && photometric !== 2) throw new Error('Profiled non-RGB TIFF requires a color-managed RGB conversion first.')
    if (profile) validateRGBProfile(profile)
    self.postMessage({ rgba: rgba.buffer, width: first.width, height: first.height, profile, orientation: first.t274?.[0] || 1, warnings }, [rgba.buffer])
  } catch (error) { self.postMessage({ error: error.message || String(error) || 'TIFF decoding failed.' }) }
}
