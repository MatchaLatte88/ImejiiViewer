export function exportName(pattern, item, index, size, extension) {
  let base = (pattern || '{name}')
    .replace(/\{name\}/g, () => item.name.replace(/\.[^.]+$/, ''))
    .replace(/\{index\}/g, String(index + 1).padStart(3, '0'))
    .replace(/\{width\}/g, String(size.width)).replace(/\{height\}/g, String(size.height))
    .normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/[. ]+$/g, '').slice(0, 140)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = '_' + base
  return (base || 'image-' + (index + 1)) + '.' + extension
}
export function uniqueExportName(name, used) {
  const dot = name.lastIndexOf('.')
  const base = name.slice(0, dot), extension = name.slice(dot)
  let candidate = name, suffix = 2
  while (used.has(candidate.normalize('NFC').toLowerCase())) candidate = base + '-' + suffix++ + extension
  used.add(candidate.normalize('NFC').toLowerCase())
  return candidate
}
