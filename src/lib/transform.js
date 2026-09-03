export const DEFAULT_TRANSFORM = {
  rotate: 0, // -180..180 Grad
  flipH: false,
  flipV: false,
  trim: false, // transparente Raender abschneiden
  square: false, // auf quadratische Leinwand zentrieren
  padding: 0, // 0..40 % der laengeren Kante
  cornerRadius: 0, // 0..50 % (50 = Kreis bei quadratischer Leinwand)
  background: null, // '#rrggbb' oder null fuer transparent
}

/** Erzeugt ein Canvas aus ImageData. */
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export function imageDataToCanvas(imageData) {
  const canvas = createCanvas(imageData.width, imageData.height)
  canvas.getContext('2d').putImageData(imageData, 0, 0)
  return canvas
}

export function canvasToImageData(canvas) {
  return canvas
    .getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Kleinstes Rechteck, das alle Pixel mit Alpha > threshold enthaelt.
 * @returns {{x, y, width, height} | null}
 */
export function findContentBounds(imageData, threshold = 8) {
  const { data, width, height } = imageData
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * Geometrie-Kette: Zuschneiden -> Spiegeln/Drehen -> Quadrat -> Rand ->
 * Hintergrund -> Eckenmaske.
 * @param {HTMLCanvasElement} source
 * @param {object} transform siehe DEFAULT_TRANSFORM
 * @returns {HTMLCanvasElement} neues Canvas
 */
export function applyTransform(source, transform) {
  const t = { ...DEFAULT_TRANSFORM, ...transform }
  let canvas = source

  if (t.trim) {
    const bounds = findContentBounds(canvasToImageData(canvas))
    if (bounds && (bounds.width !== canvas.width || bounds.height !== canvas.height)) {
      const cropped = createCanvas(bounds.width, bounds.height)
      cropped
        .getContext('2d')
        .drawImage(
          canvas,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          0,
          bounds.width,
          bounds.height,
        )
      canvas = cropped
    }
  }

  const angle = ((t.rotate % 360) + 360) % 360
  if (angle !== 0 || t.flipH || t.flipV) {
    const rad = (angle * Math.PI) / 180
    const sin = Math.abs(Math.sin(rad))
    const cos = Math.abs(Math.cos(rad))
    const width = Math.round(canvas.width * cos + canvas.height * sin)
    const height = Math.round(canvas.width * sin + canvas.height * cos)

    const rotated = createCanvas(width, height)
    const ctx = rotated.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(width / 2, height / 2)
    ctx.rotate(rad)
    ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1)
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
    canvas = rotated
  }

  const longest = Math.max(canvas.width, canvas.height)
  const pad = Math.round((t.padding / 100) * longest)
  const contentWidth = canvas.width
  const contentHeight = canvas.height

  let targetWidth = contentWidth + pad * 2
  let targetHeight = contentHeight + pad * 2
  if (t.square) {
    const side = Math.max(targetWidth, targetHeight)
    targetWidth = side
    targetHeight = side
  }

  if (targetWidth !== canvas.width || targetHeight !== canvas.height || t.background) {
    const framed = createCanvas(targetWidth, targetHeight)
    const ctx = framed.getContext('2d')
    if (t.background) {
      ctx.fillStyle = t.background
      ctx.fillRect(0, 0, targetWidth, targetHeight)
    }
    ctx.drawImage(
      canvas,
      Math.round((targetWidth - contentWidth) / 2),
      Math.round((targetHeight - contentHeight) / 2),
    )
    canvas = framed
  }

  if (t.cornerRadius > 0) {
    canvas = applyCornerMask(canvas, t.cornerRadius)
  }

  return canvas
}

/** Schneidet die Ecken rund aus (50 % = Kreis bei quadratischer Leinwand). */
export function applyCornerMask(source, radiusPercent) {
  const { width, height } = source
  const radius = (Math.min(width, height) / 2) * (radiusPercent / 50)
  const masked = createCanvas(width, height)
  const ctx = masked.getContext('2d')

  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, width, height, radius)
  } else {
    traceRoundedRect(ctx, width, height, radius)
  }
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(source, 0, 0)
  return masked
}

function traceRoundedRect(ctx, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.moveTo(r, 0)
  ctx.lineTo(width - r, 0)
  ctx.quadraticCurveTo(width, 0, width, r)
  ctx.lineTo(width, height - r)
  ctx.quadraticCurveTo(width, height, width - r, height)
  ctx.lineTo(r, height)
  ctx.quadraticCurveTo(0, height, 0, height - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
}

/**
 * Hochwertiges Skalieren: beim Verkleinern schrittweise halbieren,
 * damit keine Aliasing-Artefakte entstehen.
 */
export function resizeCanvas(source, targetWidth, targetHeight, fit = 'contain') {
  const target = createCanvas(targetWidth, targetHeight)
  const ctx = target.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  let current = source
  while (current.width / 2 >= targetWidth && current.height / 2 >= targetHeight) {
    const half = createCanvas(Math.max(1, current.width / 2), Math.max(1, current.height / 2))
    const halfCtx = half.getContext('2d')
    halfCtx.imageSmoothingEnabled = true
    halfCtx.imageSmoothingQuality = 'high'
    halfCtx.drawImage(current, 0, 0, half.width, half.height)
    current = half
  }

  const scale =
    fit === 'cover'
      ? Math.max(targetWidth / current.width, targetHeight / current.height)
      : Math.min(targetWidth / current.width, targetHeight / current.height)
  const drawWidth = current.width * scale
  const drawHeight = current.height * scale

  ctx.drawImage(
    current,
    (targetWidth - drawWidth) / 2,
    (targetHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
  return target
}
