const bound = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
export function normalizeLocalMasks(masks) {
  return (Array.isArray(masks) ? masks : []).slice(0, 8).map(mask => ({
    type: mask?.type === 'linear' ? 'linear' : 'radial', enabled: mask?.enabled !== false,
    x: bound(mask?.x, 50, 0, 100), y: bound(mask?.y, 50, 0, 100),
    radius: bound(mask?.radius, 35, 1, 150), feather: bound(mask?.feather, 70, 1, 100),
    angle: bound(mask?.angle, 90, -180, 180), exposure: bound(mask?.exposure, 0, -2, 2), invert: mask?.invert === true,
  }))
}
export function maskWeight(x, y, mask, aspect = 1) {
  const dx = (x - mask.x / 100) * aspect, dy = y - mask.y / 100, radius = mask.radius / 100
  let weight
  if (mask.type === 'linear') {
    const angle = mask.angle * Math.PI / 180
    weight = Math.max(0, Math.min(1, 0.5 + (dx * Math.cos(angle) + dy * Math.sin(angle)) / (2 * radius)))
  } else {
    const distance = Math.hypot(dx, dy) / radius
    weight = Math.max(0, Math.min(1, (1 - distance) / (mask.feather / 100)))
  }
  weight = weight * weight * (3 - 2 * weight)
  return mask.invert ? 1 - weight : weight
}
// Local exposure in linear light, anchored to the oriented original BEFORE crop,
// rotation and resizing. Source bytes and alpha stay untouched.
export function applyLocalLight(image, values) {
  const masks = normalizeLocalMasks(values).filter(mask => mask.enabled && mask.exposure !== 0)
  if (!masks.length) return
  const linear = Float64Array.from({ length: 256 }, (_, n) => n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4)
  const { data, width, height } = image, aspect = width / height
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4
    if (!data[at + 3]) continue
    let ev = 0
    for (const mask of masks) ev += mask.exposure * maskWeight((x + 0.5) / width, (y + 0.5) / height, mask, aspect)
    if (Math.abs(ev) < 0.00001) continue
    const gain = 2 ** Math.max(-4, Math.min(4, ev))
    for (let channel = 0; channel < 3; channel++) {
      const light = linear[data[at + channel]] * gain
      data[at + channel] = Math.round(255 * (light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055))
    }
  }
}
