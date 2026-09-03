// Rasterizes the existing app mark. No new brand design or remote asset is used.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const scratch = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'imejii-icons-'))
app.setPath('userData', scratch)
app.setPath('sessionData', scratch)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('about:blank')
  const images = await window.webContents.executeJavaScript(`[16, 24, 32, 48, 64, 128, 256, 512, 1024].map(size => {
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.scale(size / 32, size / 32);
    ctx.fillStyle = '#f5b70a'; ctx.beginPath(); ctx.roundRect(0, 0, 32, 32, 8); ctx.fill();
    ctx.fillStyle = '#231900'; ctx.fill(new Path2D('M9 22V10h4.6c2.6 0 4.4 1.6 4.4 4s-1.8 4-4.4 4H12v4H9z'));
    ctx.beginPath(); ctx.arc(22, 20, 3, 0, Math.PI * 2); ctx.fill();
    return {size, data: canvas.toDataURL('image/png').split(',')[1]};
  })`)
  await fs.mkdir(path.join(root, 'build'), { recursive: true })
  await fs.writeFile(path.join(root, 'build/icon.png'), Buffer.from(images.at(-1).data, 'base64'))
  const icons = images.filter(image => image.size <= 256).map(image => ({ ...image, bytes: Buffer.from(image.data, 'base64') }))
  let offset = 6 + icons.length * 16
  const directory = Buffer.alloc(offset); directory.writeUInt16LE(1, 2); directory.writeUInt16LE(icons.length, 4)
  icons.forEach((image, index) => {
    const entry = 6 + index * 16
    directory[entry] = directory[entry + 1] = image.size === 256 ? 0 : image.size
    directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(image.bytes.length, entry + 8); directory.writeUInt32LE(offset, entry + 12)
    offset += image.bytes.length
  })
  await fs.writeFile(path.join(root, 'build/icon.ico'), Buffer.concat([directory, ...icons.map(image => image.bytes)]))
  console.log('Generated build/icon.ico and build/icon.png from the existing Imejii mark.')
  window.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
