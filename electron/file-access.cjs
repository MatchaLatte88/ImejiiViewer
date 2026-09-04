const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff' }
const IMAGE_EXTENSIONS = Object.keys(MIME)
const MAX_FILE_BYTES = 128 * 1024 * 1024
const MAX_EXPORT_BYTES = 512 * 1024 * 1024
const MAX_FILES = 1000
const keyFor = p => process.platform === 'win32' ? p.toLowerCase() : p

function inside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

function safeParts(name) {
  if (typeof name !== 'string' || name.length > 220) throw new Error('Invalid output name.')
  const parts = name.split('/')
  if (!parts.length || parts.some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new Error('Unsafe output name.')
  }
  return parts
}

function validatedBuffer(value) {
  if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) throw new Error('Expected binary data.')
  if (!value.byteLength || value.byteLength > MAX_EXPORT_BYTES) throw new Error('Export exceeds the 512 MiB limit.')
  return value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

/** All capabilities belong to this window's lifetime. Paths never come from read/write callers. */
function createFileAccess() {
  const files = new Map(), paths = new Map(), folders = new Map(), exports = new Map(), revealed = new Set()
  function remember(filePath) {
    const key = keyFor(filePath)
    if (paths.has(key)) return paths.get(key)
    if (files.size >= 20000) throw new Error('Too many file handles. Reopen the application.')
    const id = randomUUID()
    paths.set(key, id); files.set(id, filePath)
    return id
  }
  async function describe(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Expected an absolute image path.')
    const real = await fs.realpath(filePath)
    const extension = path.extname(real).slice(1).toLowerCase()
    if (!MIME[extension]) throw new Error('Unsupported image format.')
    const stat = await fs.stat(real)
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) throw new Error('Images must be non-empty files up to 128 MiB.')
    return { id: remember(real), name: path.basename(real), type: MIME[extension], size: stat.size, lastModified: stat.mtimeMs }
  }
  async function grant(filePaths) {
    if (!Array.isArray(filePaths) || filePaths.length > MAX_FILES) throw new Error('Open at most 1000 images at once.')
    const entries = [], failed = []
    for (const p of filePaths) {
      try { entries.push(await describe(p)) }
      catch (error) { failed.push(path.basename(String(p)) + ': ' + error.message) }
    }
    return { files: entries, error: failed.join('; ') || null }
  }
  function known(id) {
    if (typeof id !== 'string' || !files.has(id)) throw new Error('Unknown image handle. Open the image first.')
    return files.get(id)
  }
  async function read(id) {
    const filePath = known(id)
    if (keyFor(await fs.realpath(filePath)) !== keyFor(filePath)) throw new Error('Image path changed. Reopen it.')
    const info = await describe(filePath)
    const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Image exceeds the file-size limit.')
      // Bound the allocation even if another process grows the file while it is read.
      const data = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, Math.min(1024 * 1024, data.length - offset), offset)
        if (!bytesRead) throw new Error('Image changed while reading. Reopen it.')
        offset += bytesRead
      }
      const after = await handle.stat()
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('Image changed while reading. Reopen it.')
      return { ...info, size: stat.size, lastModified: stat.mtimeMs, buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }
    } finally { await handle.close() }
  }
  async function list(id) {
    const filePath = known(id), dir = path.dirname(filePath)
    if (keyFor(await fs.realpath(dir)) !== keyFor(dir)) throw new Error('Image directory changed. Reopen it.')
    if (!folders.has(dir)) folders.set(dir, randomUUID())
    const entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter(e => e.isFile() && IMAGE_EXTENSIONS.includes(path.extname(e.name).slice(1).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    if (entries.length > 10000) throw new Error('Folder exceeds the 10,000-image browsing limit.')
    return { key: folders.get(dir), entries: entries.map(e => ({ id: remember(path.join(dir, e.name)), name: e.name })) }
  }
  async function begin(parent, name = 'imejii-export') {
    if (exports.size >= 4) throw new Error('Finish the current exports first.')
    const real = await fs.realpath(parent)
    if (!(await fs.stat(real)).isDirectory()) throw new Error('Choose a directory.')
    const base = String(name).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'imejii-export'
    // A dedicated, unique directory preserves fixed bundle names and all existing user files.
    const root = await fs.mkdtemp(path.join(real, base + '-'))
    const token = randomUUID()
    exports.set(token, { root, count: 0, bytes: 0, busy: false, names: new Set() })
    revealed.add(root)
    return { canceled: false, token, path: root }
  }
  async function write({ token, name, buffer } = {}) {
    const entry = exports.get(token)
    if (!entry || entry.busy) throw new Error('Unknown or busy export handle.')
    const parts = safeParts(name), data = validatedBuffer(buffer), normalized = parts.join('/').toLowerCase()
    if (entry.names.has(normalized)) throw new Error('Duplicate output name: ' + name)
    if (entry.count >= MAX_FILES || entry.bytes + data.length > 4 * 1024 ** 3) throw new Error('Export exceeds the file-count or 4 GiB session limit.')
    entry.busy = true
    let temp = null
    try {
      if (keyFor(await fs.realpath(entry.root)) !== keyFor(entry.root)) throw new Error('Export directory changed.')
      let dir = entry.root
      for (const part of parts.slice(0, -1)) {
        dir = path.join(dir, part)
        try { await fs.mkdir(dir) } catch (error) { if (error.code !== 'EEXIST') throw error }
        const stat = await fs.lstat(dir)
        if (!stat.isDirectory() || stat.isSymbolicLink() || keyFor(await fs.realpath(dir)) !== keyFor(dir)) throw new Error('Unsafe export subdirectory.')
      }
      const target = path.join(dir, parts.at(-1))
      if (!inside(entry.root, target)) throw new Error('Output escaped the export directory.')
      temp = path.join(dir, '.imejii-' + randomUUID() + '.tmp')
      const handle = await fs.open(temp, 'wx')
      try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
      // Hard-link publication is atomic and cannot overwrite a destination. Portable fallback
      // still uses exclusive creation. All outputs remain confined to a new per-export folder.
      try { await fs.link(temp, target) }
      catch (error) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error
        await fs.copyFile(temp, target, constants.COPYFILE_EXCL)
      }
      entry.names.add(normalized); entry.count++; entry.bytes += data.length
      revealed.add(target)
      return { path: target }
    } finally {
      if (temp) await fs.unlink(temp).catch(() => {})
      entry.busy = false
    }
  }
  function finish(token) {
    const entry = exports.get(token)
    if (!entry || entry.busy) throw new Error('Unknown or busy export handle.')
    exports.delete(token)
    return { path: entry.root, count: entry.count }
  }
  function canReveal(p) { return typeof p === 'string' && revealed.has(p) }
  function reset() { files.clear(); paths.clear(); folders.clear(); exports.clear(); revealed.clear() }
  return { grant, read, list, begin, write, finish, canReveal, reset }
}

/** Only the path selected in a native save dialog may be replaced. */
async function saveSelectedFile(filePath, value) {
  const data = validatedBuffer(value), parent = await fs.realpath(path.dirname(filePath))
  const target = path.join(parent, path.basename(filePath))
  const before = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (before && (!before.isFile() || before.isSymbolicLink())) throw new Error('Cannot replace a link or non-file.')
  const temp = path.join(parent, '.imejii-' + randomUUID() + '.tmp')
  try {
    const handle = await fs.open(temp, 'wx')
    try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
    const now = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (Boolean(now) !== Boolean(before) || (now && (now.isSymbolicLink() || now.ino !== before.ino || now.mtimeMs !== before.mtimeMs || now.size !== before.size))) throw new Error('Destination changed. Please save again.')
    if (before) await fs.rename(temp, target)
    else {
      try { await fs.link(temp, target) }
      catch (error) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error
        await fs.copyFile(temp, target, constants.COPYFILE_EXCL)
      }
    }
  } finally { await fs.unlink(temp).catch(() => {}) }
  return target
}

module.exports = { createFileAccess, saveSelectedFile, IMAGE_EXTENSIONS, MAX_FILE_BYTES, MAX_FILES, safeParts, inside, validatedBuffer }
