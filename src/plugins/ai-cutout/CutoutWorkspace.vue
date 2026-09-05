<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { confirmDiscard, pickImages, resolveImageFile } from '../../lib/desktop.js'
import { decodePhoto, readPhotoInfo } from '../../lib/photoLoader.js'
import { sourceFingerprint } from '../../lib/drafts.js'
import AppButton from '../../components/ui/AppButton.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import { createCutoutRuntime } from './runtime.js'
import { canvas, prepareCutout, createMatte, refineMatte, INPUT_SIZE, MASK_LONG_EDGE, MAX_POINTS, MAX_STROKES } from './pipeline.js'
import StudioControls from './StudioControls.vue'
import { studioSettings } from './studio.js'
import { renderStudioAsync } from './studio-runtime.js'
import { selectionMask } from '../mask-transfer.js'
import { useUiStore } from '../../stores/ui.js'

const props = defineProps({ source: { type: Object, required: true }, host: { type: Object, required: true } })
const emit = defineEmits(['close', 'handoff'])
const dialog = ref(null), image = ref(null), stage = ref(null)
const base = shallowRef(null), strokes = shallowRef([]), redoStack = shallowRef([])
const busy = ref(false), applying = ref(false), closing = ref(false), drawingNow = ref(false)
const composing = ref(false)
let fullController = null
const phase = ref(''), error = ref(''), view = ref('cutout'), background = ref('checker')
const balance = ref(0), feather = ref(0), erase = ref(false), brushSize = ref(5), zoom = ref(1)
const section = ref('mask'), settings = ref(studioSettings()), preview = shallowRef(null), geometry = ref(null), rendering = ref(false)
const compositionError = ref(''), backgroundName = ref(''), backgroundInput = ref(null), message = ref('')
const styleUndo = shallowRef([]), styleRedo = shallowRef([])
let lastStyle = JSON.stringify(settings.value), replaying = false, styleTimer = null, previewTimer = null, renderController = null
let backgroundFile = null, backgroundPreview = null, backgroundInfo = null, renderGeneration = 0
const cursor = ref({ x: .5, y: .5, visible: false }), stageSize = ref({ width: 800, height: 600 })
const runtime = createCutoutRuntime()
const scale = Math.min(1, MASK_LONG_EDGE / Math.max(props.source.canvas.width, props.source.canvas.height))
const original = canvas(Math.max(1, Math.round(props.source.canvas.width * scale)), Math.max(1, Math.round(props.source.canvas.height * scale)))
original.getContext('2d').drawImage(props.source.canvas, 0, 0, original.width, original.height)
let matte = null, drawing = null, observer = null, frame = null, resizeFrame = null, generation = 0, disposed = false, fullResult = null
const locked = computed(() => busy.value || applying.value || !base.value)
const identityPlacement = computed(() => settings.value.frame.mode === 'original' && settings.value.placement.scale === 100 && !settings.value.placement.x && !settings.value.placement.y)
const editable = computed(() => !locked.value && section.value === 'mask' && (view.value === 'mask' || (view.value === 'cutout' && identityPlacement.value)))
const displaySize = computed(() => view.value === 'cutout' && preview.value ? preview.value : original)
const fit = computed(() => Math.max(.001, Math.min(stageSize.value.width / displaySize.value.width, stageSize.value.height / displaySize.value.height)))
const canvasStyle = computed(() => ({ width: Math.max(1, displaySize.value.width * fit.value * zoom.value) + 'px', height: Math.max(1, displaySize.value.height * fit.value * zoom.value) + 'px' }))
const cursorStyle = computed(() => ({ left: cursor.value.x * 100 + '%', top: cursor.value.y * 100 + '%', width: brushSize.value / 100 * Math.min(displaySize.value.width, displaySize.value.height) * fit.value * zoom.value + 'px', height: brushSize.value / 100 * Math.min(displaySize.value.width, displaySize.value.height) * fit.value * zoom.value + 'px' }))

