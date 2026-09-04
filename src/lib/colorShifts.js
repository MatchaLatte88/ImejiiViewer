import { clamp, clamp255, hexToRgb, hslToRgb, rgbToHsl } from './color.js'

/**
 * Gezielte Farbaenderung: verschiebt Farbton, Saettigung und Helligkeit nur in
 * einem Farbtonband rund um eine Zielfarbe. Alles ausserhalb bleibt unberuehrt.
 */

/** Unter dieser Saettigung hat eine Farbe keinen brauchbaren Farbton. */
export const MIN_TARGET_SATURATION = 0.05
/** Ab dieser Saettigung wirkt ein Eintrag voll - darunter blendet er aus. */
const SATURATION_GATE = 0.15
/** Abstand zu Schwarz und Weiss, ab dem ein Eintrag voll wirkt. */
const LIGHTNESS_GATE = 0.08

/** Neutralwerte eines Eintrags. */
export const DEFAULT_COLOR_SHIFT = {
  hex: '#ff0000', // Zielfarbe
  hue: 0, // -180..180 Grad
  saturation: 0, // -100..100
  lightness: 0, // -100..100
  range: 30, // 5..90 Grad Farbtonbreite
}

export function createColorShift(hex = DEFAULT_COLOR_SHIFT.hex) {
  return { ...DEFAULT_COLOR_SHIFT, hex }
}

/** Aendert dieser Eintrag ueberhaupt etwas am Bild? */
export function isActiveShift(shift) {
  return Boolean(shift) && (shift.hue !== 0 || shift.saturation !== 0 || shift.lightness !== 0)
}

/** Farbton der Zielfarbe in Grad, oder null bei Grau-, Schwarz- und Weisstoenen. */
export function targetHue(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  return hsl.s < MIN_TARGET_SATURATION ? null : hsl.h
}

function prepare(shift) {
  const hue = targetHue(shift.hex)
  if (hue === null) return null
  const range = clamp(Number(shift.range) || 0, 0, 180)
  return {
    hue,
    range,
    // Weicher Auslauf, damit die Bandkante nicht als Farbkante sichtbar wird.
    soft: Math.max(4, range * 0.5),
    hueShift: shift.hue,
    saturation: 1 + shift.saturation / 100,
    lightness: shift.lightness / 100,
  }
}

/** 0..1 - wie stark ein Eintrag auf einen Pixel wirkt. */
function weightFor(shift, h, s, l) {
  let distance = Math.abs(h - shift.hue) % 360
  if (distance > 180) distance = 360 - distance
  if (distance >= shift.range + shift.soft) return 0
  const band = distance <= shift.range ? 1 : 1 - (distance - shift.range) / shift.soft
  // Graue und fast schwarze/weisse Pixel haben keinen verlaesslichen Farbton.
  const gate = Math.min(1, s / SATURATION_GATE, l / LIGHTNESS_GATE, (1 - l) / LIGHTNESS_GATE)
  return band * gate
}

/**
 * Wendet alle Eintraege in-place an. Transparente Pixel bleiben unberuehrt.
 * @param {ImageData} imageData
 * @param {Array<object>} shifts siehe DEFAULT_COLOR_SHIFT
 */
export function applyColorShifts(imageData, shifts) {
  const active = (shifts || []).filter(isActiveShift).map(prepare).filter(Boolean)
  if (!active.length) return

  const { data } = imageData
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    const hsl = rgbToHsl(data[i], data[i + 1], data[i + 2])
    let h = hsl.h
    let s = hsl.s
    let l = hsl.l
    let touched = false

    // Die Eintraege wirken nacheinander: der zweite sieht die Farben, die der
    // erste hinterlassen hat - genau wie die Vorschau, aus der gepickt wird.
    for (const shift of active) {
      const weight = weightFor(shift, h, s, l)
      if (weight <= 0) continue
      h += shift.hueShift * weight
      s = clamp(s * (1 + (shift.saturation - 1) * weight), 0, 1)
      l = clamp(l + shift.lightness * 0.5 * weight, 0, 1)
      touched = true
    }

    if (!touched) continue
    const rgb = hslToRgb(h, s, l)
    data[i] = clamp255(rgb.r)
    data[i + 1] = clamp255(rgb.g)
    data[i + 2] = clamp255(rgb.b)
  }
}
