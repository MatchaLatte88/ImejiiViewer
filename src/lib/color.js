/**
 * Farbhilfsfunktionen. RGB-Werte sind 0..255, HSL: h 0..360, s/l 0..1.
 */

/** Maximale euklidische Distanz im RGB-Wuerfel (sqrt(3) * 255). */
export const MAX_RGB_DISTANCE = 441.6729559300637

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

export function clamp255(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

/** '#rgb' | '#rrggbb' | 'rrggbb' -> { r, g, b }; null bei ungueltiger Eingabe. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null
  let value = hex.trim().replace(/^#/, '')
  if (value.length === 3) {
    value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2]
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  const int = parseInt(value, 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

export function rgbToHex(r, g, b) {
  const toHex = (v) => clamp255(Math.round(v)).toString(16).padStart(2, '0')
  return '#' + toHex(r) + toHex(g) + toHex(b)
}

export function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
    else if (max === gn) h = ((bn - rn) / d + 2) * 60
    else h = ((rn - gn) / d + 4) * 60
  }
  return { h, s, l }
}

function hueToRgb(p, q, t) {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

export function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360
  if (s === 0) {
    const v = l * 255
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hueToRgb(p, q, hn + 1 / 3) * 255,
    g: hueToRgb(p, q, hn) * 255,
    b: hueToRgb(p, q, hn - 1 / 3) * 255,
  }
}

/** Wahrgenommene Helligkeit 0..255 (Rec. 709). */
export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Euklidische Distanz im RGB-Raum, 0..MAX_RGB_DISTANCE. */
export function rgbDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** Lesbare Vordergrundfarbe fuer einen Farb-Swatch. */
export function contrastColor(r, g, b) {
  return luminance(r, g, b) > 150 ? '#000000' : '#ffffff'
}
