export const MAX_STROKES = 120
export const MAX_POINTS = 24000
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

export function drawStrokes(canvas, strokes, base = null) {
  // Keep mask rasterization on one backend. Chromium can otherwise switch from
  // GPU to CPU after readback and subtly change antialiasing during Undo replay.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (base) context.drawImage(base, 0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'; context.lineJoin = 'round'
  context.strokeStyle = '#ffffff'; context.fillStyle = '#ffffff'
  for (const stroke of strokes) {
    if (stroke.clear === true) { context.clearRect(0, 0, canvas.width, canvas.height); continue }
    context.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
    const radius = stroke.size * Math.min(canvas.width, canvas.height) / 2
    context.lineWidth = radius * 2
    const first = stroke.points[0]
    if (!first) continue
    context.beginPath(); context.arc(first[0] * canvas.width, first[1] * canvas.height, radius, 0, Math.PI * 2); context.fill()
    context.beginPath(); context.moveTo(first[0] * canvas.width, first[1] * canvas.height)
    for (const point of stroke.points.slice(1)) context.lineTo(point[0] * canvas.width, point[1] * canvas.height)
    context.stroke()
  }
  context.globalCompositeOperation = 'source-over'
}

export function maskBounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1, count = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue
    left = Math.min(left, x); top = Math.min(top, y)
    right = Math.max(right, x); bottom = Math.max(bottom, y); count++
  }
  return count ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1, coverage: count / (width * height) } : null
}

export function contextRegion(bounds, maskWidth, maskHeight, width, height) {
  if (!bounds) throw new Error('Paint over an object first.')
  const x = bounds.x / maskWidth * width, y = bounds.y / maskHeight * height
  const w = bounds.width / maskWidth * width, h = bounds.height / maskHeight * height
  const side = Math.max(128, Math.max(w, h) * 1.8)
  const rw = Math.min(width, Math.ceil(side)), rh = Math.min(height, Math.ceil(side))
  return { x: clamp(Math.floor(x + w / 2 - rw / 2), 0, width - rw), y: clamp(Math.floor(y + h / 2 - rh / 2), 0, height - rh), width: rw, height: rh }
}

// Composition is bounded by the user's mask. Alpha and every unmasked byte stay intact.
export function compositePixels(source, generated, mask) {
  if (source.length !== generated.length || source.length !== mask.length || source.length % 4) throw new Error('Invalid composition buffers.')
  for (let i = 0; i < source.length; i += 4) {
    const alpha = mask[i + 3] / 255
    if (!alpha) continue
    for (let c = 0; c < 3; c++) source[i + c] = Math.round(source[i + c] * (1 - alpha) + generated[i + c] * alpha)
  }
  return source
}
