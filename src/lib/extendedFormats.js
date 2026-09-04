import heicWorkerURL from '../generated/heic-worker.js?url'
import { checkDimensions, checkImageFile } from './imageLimits.js'
import { pngWithProfile } from './photoMetadata.js'
import { P3_PROFILE, SRGB_PROFILE, REC709_PROFILE, validateRGBProfile } from './colorProfiles.js'
import { orientationTransform } from './exif.js'
const isHeic = file => /\.(heic|heif)$/i.test(file.name || '') || /image\/hei[cf]/.test(file.type)
const isTiff = file => /\.tiff?$/i.test(file.name || '') || file.type === 'image/tiff'
export const isExtendedFormat = file => isHeic(file) || isTiff(file)
let queue = Promise.resolve()
const conversions = new WeakMap()

export function inspectHeif(buffer) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer)
  let profile = null, foundSize = false, count = 0
  function setProfile(next) {
    validateRGBProfile(next)
    if (profile && (profile.length !== next.length || !profile.every((value, i) => value === next[i]))) throw new Error('HEIF images have different color profiles. Export the desired image to sRGB first.')
    profile = next
  }
  function walk(start, end, depth = 0) {
    if (depth > 8) throw new Error('HEIF container nesting exceeds the limit.')
    for (let offset = start; offset + 8 <= end;) {
      if (++count > 10000) throw new Error('HEIF container has too many boxes.')
      let length = view.getUint32(offset), header = 8
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
      if (length === 1) { if (offset + 16 > end || view.getUint32(offset + 8) !== 0) throw new Error('Unsupported HEIF box size.'); length = view.getUint32(offset + 12); header = 16 }
      if (!length) length = end - offset
      if (length < header || offset + length > end) throw new Error('Invalid HEIF container.')
      const payload = offset + header, limit = offset + length
      if (type === 'ispe' && payload + 12 <= limit) { checkDimensions(view.getUint32(payload + 4), view.getUint32(payload + 8)); foundSize = true }
      if (type === 'colr' && payload + 4 <= limit) {
        const kind = String.fromCharCode(...bytes.subarray(payload, payload + 4))
        if (kind === 'prof' || kind === 'rICC') {
          if (limit - payload > 1024 * 1024) throw new Error('HEIF color profile exceeds 1 MiB.')
          setProfile(bytes.slice(payload + 4, limit))
        } else if (kind === 'nclx' && payload + 11 <= limit) {
          const primaries = view.getUint16(payload + 4), transfer = view.getUint16(payload + 6)
          if ([16, 18].includes(transfer)) throw new Error('HDR HEIF (PQ/HLG) needs tone mapping. Convert to SDR first.')
          if (primaries === 12 && transfer === 13) setProfile(P3_PROFILE)
          else if (primaries === 1 && transfer === 13) setProfile(SRGB_PROFILE)
          else if (primaries === 1 && [1, 6].includes(transfer)) setProfile(REC709_PROFILE)
          else if (primaries !== 2 || transfer !== 2) throw new Error('This HEIF color space is not supported reliably. Convert to sRGB first.')
        }
      }
      if (['meta', 'iprp', 'ipco'].includes(type)) walk(payload + (type === 'meta' ? 4 : 0), limit, depth + 1)
      offset = limit
    }
  }
  walk(0, bytes.length)
  if (!foundSize) throw new Error('HEIF dimensions could not be validated before decoding.')
  return { profile }
}
function runWorker(worker, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Image decoder timed out.')) }, 45000)
    const finish = () => { clearTimeout(timer); worker.terminate() }
    worker.onerror = event => { finish(); reject(new Error(event.message || 'Image decoder failed.')) }
    worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data) }
    worker.postMessage(payload, [payload.buffer])
  })
}
export function prepareImageFile(file) {
  if (!isExtendedFormat(file)) return Promise.resolve({ file, warnings: [] })
  if (conversions.has(file)) return conversions.get(file)
  const work = queue.then(async () => {
    await checkImageFile(file)
    const buffer = await file.arrayBuffer()
    let imageData, profile, orientation = 1, warnings
    if (isHeic(file)) {
      profile = inspectHeif(buffer).profile
      const decoded = await runWorker(new Worker(heicWorkerURL), { id: 1, buffer })
      imageData = decoded.imageData
      warnings = ['HEIF: first image, SDR 8-bit working copy. Original bytes are retained.']
    } else {
      const decoded = await runWorker(new Worker(new URL('./tiffWorker.js', import.meta.url), { type: 'module' }), { buffer })
      imageData = new ImageData(new Uint8ClampedArray(decoded.rgba), decoded.width, decoded.height)
      profile = decoded.profile; orientation = decoded.orientation; warnings = decoded.warnings
    }
    checkDimensions(imageData.width, imageData.height)
    let canvas = document.createElement('canvas'); canvas.width = imageData.width; canvas.height = imageData.height
    canvas.getContext('2d', { colorSpace: 'srgb' }).putImageData(imageData, 0, 0)
    if (orientation !== 1) {
      const transform = orientationTransform(orientation), oriented = document.createElement('canvas')
      oriented.width = transform.swap ? canvas.height : canvas.width
      oriented.height = transform.swap ? canvas.width : canvas.height
      const context = oriented.getContext('2d', { colorSpace: 'srgb' })
      transform.transform(context, canvas.width, canvas.height)
      context.drawImage(canvas, 0, 0)
      canvas.width = canvas.height = 1
      canvas = oriented
    }
    let png = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image conversion failed.')), 'image/png'))
    if (profile) png = await pngWithProfile(png, profile)
    canvas.width = canvas.height = 1
    return { file: new File([png], file.name + '.png', { type: 'image/png', lastModified: file.lastModified }), orientation, warnings }
  })
  queue = work.catch(() => {})
  conversions.set(file, work)
  // Cache only the current conversion briefly; do not retain every decoded import.
  work.then(() => setTimeout(() => conversions.delete(file), 1000), () => conversions.delete(file))
  return work
}
