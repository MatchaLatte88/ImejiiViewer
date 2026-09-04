export const IDENTITY_CURVE = [0, 64, 128, 192, 255]
export function normalizeCurve(value) {
  return IDENTITY_CURVE.map((fallback, i) => Number.isFinite(value?.[i]) ? Math.max(0, Math.min(255, value[i])) : fallback)
}
export function curveIsActive(value) {
  return normalizeCurve(value).some((n, i) => n !== IDENTITY_CURVE[i])
}
export function applyCurve(imageData, value) {
  if (!curveIsActive(value)) return
  const points = normalizeCurve(value), table = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const segment = Math.min(3, Math.floor(i / 64))
    const t = (i - IDENTITY_CURVE[segment]) / (IDENTITY_CURVE[segment + 1] - IDENTITY_CURVE[segment])
    table[i] = points[segment] * (1 - t) + points[segment + 1] * t
  }
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue
    data[i] = table[data[i]]; data[i + 1] = table[data[i + 1]]; data[i + 2] = table[data[i + 2]]
  }
}
export function whiteBalanceFromSample({ r, g, b }) {
  if (Math.min(r, g, b) < 8 || Math.max(r, g, b) > 247) throw new Error('Choose a neutral midtone, not a clipped highlight or deep shadow.')
  const mean = (r + g + b) / 3
  return { temperature: 0, tint: 0, whiteBalanceR: mean / r, whiteBalanceG: mean / g, whiteBalanceB: mean / b }
}
