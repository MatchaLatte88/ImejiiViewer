import { compositePixels, contextRegion, maskBounds } from './mask.js'

const SIZE = 512
function canvas(width, height) { const result = document.createElement('canvas'); result.width = width; result.height = height; return result }

export function prepareRemoval(source, mask) {
  const bounds = maskBounds(mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data, mask.width, mask.height)
  if (bounds?.coverage > 0.65) throw new Error('Keep some background visible. Select less than 65% of the image.')
  const region = contextRegion(bounds, mask.width, mask.height, source.width, source.height)
  const scale = Math.min(SIZE / region.width, SIZE / region.height)
  const width = Math.max(1, Math.round(region.width * scale)), height = Math.max(1, Math.round(region.height * scale))
  const small = canvas(SIZE, SIZE), context = small.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, SIZE, SIZE)
  context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, width, height)
  // Edge padding, never aspect-ratio distortion of portrait or panoramic photos.
  if (width < SIZE) context.drawImage(small, width - 1, 0, 1, height, width, 0, SIZE - width, height)
  if (height < SIZE) context.drawImage(small, 0, height - 1, SIZE, 1, 0, height, SIZE, SIZE - height)
  const rgba = context.getImageData(0, 0, SIZE, SIZE).data, area = SIZE * SIZE
  const image = new Float32Array(area * 3), tensorMask = new Float32Array(area)
  for (let i = 0; i < area; i++) for (let c = 0; c < 3; c++) image[c * area + i] = rgba[i * 4 + c] / 255
  const smallMask = canvas(SIZE, SIZE), mctx = smallMask.getContext('2d')
  mctx.drawImage(mask, region.x / source.width * mask.width, region.y / source.height * mask.height,
    region.width / source.width * mask.width, region.height / source.height * mask.height, 0, 0, width, height)
  const maskBytes = mctx.getImageData(0, 0, SIZE, SIZE).data
  // Two model-pixel context pixels around the brush; composition still uses the original mask.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!maskBytes[(y * SIZE + x) * 4 + 3]) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx >= 0 && xx < width && yy >= 0 && yy < height) tensorMask[yy * SIZE + xx] = 1
    }
  }
  return { image, mask: tensorMask, region, width, height, coverage: bounds.coverage }
}

export function composeRemoval(source, mask, output, prepared) {
  if (!(output instanceof Float32Array) || output.length !== SIZE * SIZE * 3 || output.some(value => !Number.isFinite(value))) throw new Error('The model returned invalid pixels.')
  const small = canvas(SIZE, SIZE), pixels = new ImageData(SIZE, SIZE), area = SIZE * SIZE
  for (let i = 0; i < area; i++) {
    for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = Math.round(output[c * area + i]) // ExportLaMa output is 0..255, NOT 0..1.
    pixels.data[i * 4 + 3] = 255
  }
  small.getContext('2d').putImageData(pixels, 0, 0)
  const { region: r, width, height } = prepared
  const patch = canvas(r.width, r.height), pctx = patch.getContext('2d', { willReadFrequently: true })
  pctx.drawImage(small, 0, 0, width, height, 0, 0, r.width, r.height)
  const generated = pctx.getImageData(0, 0, r.width, r.height).data
  pctx.clearRect(0, 0, r.width, r.height)
  pctx.drawImage(mask, r.x / source.width * mask.width, r.y / source.height * mask.height,
    r.width / source.width * mask.width, r.height / source.height * mask.height, 0, 0, r.width, r.height)
  const alpha = pctx.getImageData(0, 0, r.width, r.height).data
  const original = source.getContext('2d').getImageData(r.x, r.y, r.width, r.height)
  compositePixels(original.data, generated, alpha)
  const result = canvas(source.width, source.height), context = result.getContext('2d')
  context.drawImage(source, 0, 0); context.putImageData(original, r.x, r.y)
  return result
}
