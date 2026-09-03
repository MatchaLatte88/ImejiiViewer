import { applyChromaKey, bleedEdges, contractAlpha, featherAlpha } from './chromaKey.js'
import { DEFAULT_ADJUSTMENTS, applyAdjustments } from './adjustments.js'
import { DEFAULT_EFFECTS, applyBlur, applyOutline, applyPosterize, applySharpen } from './effects.js'
import { DEFAULT_TRANSFORM, applyTransform, canvasToImageData, imageDataToCanvas, resizeCanvas } from './transform.js'
import { hexToRgb } from './color.js'

export const DEFAULT_KEYING = {
  keys: [], // [{ hex, r, g, b }]
  tolerance: 18, // 0..100 %
  softness: 8, // 0..100 %
  contiguous: false, // nur zusammenhaengende Flaechen vom Rand aus
  seeds: [], // optionale Startpunkte (Bildkoordinaten) fuer den Flood-Fill
  despill: 60, // 0..100 % Farbsaum-Korrektur
  edgeContract: 0, // -100..100 (positiv = Maske schrumpfen)
  feather: 0, // 0..10 px weiche Kante
}

export const DEFAULT_SETTINGS = {
  keying: { ...DEFAULT_KEYING },
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  effects: { ...DEFAULT_EFFECTS },
  transform: { ...DEFAULT_TRANSFORM },
}

/** Tiefe Kopie der Einstellungen (fuer History-Snapshots). */
export function cloneSettings(settings) {
  return {
    keying: { ...settings.keying, keys: settings.keying.keys.map((k) => ({ ...k })), seeds: settings.keying.seeds.map((s) => ({ ...s })) },
    adjustments: { ...settings.adjustments },
    effects: { ...settings.effects },
    transform: { ...settings.transform },
  }
}

function cloneImageData(imageData) {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  )
}

/**
 * Fuehrt die komplette Verarbeitungskette aus.
 *
 * Reihenfolge: Chroma-Key -> Maskenkorrektur -> Farbkorrektur -> Effekte ->
 * Kontur -> Geometrie. Das Keying laeuft bewusst zuerst, damit sich die
 * gewaehlte Hintergrundfarbe auf die Originalfarben bezieht.
 *
 * @param {ImageData} sourceImageData unveraenderte Quelldaten
 * @param {object} settings siehe DEFAULT_SETTINGS
 * @param {{maxSize?: number}} [options] maxSize begrenzt die Arbeitsaufloesung (Vorschau)
 * @returns {HTMLCanvasElement}
 */
export function processImage(sourceImageData, settings, options = {}) {
  const maxSize = options.maxSize || 0
  const longest = Math.max(sourceImageData.width, sourceImageData.height)
  const scale = maxSize && longest > maxSize ? maxSize / longest : 1

  let working
  if (scale < 1) {
    const scaled = resizeCanvas(
      imageDataToCanvas(sourceImageData),
      Math.max(1, Math.round(sourceImageData.width * scale)),
      Math.max(1, Math.round(sourceImageData.height * scale)),
    )
    working = canvasToImageData(scaled)
  } else {
    working = cloneImageData(sourceImageData)
  }

  const keying = { ...DEFAULT_KEYING, ...settings.keying }
  const effects = { ...DEFAULT_EFFECTS, ...settings.effects }

  // Pixelradien mitskalieren, damit Vorschau und Export identisch aussehen.
  const scaleRadius = (value) => (value > 0 ? Math.max(1, Math.round(value * scale)) : 0)

  if (keying.keys.length) {
    applyChromaKey(working, {
      keys: keying.keys,
      tolerance: keying.tolerance,
      softness: keying.softness,
      contiguous: keying.contiguous,
      seeds: keying.seeds.map((seed) => ({ x: seed.x * scale, y: seed.y * scale })),
      despill: keying.despill,
    })
    contractAlpha(working, keying.edgeContract)
    featherAlpha(working, scaleRadius(keying.feather))
    bleedEdges(working, 2)
  }

  applyAdjustments(working, settings.adjustments)

  if (effects.posterize >= 2) applyPosterize(working, effects.posterize)
  if (effects.blur > 0) applyBlur(working, scaleRadius(effects.blur))
  if (effects.sharpen > 0) applySharpen(working, effects.sharpen)

  if (effects.outlineWidth > 0) {
    const color = hexToRgb(effects.outlineColor) || { r: 255, g: 255, b: 255 }
    applyOutline(working, {
      width: scaleRadius(effects.outlineWidth),
      color,
      opacity: effects.outlineOpacity,
    })
  }

  return applyTransform(imageDataToCanvas(working), settings.transform)
}
