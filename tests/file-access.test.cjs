const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createFileAccess, saveSelectedFile, safeParts, MAX_FILE_BYTES } = require('../electron/file-access.cjs')
const { assertSender, trustedURL, developmentURL, serveApp, APP_URL } = require('../electron/security.cjs')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imejii-fs-test-'))
  // This test owns this exact mkdtemp child, never the temp root.
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const image = path.join(root, 'München image.png')
  await fs.writeFile(image, Buffer.from([137, 80, 78, 71, 1, 2, 3]))
  await fs.utimes(image, 100000, 100000)
  return { root, image, access: createFileAccess() }
}
test('unknown handles cannot read arbitrary paths or enumerate folders', async t => {
  const { access, image } = await fixture(t)
  await assert.rejects(access.read(image), /Unknown image/)
  await assert.rejects(access.list(image), /Unknown image/)
  await assert.rejects(access.write({ folder: path.dirname(image), name: 'x.png', buffer: Buffer.from('x') }), /Unknown/)
})
test('native grants preserve mtime and return metadata without eager file contents', async t => {
  const { access, image } = await fixture(t)
  const result = await access.grant([image])
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].lastModified, 100000000)
  assert.equal(result.files[0].buffer, undefined)
  assert.equal(result.files[0].path, undefined)
  const loaded = await access.read(result.files[0].id)
  assert.equal(loaded.buffer.byteLength, 7)
  assert.equal(loaded.lastModified, 100000000)
})
test('partial image selections keep successful entries and reject non-images', async t => {
  const { access, image, root } = await fixture(t)
  const secret = path.join(root, 'private.txt'); await fs.writeFile(secret, 'test only')
  const result = await access.grant([image, secret, path.join(root, 'missing.png')])
  assert.equal(result.files.length, 1)
  assert.match(result.error, /Unsupported image format/)
  assert.match(result.error, /missing.png/)
})
test('folder browsing grants only image handles', async t => {
  const { access, image, root } = await fixture(t)
  await fs.writeFile(path.join(root, 'b.png'), 'image')
  await fs.writeFile(path.join(root, 'secret.txt'), 'not an image')
  const { files } = await access.grant([image])
  const listing = await access.list(files[0].id)
  assert.equal(listing.entries.length, 2)
  assert.ok(listing.entries.every(e => e.id && !e.path))
  assert.equal((await access.read(listing.entries.find(e => e.name === 'b.png').id)).name, 'b.png')
})
test('separate export folders never overwrite source files', async t => {
  const { access, root, image } = await fixture(t)
  const before = await fs.readFile(image)
  const first = await access.begin(root, 'images')
  const second = await access.begin(root, 'images')
  assert.notEqual(first.path, second.path)
  await access.write({ token: first.token, name: path.basename(image), buffer: Buffer.from('export') })
  assert.deepEqual(await fs.readFile(image), before)
  assert.equal(await fs.readFile(path.join(first.path, path.basename(image)), 'utf8'), 'export')
  assert.equal(access.finish(first.token).count, 1)
})
test('traversal, absolute paths, ADS and reserved names are rejected', () => {
  for (const name of ['../x', '/x', 'a/../../x', 'C:\\x', 'x:stream', 'a\\b', 'CON.png', 'a./x', 'a//x', 'x\0.png', 'NUL']) {
    assert.throws(() => safeParts(name), /output name/i, name)
  }
  assert.deepEqual(safeParts('mipmap-hdpi/ic_launcher.png'), ['mipmap-hdpi', 'ic_launcher.png'])
})
test('duplicate output names, including case variants, never replace files', async t => {
  const { access, root } = await fixture(t)
  const session = await access.begin(root)
  await access.write({ token: session.token, name: 'A.png', buffer: Buffer.from('first') })
  await assert.rejects(access.write({ token: session.token, name: 'a.png', buffer: Buffer.from('second') }), /Duplicate/)
  assert.equal(await fs.readFile(path.join(session.path, 'A.png'), 'utf8'), 'first')
})
test('filesystem collisions created outside the session are not overwritten', async t => {
  const { access, root } = await fixture(t)
  const session = await access.begin(root)
  const target = path.join(session.path, 'existing.png')
  await fs.writeFile(target, 'preserve')
  await assert.rejects(access.write({ token: session.token, name: 'existing.png', buffer: Buffer.from('new') }), /EEXIST/)
  assert.equal(await fs.readFile(target, 'utf8'), 'preserve')
  assert.deepEqual(await fs.readdir(session.path), ['existing.png'])
})
test('export subdirectory junctions cannot redirect a write', async t => {
  const { access, root } = await fixture(t)
  const outside = path.join(root, 'outside'); await fs.mkdir(outside)
  const session = await access.begin(root)
  await fs.symlink(outside, path.join(session.path, 'mipmap'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(access.write({ token: session.token, name: 'mipmap/x.png', buffer: Buffer.from('new') }), /Unsafe/)
  assert.deepEqual(await fs.readdir(outside), [])
})
test('completed and reset capabilities cannot be reused', async t => {
  const { access, root, image } = await fixture(t)
  const { files } = await access.grant([image]); const session = await access.begin(root)
  access.finish(session.token)
  await assert.rejects(access.write({ token: session.token, name: 'x.png', buffer: Buffer.from('x') }), /Unknown/)
  access.reset()
  await assert.rejects(access.read(files[0].id), /Unknown/)
  assert.equal(access.canReveal(session.path), false)
})
test('explicit Save As replaces only its chosen regular target and cleans temporary data', async t => {
  const { root, image } = await fixture(t)
  await saveSelectedFile(image, Buffer.from('chosen overwrite'))
  assert.equal(await fs.readFile(image, 'utf8'), 'chosen overwrite')
  const fresh = path.join(root, 'new.png'); await saveSelectedFile(fresh, Buffer.from('new'))
  assert.equal(await fs.readFile(fresh, 'utf8'), 'new')
  assert.ok((await fs.readdir(root)).every(name => !name.endsWith('.tmp')))
})
test('oversized sparse image is rejected before reading its bytes', async t => {
  const { access, root } = await fixture(t)
  const name = path.join(root, 'large.png')
  const f = await fs.open(name, 'w'); await f.truncate(MAX_FILE_BYTES + 1); await f.close()
  const result = await access.grant([name])
  assert.equal(result.files.length, 0); assert.match(result.error, /128 MiB/)
})
test('all IPC calls require the current trusted main frame', () => {
  const frame = { url: APP_URL }, contents = { mainFrame: null }; contents.mainFrame = frame
  const window = { webContents: contents, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: frame }
  assert.doesNotThrow(() => assertSender(event, window))
  assert.throws(() => assertSender({ ...event, sender: {} }, window), /Untrusted/)
  assert.throws(() => assertSender({ ...event, senderFrame: { url: APP_URL } }, window), /Untrusted/)
  frame.url = 'file:///C:/private.html'; assert.throws(() => assertSender(event, window), /Untrusted/)
  assert.equal(trustedURL('imejii://evil/index.html'), false)
  assert.equal(trustedURL(APP_URL + '?untrusted=1'), false)
})
test('packaged builds ignore the development URL and dev URLs must be loopback', () => {
  assert.equal(developmentURL(true, 'https://evil.example'), '')
  assert.equal(developmentURL(false, 'http://localhost:5173'), 'http://localhost:5173/')
  for (const url of ['https://example.com', 'file:///x', 'http://user:pw@localhost:5173/', 'http://localhost:5173/untrusted']) {
    assert.throws(() => developmentURL(false, url))
  }
})
test('app protocol confines resources to dist and supplies strict security headers', async t => {
  const { root } = await fixture(t)
  const dist = path.join(root, 'dist'); await fs.mkdir(dist)
  await fs.writeFile(path.join(dist, 'index.html'), '<html>test</html>')
  const net = { fetch: async () => new Response('ok', { headers: { 'content-type': 'text/html' } }) }
  const response = await serveApp({ url: APP_URL, method: 'GET' }, dist, net)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/)
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  for (const url of ['imejii://app/%2e%2e%2fprivate.txt', 'imejii://app/..%5cprivate.txt', 'imejii://other/index.html']) {
    assert.equal((await serveApp({ url, method: 'GET' }, dist, net)).status, 404)
  }
  assert.equal((await serveApp({ url: APP_URL, method: 'POST' }, dist, net)).status, 404)
})
