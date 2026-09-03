// Audit-only regression checks. No real user files are read or written.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '../..')
const handlers = new Map()
const events = new Map()
const writes = []
const reads = []
let window
const contents = {
  send() {},
  setWindowOpenHandler() {},
  on(name, fn) { events.set(name, fn) },
  getURL() { return 'file:///D:/Workspace/ImejiiViewer/dist/index.html' },
}
class FakeWindow {
  constructor() { this.webContents = contents; window = this }
  once() {}
  on() {}
  loadFile() {}
  loadURL() {}
  static getAllWindows() { return [window] }
}
const fakeElectron = {
  app: {
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on() {}, getVersion: () => 'audit', quit() {},
  },
  BrowserWindow: FakeWindow,
  Menu: { buildFromTemplate: x => x, setApplicationMenu() {} },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['D:\\audit-output'] }) },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  shell: { openExternal() {}, showItemInFolder() {} },
}
const fakeFs = {
  readFile: async p => { reads.push(p); return Buffer.from('audit sentinel') },
  mkdir: async () => {},
  writeFile: async (...args) => { writes.push(args) },
}
vm.runInNewContext(await fs.readFile(path.join(root, 'electron/main.cjs'), 'utf8'), {
  require: name => ({ electron: fakeElectron, 'node:path': path.win32, 'node:fs/promises': fakeFs })[name],
  __dirname: path.join(root, 'electron'), process, Buffer, URL,
})
await Promise.resolve()
const results = []
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }) }
  catch (error) { results.push({ name, status: 'FAIL', detail: error.message }) }
}
const untrusted = { senderFrame: { url: 'https://untrusted.invalid' } }
await check('IPC rejects an untrusted sender and arbitrary non-image read', async () => {
  reads.length = 0
  try { await handlers.get('files:read')(untrusted, ['D:\\audit-sentinel.txt']) } catch {}
  assert.equal(reads.length, 0, 'files:read passed an untrusted arbitrary .txt path to fs.readFile')
})
await check('IPC confines output names to the selected folder', async () => {
  writes.length = 0
  try { await handlers.get('file:writeInto')(untrusted, { folder: 'D:\\audit-output', name: '..\\escaped.txt', buffer: new ArrayBuffer(1) }) } catch {}
  assert.equal(writes.length, 0, 'writeInto accepted traversal: ' + writes[0]?.[0])
})
await check('Folder writes request exclusive creation / overwrite protection', async () => {
  writes.length = 0
  await handlers.get('file:writeInto')({}, { folder: 'D:\\audit-output', name: 'original.jpg', buffer: new ArrayBuffer(1) })
  assert.equal(writes[0]?.[2]?.flag, 'wx', 'fs.writeFile is called without exclusive creation; existing files are truncated')
})
await check('Production navigation rejects another file URL', () => {
  let prevented = false
  events.get('will-navigate')({ preventDefault: () => { prevented = true } }, 'file:///D:/audit-untrusted.html')
  assert.equal(prevented, true, 'both file: origins are null, so the navigation guard permits a different local document')
})
const output = JSON.stringify({ harness: 'mocked main-process boundaries; real source unchanged', results }, null, 2)
await fs.writeFile(path.join(import.meta.dirname, 'main-results.json'), output + '\n')
console.log(output)
process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0
