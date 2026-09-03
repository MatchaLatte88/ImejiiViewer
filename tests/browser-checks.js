import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import App from '../src/App.vue'
import { useLibraryStore } from '../src/stores/library.js'
import { useUiStore } from '../src/stores/ui.js'
import { beginFileSet, isDesktop } from '../src/lib/desktop.js'
import { createCanvas } from '../src/lib/transform.js'
import { canvasToBlob } from '../src/lib/exportImage.js'
import SegmentedControl from '../src/components/ui/SegmentedControl.vue'
import JSZip from 'jszip'

const pinia = createPinia()
createApp(App).use(pinia).mount('#app')
const assert = (ok, detail) => { if (!ok) throw new Error(detail) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
globalThis.runBrowserChecks = async () => {
  const results = []
  async function check(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }) }
    catch (error) { results.push({ name, status: 'FAIL', detail: error.message }) }
  }
  const downloads = []
  const nativeClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, url: this.href }) }
  try {
    await check('Browser adapter has no desktop privileges', () => assert(!isDesktop && !window.desktopApi, 'desktop API unexpectedly present'))
    await check('Browser file sets produce a valid ZIP with all files', async () => {
      const session = await beginFileSet({ zipName: 'test.zip' })
      await session.write({ name: 'a.txt', text: 'first' })
      await session.write({ name: 'nested/b.txt', text: 'second' })
      const result = await session.finish()
      assert(result.mode === 'zip' && result.count === 2, 'incorrect result')
      const bytes = await (await fetch(downloads.at(-1).url)).arrayBuffer()
      const zip = await JSZip.loadAsync(bytes)
      assert(await zip.file('a.txt').async('string') === 'first', 'first ZIP entry lost')
      assert(await zip.file('nested/b.txt').async('string') === 'second', 'nested ZIP entry lost')
    })
    await check('Canceled browser file set triggers no download', async () => {
      const before = downloads.length
      const session = await beginFileSet({ zipName: 'cancel.zip' })
      await session.write({ name: 'x.txt', text: 'test' })
      await session.finish({ canceled: true })
      assert(downloads.length === before, 'download started after cancel')
    })
    const s = useLibraryStore(pinia)
    const png = await canvasToBlob(createCanvas(40, 20))
    await s.addFiles([new File([png], 'keyboard.png', { type: 'image/png' })])
    useUiStore(pinia).setMode('images')
    await nextTick()
    await check('Browser Ctrl+S exports the active image', async () => {
      const before = downloads.length
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
      for (let i = 0; i < 100 && downloads.length === before; i++) await pause(20)
      assert(downloads.length === before + 1 && downloads.at(-1).name === 'keyboard.png', 'Ctrl+S did not export once')
    })
    await check('Ctrl/Alt combinations never invoke plain photo edit shortcuts', async () => {
      const before = s.activeItem.edits.rotate
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', altKey: true }))
      assert(s.activeItem.edits.rotate === before, 'modifier caused rotation')
    })
    await check('Typing undo stays inside the input field', async () => {
      s.rotateBy(90)
      const input = document.querySelector('input[type=number]')
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
      assert(s.activeItem.edits.rotate === 90, 'input undo changed photo history')
      input.blur()
    })
    await check('Disabled segmented controls use native disabled buttons', async () => {
      const element = document.createElement('div'); document.body.append(element)
      const child = createApp(SegmentedControl, { disabled: true, options: [{ value: 'one', label: 'One' }] })
      child.mount(element)
      assert(element.querySelector('button').disabled, 'only CSS-disabled')
      child.unmount(); element.remove()
    })
    await check('Notices have live-region semantics', async () => {
      useUiStore(pinia).setNotice('info', 'Test notice'); await nextTick()
      assert(document.querySelector('.toast[role=status][aria-live=polite]'), 'notice not announced')
    })
    await check('Unsaved browser work cancels beforeunload', () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      assert(event.defaultPrevented, 'no dirty guard')
    })
    await check('Actual-pixel view loads the full source on demand', async () => {
      const large = await canvasToBlob(createCanvas(3000, 10))
      const ids = await s.addFiles([new File([large], 'wide.png', { type: 'image/png' })])
      await s.select(ids[0])
      assert(s.sourceCanvas.width === 2600, 'preview limit missing')
      await s.showActualPixels()
      assert(s.sourceCanvas.width === 3000 && s.zoom === 1 && !s.fitToView, 'not actual pixels')
    })
  } finally { HTMLAnchorElement.prototype.click = nativeClick }
  return { results }
}
globalThis.imejiiTestReady = true
