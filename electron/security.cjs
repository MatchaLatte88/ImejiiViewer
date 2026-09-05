const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { inside } = require('./file-access.cjs')

const APP_URL = 'imejii://app/index.html'
function developmentURL(isPackaged, value) {
  if (isPackaged || !value) return ''
  const u = new URL(value)
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Development server must be a loopback HTTP root URL.')
  return u.href
}
function trustedURL(url, devURL = '') {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href === (devURL || APP_URL)
  } catch { return false }
}
function assertSender(event, window, devURL = '') {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trustedURL(event.senderFrame.url, devURL)) throw new Error('Untrusted IPC sender.')
}
async function serveApp(request, distRoot, net) {
  try {
    const url = new URL(request.url)
    if (url.protocol !== 'imejii:' || url.hostname !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 })
    const pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('\\') || pathname.includes('\0')) return new Response('Not found', { status: 404 })
    const root = await fs.realpath(distRoot)
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    const real = await fs.realpath(target)
    if (!inside(root, real) || !(await fs.stat(real)).isFile()) return new Response('Not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(real).href)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
    if (path.extname(real) === '.wasm') headers.set('Content-Type', 'application/wasm')
    if (path.extname(real) === '.mjs') headers.set('Content-Type', 'text/javascript')
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
  } catch { return new Response('Not found', { status: 404 }) }
}
module.exports = { APP_URL, developmentURL, trustedURL, assertSender, serveApp }
