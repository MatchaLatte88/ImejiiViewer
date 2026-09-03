import { clamp } from './color.js'

export const WATERMARK_POSITIONS = [
  { value: 'tl', label: 'TL', title: 'Top left' },
  { value: 'tr', label: 'TR', title: 'Top right' },
  { value: 'center', label: 'C', title: 'Center' },
  { value: 'bl', label: 'BL', title: 'Bottom left' },
  { value: 'br', label: 'BR', title: 'Bottom right' },
]

const FONT_STACK = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/**
 * Zeichnet ein Text-Wasserzeichen direkt auf das Canvas (mutiert es).
 * Weiss mit dunklem Schlagschatten - bleibt so auf hellem wie dunklem Bildgrund lesbar,
 * ohne dass eine eigene Farbe gewaehlt werden muss.
 * @param {HTMLCanvasElement} canvas
 * @param {{text?: string, position?: string, opacity?: number, scale?: number}} options
 */
export function applyWatermark(canvas, options = {}) {
  const text = (options.text || '').trim()
  if (!text) return canvas

  const opacity = clamp((options.opacity ?? 65) / 100, 0, 1)
  const scale = clamp(options.scale ?? 4, 1, 25) / 100
  const position = options.position || 'br'
  const { width, height } = canvas
  const fontSize = Math.max(10, Math.round(Math.min(width, height) * scale))
  const margin = Math.round(fontSize * 0.6)

  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.font = '600 ' + fontSize + 'px ' + FONT_STACK
  ctx.textBaseline = 'alphabetic'
  const textWidth = ctx.measureText(text).width

  let x
  let y
  if (position === 'tl') {
    x = margin
    y = margin + fontSize
  } else if (position === 'tr') {
    x = width - margin - textWidth
    y = margin + fontSize
  } else if (position === 'bl') {
    x = margin
    y = height - margin
  } else if (position === 'center') {
    x = (width - textWidth) / 2
    y = (height + fontSize * 0.7) / 2
  } else {
    x = width - margin - textWidth
    y = height - margin
  }

  ctx.globalAlpha = opacity
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillText(text, x + 1, y + 1)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x, y)
  ctx.restore()
  return canvas
}