function renderImage() {
  if (!image.value) return
  const ctx = image.value.getContext('2d', { willReadFrequently: true })
  image.value.width = displaySize.value.width; image.value.height = displaySize.value.height
  if (!matte || view.value === 'original') { ctx.drawImage(original, 0, 0); return }
  if (view.value === 'mask') {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, original.width, original.height); ctx.drawImage(matte, 0, 0)
  } else {
    ctx.drawImage(preview.value || original, 0, 0)
  }
}
function invalidateResult() { if (fullResult) fullResult.width = fullResult.height = 1; fullResult = null }
function scheduleComposition() {
  if (!base.value || disposed) return
  invalidateResult(); rendering.value = true; compositionError.value = ''; props.host.setDirty(true)
  clearTimeout(previewTimer); renderController?.abort(); const token = ++renderGeneration
  previewTimer = setTimeout(async () => {
    const controller = new AbortController(); renderController = controller
    try {
      const rendered = await renderStudioAsync(original, matte, settings.value, backgroundPreview, { previewLimit: 1200, sourceSize: { width: props.source.canvas.width, height: props.source.canvas.height } }, controller.signal)
      if (disposed || token !== renderGeneration) { rendered.canvas.width = rendered.canvas.height = 1; return }
      if (preview.value) preview.value.width = preview.value.height = 1
      preview.value = rendered.canvas; geometry.value = rendered.geometry; renderImage()
    } catch (err) { if (!disposed && token === renderGeneration && err.name !== 'AbortError') compositionError.value = err.message }
    finally { if (token === renderGeneration) rendering.value = false }
  }, 80)
}
function refine() {
  if (!base.value) return
  const next = refineMatte(base.value, { balance: balance.value, feather: feather.value }, [...strokes.value, ...(drawing ? [drawing] : [])])
  if (matte) matte.width = matte.height = 1
  matte = next
  invalidateResult()
  props.host.setDirty(true); renderImage(); scheduleComposition()
}
function scheduleRefine() {
  rendering.value = true
  if (!frame) frame = requestAnimationFrame(() => { frame = null; refine() })
}
function flushRefine() { if (frame) { cancelAnimationFrame(frame); frame = null; refine() } }
function point(event) {
  const r = image.value.getBoundingClientRect(), clamp = n => Math.max(0, Math.min(1, n))
  return [clamp((event.clientX - r.left) / r.width), clamp((event.clientY - r.top) / r.height)].map(n => Math.round(n * 100000) / 100000)
}
function canAdd() {
  if (strokes.value.length >= MAX_STROKES || strokes.value.reduce((n, s) => n + s.points.length, 0) >= MAX_POINTS) { error.value = 'Correction limit reached. Undo or reset corrections before continuing.'; return false }
  return true
}
function begin(event) {
  if (event.button !== 0 || !editable.value || drawing || !canAdd()) return
  error.value = ''; image.value.focus(); image.value.setPointerCapture(event.pointerId)
  drawing = { erase: erase.value, size: brushSize.value / 100, points: [point(event)], pointerId: event.pointerId }
  drawingNow.value = true
  cursor.value = { x: drawing.points[0][0], y: drawing.points[0][1], visible: true }
  scheduleRefine()
}
function move(event) {
  const [x, y] = point(event); cursor.value = { x, y, visible: true }
  if (!drawing || event.pointerId !== drawing.pointerId) return
  if (drawing.points.length + strokes.value.reduce((n, s) => n + s.points.length, 0) >= MAX_POINTS) { end(); error.value = 'Correction point limit reached.'; return }
  const last = drawing.points.at(-1)
  if (Math.hypot((x - last[0]) * original.width, (y - last[1]) * original.height) < 1) return
  drawing.points.push([x, y]); scheduleRefine()
}
function end(event) {
  if (!drawing || (event && event.pointerId !== drawing.pointerId)) return
  const { erase, size, points } = drawing
  strokes.value = [...strokes.value, { erase, size, points }]; drawing = null; drawingNow.value = false; redoStack.value = []
  scheduleRefine()
}
function undo() {
  if (locked.value || drawing || !strokes.value.length) return
  redoStack.value = [...redoStack.value, strokes.value.at(-1)]; strokes.value = strokes.value.slice(0, -1); refine()
}
function redo() {
  if (locked.value || drawing || !redoStack.value.length) return
  strokes.value = [...strokes.value, redoStack.value.at(-1)]; redoStack.value = redoStack.value.slice(0, -1); refine()
}
function reset() {
  if (locked.value || drawing) return
  strokes.value = []; redoStack.value = []; balance.value = 0; feather.value = 0; error.value = ''; refine()
}
function cancel() { generation++; runtime.dispose(); busy.value = false; phase.value = 'Canceled. Your original is unchanged.' }
async function run() {
  if (busy.value || applying.value || base.value) return
  busy.value = true; error.value = ''; const current = ++generation
  try {
    const prepared = prepareCutout(props.source.canvas)
    const output = await runtime.run(prepared, value => { if (current === generation) phase.value = value })
    if (disposed || current !== generation) return
    base.value = createMatte(output, props.source.canvas); view.value = 'cutout'; refine()
    phase.value = 'Subject mask ready. Inspect fine edges and correct any missed areas.'
  } catch (err) {
    if (!disposed && current === generation && err.name !== 'AbortError') {
      phase.value = 'Processing stopped. Your original is unchanged.'
      error.value = /bad_alloc|out of memory|memory access/i.test(err.message) ? 'The local model ran out of memory. Close other memory-intensive apps and try again.' : err.message
    }
  }
  finally { if (current === generation) busy.value = false }
}
async function apply() {
  if (locked.value || drawing || rendering.value || compositionError.value) return
  applying.value = true; error.value = ''
  try {
    flushRefine()
    if (!fullResult) {
      let backgroundFull = null
      try {
        fullController = new AbortController(); composing.value = true
        if (settings.value.background.kind === 'image' && backgroundFile) backgroundFull = await decodePhoto(backgroundFile)
        const rendered = await renderStudioAsync(props.source.canvas, matte, settings.value, backgroundFull, {}, fullController.signal)
        fullResult = rendered.canvas; geometry.value = rendered.geometry
      } finally { composing.value = false; fullController = null; if (backgroundFull) backgroundFull.width = backgroundFull.height = 1 }
    }
    const composed = JSON.stringify(settings.value) !== JSON.stringify(studioSettings())
    await props.host.apply(fullResult, { operation: composed ? 'subject-composition' : 'background-removal', inferenceSize: INPUT_SIZE, mask: { width: matte.width, height: matte.height, strokes: strokes.value }, edge: { balance: balance.value, feather: feather.value }, studio: studioSettings(settings.value), geometry: geometry.value, background: settings.value.background.kind === 'image' ? backgroundInfo : null })
    dialog.value?.close(); emit('close')
  } catch (err) { error.value = err.name === 'AbortError' ? 'Composition canceled. Your preview and settings are kept.' : 'Could not save the variant. Your preview is kept. ' + err.message }
  finally { applying.value = false }
}
async function close() {
  if (closing.value || applying.value) return
  closing.value = true
  try {
    if ((base.value || busy.value) && !await confirmDiscard('Discard this unapplied cutout and its mask corrections? Your original photo is unchanged.')) return
    cancel(); dialog.value?.close(); emit('close')
  } catch (err) { error.value = err.message }
  finally { closing.value = false }
}
function key(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); historyAction(event.shiftKey); return }
  if (event.target !== image.value || !editable.value) return
  const step = event.shiftKey ? .05 : .01, clamp = n => Math.max(0, Math.min(1, n))
  if (event.key.startsWith('Arrow')) {
    event.preventDefault()
    cursor.value = { x: clamp(cursor.value.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)), y: clamp(cursor.value.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)), visible: true }
  } else if (event.code === 'Space') {
    event.preventDefault()
    if (!canAdd() || drawing) return
    strokes.value = [...strokes.value, { erase: erase.value, size: brushSize.value / 100, points: [[cursor.value.x, cursor.value.y]] }]; redoStack.value = []; refine()
  }
}
function changeStyleHistory(forward) {
  if (locked.value || drawing) return
  const from = forward ? styleRedo : styleUndo, to = forward ? styleUndo : styleRedo
  if (!from.value.length) return
  clearTimeout(styleTimer); styleTimer = null; to.value = [...to.value, lastStyle]
  const next = from.value.at(-1); from.value = from.value.slice(0, -1)
  replaying = true; settings.value = studioSettings(JSON.parse(next)); lastStyle = JSON.stringify(settings.value); replaying = false
}
function updateSettings(value, discrete = false) {
  if (locked.value) return
  if (discrete) { clearTimeout(styleTimer); styleTimer = null }
  settings.value = studioSettings(value)
  if (discrete) { clearTimeout(styleTimer); styleTimer = null }
}
function historyAction(forward) { if (section.value === 'mask') forward ? redo() : undo(); else changeStyleHistory(forward) }
const menu = event => { if (event.detail === 'undo' || event.detail === 'redo') historyAction(event.detail === 'redo') }
async function loadBackground(file) {
  if (!file || locked.value) return
  applying.value = true; error.value = ''; message.value = ''
  let decoded = null
  try {
    file = await resolveImageFile(file)
    const info = await readPhotoInfo(file)
    if (info.width * info.height > 24000000) throw new Error('Background images are limited to 24 MP.')
    decoded = await decodePhoto(file, { maxSize: 1600 })
    const hash = await sourceFingerprint(file)
    if (disposed) return
    if (backgroundPreview) backgroundPreview.width = backgroundPreview.height = 1
    backgroundPreview = decoded; decoded = null; backgroundFile = file; backgroundName.value = file.name
    backgroundInfo = { name: file.name, sha256: hash, width: info.width, height: info.height }
    settings.value.background.kind = 'image'
    styleUndo.value = []; styleRedo.value = []; clearTimeout(styleTimer); styleTimer = null; lastStyle = JSON.stringify(settings.value)
    message.value = 'Background loaded. Style history starts from this image.'; scheduleComposition()
  } catch (err) { error.value = err.message }
  finally { if (decoded) decoded.width = decoded.height = 1; applying.value = false }
}
async function chooseBackground() {
  if (locked.value) return
  error.value = ''
  try {
    const picked = await pickImages({ multiple: false })
    if (picked) { if (picked.files?.[0]) await loadBackground(picked.files[0]); else if (picked.error) error.value = picked.error }
    else if (!window.desktopApi?.isDesktop) backgroundInput.value?.click()
  } catch (err) { error.value = err.message }
}
async function transfer(area, kind) {
  if (locked.value || drawing) return
  applying.value = true; error.value = ''; message.value = ''
  let selection
  try {
    flushRefine()
    selection = selectionMask(original, matte, area, { forRemoval: kind === 'handoff' })
    if (kind === 'studio') {
      await props.host.openStudio(selection, area)
      props.host.release(); dialog.value?.close(); emit('close'); useUiStore().setMode('ai-studio')
    } else if (kind === 'handoff') {
      const status = await window.desktopApi.aiModelStatus('lama-v1')
      if (status.state !== 'ready') throw new Error('Download the Object removal (LaMa) model in Plugins first. Your mask is kept here; you can export it now.')
      if (!await confirmDiscard('Open the original working photo and this mask in Object removal? Unapplied Studio styles are not transferred. No object is removed until you run LaMa.')) return
      const next = props.host.handoff('ai-remove', selection, { area })
      dialog.value?.close(); emit('handoff', next)
    } else {
      const result = await props.host.exportMask(selection, area, kind === 'bundle')
      message.value = result.saved ? 'Selection exported. White means selected / repaint.' : 'Export canceled. Your selection is kept.'
    }
  } catch (err) { error.value = err.message }
  finally { if (selection) selection.width = selection.height = 1; applying.value = false }
}
watch([balance, feather], scheduleRefine)
watch(settings, () => {
  const next = JSON.stringify(settings.value)
  if (!replaying && next !== lastStyle) {
    if (!styleTimer) styleUndo.value = [...styleUndo.value.slice(-29), lastStyle]
    styleRedo.value = []; lastStyle = next; clearTimeout(styleTimer); styleTimer = setTimeout(() => { styleTimer = null }, 300)
  }
  scheduleComposition()
}, { deep: true, flush: 'sync' })
watch(view, renderImage)
onMounted(async () => {
  dialog.value.showModal(); await nextTick(); renderImage()
  observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { stageSize.value = { width, height } })
  })
  observer.observe(stage.value); window.addEventListener('imejii:plugin-command', menu)
  void run()
})
onBeforeUnmount(() => {
  disposed = true; generation++; renderGeneration++; runtime.dispose(); renderController?.abort(); fullController?.abort(); clearTimeout(previewTimer); clearTimeout(styleTimer); observer?.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(resizeFrame)
  window.removeEventListener('imejii:plugin-command', menu)
  for (const c of [original, base.value, matte, fullResult, preview.value, backgroundPreview]) if (c) c.width = c.height = 1
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="cutout" aria-labelledby="cutout-title" @cancel.prevent="close" @keydown.stop="key" @drop.prevent.stop @dragover.prevent.stop>
      <header class="cutout__header">
        <div class="cutout__mark"><AppIcon name="layers" :size="22" /></div>
        <div><div class="eyebrow">IMEJII PLUGIN / LOCAL AI</div><h2 id="cutout-title">Subject Studio</h2></div>
        <div class="cutout__filename">{{ source.name }}<span>{{ geometry?.width || source.canvas.width }} × {{ geometry?.height || source.canvas.height }} · sRGB</span></div>
        <AppButton icon="close" variant="ghost" :disabled="applying || closing" @click="close">Close</AppButton>
      </header>
      <div class="cutout__body">
        <aside class="cutout__tools">
          <nav class="studio-navigation" aria-label="Subject Studio tools"><button v-for="[id, label] in [['mask','Mask'],['develop','Develop'],['background','Scene'],['frame','Frame'],['send','Send']]" :key="id" type="button" :aria-pressed="section === id" :disabled="applying || drawingNow || (id !== 'mask' && !base)" @click="section = id">{{ label }}</button></nav>
          <template v-if="section === 'mask'">
          <div class="step"><span>01</span><div><h3>Separate the subject</h3><p>BiRefNet finds the foreground. The photo’s colors stay intact; only transparency changes.</p></div></div>
          <AppButton v-if="busy" variant="ghost" icon="close" @click="cancel">Cancel processing</AppButton>
          <AppButton v-else-if="!base" variant="primary" icon="layers" :disabled="applying" @click="run">Remove background</AppButton>
          <div class="workspace-status" role="status" aria-live="polite"><span v-if="busy" class="activity" />{{ phase }}</div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="tool-divider" />
          <div class="step"><span>02</span><div><h3>Refine the silhouette</h3><p>Restore missed details or brush away unwanted areas. White in the mask means kept.</p></div></div>
          <div class="tool-switch" role="group" aria-label="Cutout correction tool">
            <button type="button" :class="{ selected: !erase }" :aria-pressed="!erase" :disabled="locked || drawingNow" @click="erase = false">Restore</button>
            <button type="button" :class="{ selected: erase }" :aria-pressed="erase" :disabled="locked || drawingNow" @click="erase = true">Remove</button>
          </div>
          <label class="range-label" for="cutout-brush">Brush size <span>{{ brushSize }}%</span></label>
          <input id="cutout-brush" v-model.number="brushSize" type="range" min="0.5" max="25" step="0.5" :disabled="locked || drawingNow">
          <div class="mask-actions"><AppButton icon="undo" variant="ghost" :disabled="locked || drawingNow || !strokes.length" @click="undo">Undo</AppButton><AppButton icon="redo" variant="ghost" :disabled="locked || drawingNow || !redoStack.length" @click="redo">Redo</AppButton></div>
          <label class="range-label" for="cutout-balance">Edge balance <span>{{ balance > 0 ? '+' : '' }}{{ balance }}</span></label>
          <input id="cutout-balance" v-model.number="balance" type="range" min="-25" max="25" step="1" :disabled="locked || drawingNow">
          <div class="range-hints"><span>Less fringe</span><span>More detail</span></div>
          <label class="range-label" for="cutout-feather">Edge softness <span>{{ feather.toFixed(1) }}</span></label>
          <input id="cutout-feather" v-model.number="feather" type="range" min="0" max="3" step="0.25" :disabled="locked || drawingNow">
          <AppButton variant="ghost" icon="reset" :disabled="locked || drawingNow" @click="reset">Reset refinements</AppButton>
          <p class="note">AI mask: 1024 px. Refinements use a working mask up to 2048 px. Inspect hair and translucent edges before saving.</p>
          <p v-if="!identityPlacement" class="note">Switch to Mask view to paint in source coordinates. Your composed layout stays intact.</p>
          </template>
          <template v-else>
            <StudioControls :settings="settings" :section="section" :disabled="locked" :background-name="backgroundName" @update:settings="updateSettings" @background-image="chooseBackground" @handoff="transfer($event, 'handoff')" @export-mask="transfer($event, 'mask')" @export-bundle="transfer($event, 'bundle')" @open-studio="transfer($event, 'studio')" />
            <div class="style-history"><AppButton variant="ghost" icon="undo" :disabled="locked || !styleUndo.length" @click="changeStyleHistory(false)">Undo style</AppButton><AppButton variant="ghost" icon="redo" :disabled="locked || !styleRedo.length" @click="changeStyleHistory(true)">Redo style</AppButton></div>
            <AppButton variant="ghost" :disabled="locked" @click="updateSettings(studioSettings(), true)">Reset style</AppButton>
            <p v-if="error" class="error" role="alert">{{ error }}</p>
          </template>
          <p v-if="message" class="note" role="status">{{ message }}</p>
          <input ref="backgroundInput" type="file" accept="image/*,.heic,.heif,.tif,.tiff" hidden @change="loadBackground($event.target.files?.[0]); $event.target.value = ''">
        </aside>
        <div class="cutout__visual">
          <div class="canvas-toolbar">
            <div class="view-switch" role="group" aria-label="Cutout preview">
              <button v-for="option in [['original', 'Original'], ['cutout', 'Cutout'], ['mask', 'Mask']]" :key="option[0]" type="button" :class="{ selected: view === option[0] }" :aria-pressed="view === option[0]" :disabled="!base || drawingNow" @click="view = option[0]">{{ option[1] }}</button>
            </div>
            <div class="zoom-tools"><button type="button" aria-label="Zoom out" @click="zoom = Math.max(1, zoom / 1.5)">−</button><button type="button" @click="zoom = 1">Fit</button><button type="button" aria-label="Zoom in" @click="zoom = Math.min(6, zoom * 1.5)">+</button></div>
          </div>
          <div v-if="rendering || compositionError || geometry?.clipped || geometry?.upscaled" class="composition-status" :class="{ error: compositionError }" :role="compositionError ? 'alert' : 'status'">{{ compositionError || (rendering ? 'Rendering composition…' : geometry?.clipped ? 'This ratio clips part of the subject. Choose Subject bounds or another ratio.' : 'Subject is upscaled to fill this frame. Check fine detail before saving.') }}</div>
          <div ref="stage" class="cutout__stage">
            <div class="canvas-shell" :class="'backdrop-' + background" :style="canvasStyle">
              <canvas ref="image" class="cutout-canvas" :class="{ editable }" tabindex="0" role="img" aria-label="Cutout preview and correction brush. Arrow keys move the brush, Space paints a dot. Shift-arrow moves further." @pointerdown.prevent="begin" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @pointerleave="cursor.visible = false" />
              <div v-if="cursor.visible && editable" class="brush-cursor" :class="{ erasing: erase }" :style="cursorStyle" />
            </div>
          </div>
          <div class="backdrop-toolbar"><span>PREVIEW BACKGROUND</span><div role="group" aria-label="Preview background"><button v-for="option in [['checker', 'Transparency'], ['light', 'Light'], ['dark', 'Dark']]" :key="option[0]" type="button" :aria-pressed="background === option[0]" :class="{ selected: background === option[0] }" @click="background = option[0]"><i :class="'swatch-' + option[0]" />{{ option[1] }}</button></div></div>
          <p class="canvas-footnote">Preview backgrounds are never saved. Export as PNG to keep transparency.</p>
        </div>
      </div>
      <footer class="cutout__footer"><div><strong>Your scene. Your original, untouched.</strong><span>Save a rendered variant. Studio styles are baked into the new photo.</span></div><AppButton v-if="composing" variant="ghost" @click="fullController?.abort()">Cancel composition</AppButton><AppButton variant="primary" icon="check" :disabled="locked || drawingNow || rendering || !!compositionError" @click="apply">{{ applying ? 'Working…' : 'Apply as new photo' }}</AppButton></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.cutout { width: min(1320px, 96vw); height: min(900px, 94vh); max-width: none; max-height: none; margin: auto; padding: 0; background: var(--bg-panel); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.cutout[open] { display: flex; flex-direction: column; }
.cutout::backdrop { background: rgb(0 0 0 / .78); }
.cutout__header { display: flex; align-items: center; gap: 14px; padding: 18px 24px; border-bottom: 1px solid var(--border); flex: none; }
.cutout__mark { color: var(--accent-text); padding: 10px; border-radius: 12px; background: var(--accent-soft); }
.eyebrow { font-size: 9px; color: var(--text-subtle); letter-spacing: .14em; }
h2 { font-size: 20px; letter-spacing: -.025em; margin: 4px 0 0; }
.cutout__filename { margin-left: auto; text-align: right; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-muted); }
.cutout__filename span { display: block; margin-top: 4px; font-size: 10px; color: var(--text-subtle); font-family: var(--font-mono); }
.cutout__body { display: flex; flex: 1; min-height: 0; }
.cutout__tools { width: 280px; padding: 24px 20px; flex: none; overflow: auto; border-right: 1px solid var(--border); }
.studio-navigation { display: flex; flex-wrap: wrap; gap: 3px; margin: -6px -4px 24px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.studio-navigation button { border: 0; border-radius: var(--radius-sm); background: transparent; padding: 7px 8px; color: var(--text-muted); font-size: 11px; }
.studio-navigation button[aria-pressed=true] { color: var(--accent-text); background: var(--accent-soft); }
.style-history { display: flex; gap: 4px; margin: 18px 0 8px; }
.composition-status { padding: 6px 20px; font-size: 11px; line-height: 1.5; color: var(--text-muted); background: var(--bg-panel); }
.step { display: flex; gap: 10px; }
.step > span { font-family: var(--font-mono); font-size: 10px; color: var(--accent-text); margin-top: 2px; }
h3 { margin: 0; font-size: 13px; font-weight: 600; }
p { font-size: 11px; line-height: 1.65; color: var(--text-muted); margin: 8px 0 16px; }
.tool-switch { display: flex; padding: 3px; gap: 3px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; }
.tool-switch button { flex: 1; border: 0; background: transparent; color: var(--text-muted); border-radius: var(--radius-sm); padding: 8px 5px; font-size: 11px; }
.tool-switch button.selected, .canvas-toolbar button.selected, .backdrop-toolbar button.selected { color: var(--accent-text); background: var(--accent-soft); }
.range-label { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 11px; margin-top: 12px; }
.range-label span { font-family: var(--font-mono); }
input[type=range] { width: 100%; margin: 10px 0; accent-color: var(--accent); }
.range-hints { display: flex; justify-content: space-between; font-size: 9px; color: var(--text-subtle); margin: -3px 0 16px; }
.mask-actions { display: flex; gap: 4px; }
.tool-divider { border-top: 1px solid var(--border); margin: 22px 0; }
.workspace-status { margin-top: 14px; min-height: 35px; font-size: 11px; line-height: 1.6; color: var(--text-muted); }
.activity { display: inline-block; height: 6px; width: 6px; border-radius: 50%; background: var(--accent); margin-right: 7px; }
.error { color: var(--danger); overflow-wrap: anywhere; }
.note { color: var(--text-subtle); font-size: 10px; }
.cutout__visual { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--canvas-bg); }
.canvas-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; gap: 12px; }
.view-switch, .zoom-tools { display: flex; gap: 4px; }
.canvas-toolbar button { border: 1px solid var(--border); background: var(--bg-panel); color: var(--text-muted); min-width: 30px; height: 28px; padding: 0 9px; border-radius: var(--radius-sm); font-size: 11px; }
.cutout__stage { flex: 1; min-height: 0; overflow: auto; display: grid; padding: 30px; }
.canvas-shell { position: relative; margin: auto; flex: none; box-shadow: 0 8px 40px rgb(0 0 0 / .15); }
.backdrop-checker, .swatch-checker { background: repeating-conic-gradient(#bbb 0% 25%, #eee 0% 50%) 50% / 16px 16px; }
.backdrop-light, .swatch-light { background: #fff; }
.backdrop-dark, .swatch-dark { background: #16191e; }
.cutout-canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.cutout-canvas.editable { cursor: crosshair; }
.brush-cursor { position: absolute; border-radius: 50%; border: 1px solid white; outline: 1px solid rgb(0 0 0 / .6); background: rgb(255 255 255 / .1); transform: translate(-50%, -50%); pointer-events: none; }
.brush-cursor.erasing { border-style: dashed; background: rgb(248 92 92 / .12); }
.backdrop-toolbar { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; align-items: center; padding: 12px 16px 0; color: var(--text-subtle); }
.backdrop-toolbar > span { font-size: 9px; letter-spacing: .08em; }
.backdrop-toolbar > div { display: flex; gap: 4px; }
.backdrop-toolbar button { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); color: var(--text-muted); background: var(--bg-panel); font-size: 10px; padding: 6px 8px; border-radius: var(--radius-sm); }
.backdrop-toolbar i { width: 12px; height: 12px; border-radius: 2px; border: 1px solid rgb(128 128 128 / .4); background-size: 8px 8px; }
.canvas-footnote { padding: 10px 20px; text-align: center; font-size: 10px; color: var(--text-subtle); margin: 0; }
.cutout__footer { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 16px 24px; border-top: 1px solid var(--border); flex: none; }
.cutout__footer strong { display: block; font-size: 12px; font-weight: 500; }
.cutout__footer span { display: block; font-size: 11px; color: var(--text-subtle); margin-top: 4px; }
button:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 1050px) { .cutout__tools { width: 235px; padding: 20px 14px; } .cutout__header { padding: 14px 18px; } }
@media (max-width: 680px) { .cutout { width: 98vw; height: 98vh; } .cutout__body { flex-direction: column-reverse; } .cutout__tools { width: auto; max-height: 36%; padding: 14px; border-right: 0; border-top: 1px solid var(--border); } .cutout__header { gap: 8px; padding: 10px; } .cutout__filename { display: none; } .cutout__header > .app-button { margin-left: auto; } h2 { font-size: 16px; } .cutout__footer { padding: 12px; } .cutout__footer > div { display: none; } .cutout__footer > button { width: 100%; } .canvas-toolbar { padding: 8px; gap: 4px; } .cutout__stage { padding: 12px; } .backdrop-toolbar > span { display: none; } }
</style>
