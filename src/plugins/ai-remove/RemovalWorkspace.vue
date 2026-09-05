<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { confirmDiscard } from '../../lib/desktop.js'
import AppButton from '../../components/ui/AppButton.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import { clamp, drawStrokes, MAX_POINTS, MAX_STROKES } from './mask.js'
import { prepareRemoval, composeRemoval } from './pipeline.js'
import { createRemovalRuntime } from './runtime.js'

const props = defineProps({ source: { type: Object, required: true }, host: { type: Object, required: true } })
const emit = defineEmits(['close'])
const dialog = ref(null), paint = ref(null), image = ref(null), stage = ref(null)
const strokes = shallowRef([]), redoStack = shallowRef([]), result = shallowRef(null)
const initialMask = props.source.initialMask
const useInitialMask = ref(Boolean(initialMask))
const erase = ref(false), brushSize = ref(5), compare = ref(false), zoom = ref(1)
const busy = ref(false), applying = ref(false), phase = ref(''), error = ref(''), closing = ref(false)
const cursor = ref({ x: .5, y: .5, visible: false }), stageSize = ref({ width: 800, height: 600 })
const runtime = createRemovalRuntime()
const mask = document.createElement('canvas')
const ratio = Math.min(1, 2048 / Math.max(props.source.canvas.width, props.source.canvas.height))
mask.width = Math.max(1, Math.round(props.source.canvas.width * ratio)); mask.height = Math.max(1, Math.round(props.source.canvas.height * ratio))
let drawing = null, observer = null, generation = 0, disposed = false, frame = null, resizeFrame = null
const hasStrokes = computed(() => useInitialMask.value || strokes.value.length > 0)
const locked = computed(() => busy.value || applying.value || Boolean(result.value))
const fit = computed(() => Math.max(.001, Math.min(stageSize.value.width / mask.width, stageSize.value.height / mask.height)))
const canvasStyle = computed(() => ({ width: Math.max(1, mask.width * fit.value * zoom.value) + 'px', height: Math.max(1, mask.height * fit.value * zoom.value) + 'px' }))
const cursorStyle = computed(() => ({ left: cursor.value.x * 100 + '%', top: cursor.value.y * 100 + '%', width: brushSize.value / 100 * Math.min(mask.width, mask.height) * fit.value * zoom.value + 'px', height: brushSize.value / 100 * Math.min(mask.width, mask.height) * fit.value * zoom.value + 'px' }))

function renderMask() {
  drawStrokes(mask, [...strokes.value, ...(drawing ? [drawing] : [])], useInitialMask.value ? props.source.initialMask : null)
  const canvas = paint.value
  if (!canvas) return
  canvas.width = mask.width; canvas.height = mask.height
  const context = canvas.getContext('2d')
  context.drawImage(mask, 0, 0); context.globalCompositeOperation = 'source-in'
  context.fillStyle = 'rgba(248, 92, 92, 0.55)'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'source-over'
}
function scheduleMask() { if (!frame) frame = requestAnimationFrame(() => { frame = null; renderMask() }) }
function renderImage() {
  if (!image.value) return
  // UI is bounded to 2048 px; inference and saved result use the full snapshot.
  image.value.width = mask.width; image.value.height = mask.height
  image.value.getContext('2d').drawImage(result.value && !compare.value ? result.value : props.source.canvas, 0, 0, mask.width, mask.height)
}
function changed() {
  props.host.setDirty(hasStrokes.value || Boolean(result.value))
  renderMask()
}
function point(event) {
  const rect = paint.value.getBoundingClientRect()
  return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)].map(value => Math.round(value * 100000) / 100000)
}
function begin(event) {
  if (event.button !== 0 || locked.value || drawing) return
  if (strokes.value.length >= MAX_STROKES || strokes.value.reduce((sum, stroke) => sum + stroke.points.length, 0) >= MAX_POINTS) { error.value = 'Mask limit reached. Apply this removal or clear the mask.'; return }
  error.value = ''; paint.value.focus(); paint.value.setPointerCapture(event.pointerId)
  drawing = { erase: erase.value, size: brushSize.value / 100, points: [point(event)], pointerId: event.pointerId }
  cursor.value = { x: drawing.points[0][0], y: drawing.points[0][1], visible: true }
  props.host.setDirty(true); scheduleMask()
}
function move(event) {
  const [x, y] = point(event); cursor.value = { x, y, visible: true }
  if (!drawing || event.pointerId !== drawing.pointerId) return
  if (drawing.points.length + strokes.value.reduce((sum, stroke) => sum + stroke.points.length, 0) >= MAX_POINTS) { end(); error.value = 'Mask point limit reached. Apply or clear this selection.'; return }
  const last = drawing.points.at(-1)
  if (Math.hypot((x - last[0]) * mask.width, (y - last[1]) * mask.height) < 1) return
  drawing.points.push([x, y]); scheduleMask()
}
function end(event) {
  if (!drawing || (event && event.pointerId !== drawing.pointerId)) return
  const { erase, size, points } = drawing
  strokes.value = [...strokes.value, { erase, size, points }]; drawing = null; redoStack.value = []
  changed()
}
function undo() {
  if (locked.value || drawing || !strokes.value.length) return
  redoStack.value = [...redoStack.value, strokes.value.at(-1)]
  strokes.value = strokes.value.slice(0, -1); changed()
}
function redo() {
  if (locked.value || drawing || !redoStack.value.length) return
  strokes.value = [...strokes.value, redoStack.value.at(-1)]
  redoStack.value = redoStack.value.slice(0, -1); changed()
}
function clear() { if (locked.value) return; drawing = null; useInitialMask.value = false; strokes.value = []; redoStack.value = []; error.value = ''; changed() }
function restoreInitialMask() { if (locked.value) return; clear(); useInitialMask.value = true; changed() }
function editMask() { result.value = null; compare.value = false; renderImage(); changed() }
function cancel() { generation++; runtime.dispose(); busy.value = false; phase.value = 'Canceled. Your mask is kept.' }
async function run() {
  if (locked.value) return
  end(); error.value = ''; busy.value = true; const current = ++generation
  try {
    renderMask()
    const prepared = prepareRemoval(props.source.canvas, mask)
    const output = await runtime.run(prepared, value => { if (current === generation) phase.value = value })
    if (disposed || current !== generation) return
    phase.value = 'Composing full-resolution preview…'
    result.value = composeRemoval(props.source.canvas, mask, output, prepared)
    props.host.setDirty(true); compare.value = false; renderImage()
    phase.value = 'Preview ready. Inspect the edges before applying.'
  } catch (err) { if (!disposed && current === generation && err.name !== 'AbortError') error.value = err.message }
  finally { if (current === generation) busy.value = false }
}
async function apply() {
  if (!result.value || applying.value) return
  applying.value = true; error.value = ''
  try {
    await props.host.apply(result.value, { operation: 'object-removal', mask: { width: mask.width, height: mask.height, strokes: strokes.value, initial: useInitialMask.value ? props.source.maskProvenance : null }, inferenceSize: 512 })
    dialog.value?.close(); emit('close')
  } catch (err) { error.value = 'Could not save the variant. Your preview is kept. ' + err.message }
  finally { applying.value = false }
}
async function close() {
  if (closing.value || applying.value) return
  closing.value = true
  try {
    if ((hasStrokes.value || result.value || busy.value) && !await confirmDiscard('Discard this mask and any unapplied AI preview? Your original photo is unchanged.')) return
    cancel(); dialog.value?.close(); emit('close')
  } catch (err) { error.value = err.message }
  finally { closing.value = false }
}
function key(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
  if (event.target !== paint.value || locked.value) return
  const step = event.shiftKey ? .05 : .01
  if (event.key.startsWith('Arrow')) {
    event.preventDefault()
    cursor.value = { x: clamp(cursor.value.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 0, 1), y: clamp(cursor.value.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), 0, 1), visible: true }
  } else if (event.code === 'Space') {
    event.preventDefault()
    if (strokes.value.length >= MAX_STROKES) return
    strokes.value = [...strokes.value, { erase: erase.value, size: brushSize.value / 100, points: [[cursor.value.x, cursor.value.y]] }]
    redoStack.value = []; changed()
  }
}
const menu = event => { if (event.detail === 'undo') undo(); else if (event.detail === 'redo') redo() }
watch(compare, renderImage)
onMounted(async () => {
  dialog.value.showModal(); await nextTick(); renderImage(); renderMask()
  props.host.setDirty(hasStrokes.value)
  observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    cancelAnimationFrame(resizeFrame)
    // Updating the measured canvas during RO delivery can trigger a resize loop.
    resizeFrame = requestAnimationFrame(() => { stageSize.value = { width, height } })
  })
  observer.observe(stage.value); paint.value.focus()
  window.addEventListener('imejii:plugin-command', menu)
})
onBeforeUnmount(() => {
  disposed = true; generation++; runtime.dispose(); observer?.disconnect(); cancelAnimationFrame(frame)
  cancelAnimationFrame(resizeFrame)
  window.removeEventListener('imejii:plugin-command', menu)
  mask.width = mask.height = 1; result.value = null
  if (initialMask) initialMask.width = initialMask.height = 1
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="removal" aria-labelledby="removal-title" @cancel.prevent="close" @keydown.stop="key" @drop.prevent.stop @dragover.prevent.stop>
      <header class="removal__header">
        <div class="removal__mark"><AppIcon name="wand" :size="22" /></div>
        <div><div class="eyebrow">IMEJII PLUGIN / LOCAL AI</div><h2 id="removal-title">Object removal</h2></div>
        <div class="removal__filename">{{ source.name }}<span>{{ source.canvas.width }} × {{ source.canvas.height }} · sRGB</span></div>
        <AppButton icon="close" variant="ghost" :disabled="applying || closing" @click="close">Close</AppButton>
      </header>
      <div class="removal__body">
        <aside class="removal__tools">
          <p v-if="source.initialMask" class="transfer-note">Subject Studio selection · {{ source.maskProvenance?.area }}. Review the red area before running LaMa. Studio styles were not transferred.</p>
          <AppButton v-if="source.initialMask && !useInitialMask" variant="ghost" :disabled="locked" @click="restoreInitialMask">Restore transferred mask</AppButton>
          <div class="step"><span>01</span><div><h3>Paint the distraction</h3><p>Cover the entire object, including its shadow and a little of the surrounding edge.</p></div></div>
          <div class="tool-switch" role="group" aria-label="Mask tool">
            <button type="button" :class="{ selected: !erase }" :aria-pressed="!erase" :disabled="locked" @click="erase = false">Paint</button>
            <button type="button" :class="{ selected: erase }" :aria-pressed="erase" :disabled="locked" @click="erase = true">Erase mask</button>
          </div>
          <label class="brush-label" for="removal-brush">Brush size <span>{{ brushSize }}%</span></label>
          <input id="removal-brush" v-model.number="brushSize" type="range" min="0.5" max="25" step="0.5" :disabled="locked">
          <div class="mask-actions">
            <AppButton icon="undo" variant="ghost" :disabled="locked || !strokes.length" @click="undo">Undo</AppButton>
            <AppButton icon="redo" variant="ghost" :disabled="locked || !redoStack.length" @click="redo">Redo</AppButton>
            <AppButton variant="ghost" :disabled="locked || !hasStrokes" @click="clear">Clear</AppButton>
          </div>
          <div class="tool-divider" />
          <div class="step"><span>02</span><div><h3>Rebuild the background</h3><p>LaMa works on a 512 px context crop. Fine structures and large objects may need another selection.</p></div></div>
          <AppButton v-if="busy" variant="ghost" icon="close" @click="cancel">Cancel processing</AppButton>
          <AppButton v-else-if="!result" variant="primary" icon="wand" :disabled="!hasStrokes || applying" @click="run">Remove object</AppButton>
          <template v-else>
            <div class="tool-switch" role="group" aria-label="Compare removal">
              <button type="button" :class="{ selected: compare }" :aria-pressed="compare" @click="compare = true">Before</button>
              <button type="button" :class="{ selected: !compare }" :aria-pressed="!compare" @click="compare = false">After</button>
            </div>
            <AppButton variant="ghost" :disabled="applying" @click="editMask">Discard preview &amp; refine mask</AppButton>
          </template>
          <div class="workspace-status" role="status" aria-live="polite"><span v-if="busy" class="activity" />{{ phase || 'Your mask stays editable until you apply.' }}</div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="privacy"><AppIcon name="check" :size="14" /><p>On-device processing.<br>Your original stays untouched.</p></div>
        </aside>
        <div class="removal__visual">
          <div class="canvas-toolbar"><span>{{ result ? (compare ? 'BEFORE' : 'AI PREVIEW') : 'MASK · RED AREA WILL BE REBUILT' }}</span><div><button type="button" aria-label="Zoom out" @click="zoom = Math.max(1, zoom / 1.5)">−</button><button type="button" @click="zoom = 1">Fit</button><button type="button" aria-label="Zoom in" @click="zoom = Math.min(6, zoom * 1.5)">+</button></div></div>
          <div ref="stage" class="removal__stage">
            <div class="canvas-shell" :style="canvasStyle">
              <canvas ref="image" class="source-canvas" aria-label="Photo preview" />
              <canvas ref="paint" class="paint-canvas" :class="{ hidden: result, locked }" tabindex="0" role="img" aria-label="Object mask. Drag to paint. Keyboard: arrow keys move the brush, Space paints a dot. Shift-arrow moves further." @pointerdown.prevent="begin" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @pointerleave="cursor.visible = false" />
              <div v-if="cursor.visible && !locked" class="brush-cursor" :class="{ erasing: erase }" :style="cursorStyle" />
            </div>
          </div>
          <div class="canvas-footnote">{{ result ? 'Review the reconstruction before saving. AI can invent or distort details.' : 'Drag to paint · Scroll to navigate when zoomed · Ctrl+Z to undo' }}</div>
        </div>
      </div>
      <footer class="removal__footer"><div><strong>{{ result ? 'Ready to review' : 'Non-destructive removal' }}</strong><span>The result is saved as a separate photo with its AI provenance.</span></div><AppButton variant="primary" icon="check" :disabled="!result || busy || applying" @click="apply">{{ applying ? 'Saving variant…' : 'Apply as new photo' }}</AppButton></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.removal { width: min(1320px, 96vw); height: min(900px, 94vh); max-width: none; max-height: none; margin: auto; padding: 0; background: var(--bg-panel); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.removal[open] { display: flex; flex-direction: column; }
.removal::backdrop { background: rgb(0 0 0 / .78); }
.removal__header { display: flex; align-items: center; gap: 14px; padding: 18px 24px; border-bottom: 1px solid var(--border); flex: none; }
.removal__mark { color: var(--accent-text); padding: 10px; border-radius: 12px; background: var(--accent-soft); }
.eyebrow { font-size: 9px; color: var(--text-subtle); letter-spacing: .14em; }
h2 { font-size: 20px; letter-spacing: -.025em; margin: 4px 0 0; }
.removal__filename { margin-left: auto; text-align: right; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-muted); }
.removal__filename span { display: block; margin-top: 4px; font-size: 10px; color: var(--text-subtle); font-family: var(--font-mono); }
.removal__body { display: flex; flex: 1; min-height: 0; }
.removal__tools { width: 270px; padding: 24px 20px; flex: none; overflow: auto; border-right: 1px solid var(--border); }
.step { display: flex; gap: 10px; }
.step > span { font-family: var(--font-mono); font-size: 10px; color: var(--accent-text); margin-top: 2px; }
h3 { margin: 0; font-size: 13px; font-weight: 600; }
p { font-size: 11px; line-height: 1.65; color: var(--text-muted); margin: 8px 0 16px; }
.tool-switch { display: flex; padding: 3px; gap: 3px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; }
.tool-switch button { flex: 1; border: 0; background: transparent; color: var(--text-muted); border-radius: var(--radius-sm); padding: 8px 5px; font-size: 11px; }
.tool-switch button.selected { color: var(--accent-text); background: var(--accent-soft); }
.brush-label { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 11px; }
.brush-label span { font-family: var(--font-mono); }
input[type=range] { width: 100%; margin: 12px 0; accent-color: var(--accent); }
.mask-actions { display: flex; gap: 1px; flex-wrap: wrap; }
.tool-divider { border-top: 1px solid var(--border); margin: 24px 0; }
.workspace-status { margin-top: 14px; min-height: 35px; font-size: 11px; line-height: 1.6; color: var(--text-muted); }
.activity { display: inline-block; height: 6px; width: 6px; border-radius: 50%; background: var(--accent); margin-right: 7px; }
.error { color: var(--danger); overflow-wrap: anywhere; }
.privacy { display: flex; align-items: flex-start; gap: 8px; color: var(--text-subtle); padding-top: 24px; }
.privacy p { margin: -3px 0 0; color: var(--text-subtle); }
.removal__visual { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--canvas-bg); }
.canvas-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; gap: 12px; font-size: 9px; letter-spacing: .08em; color: var(--text-subtle); }
.canvas-toolbar > div { display: flex; gap: 4px; }
.canvas-toolbar button { border: 1px solid var(--border); background: var(--bg-panel); color: var(--text-muted); min-width: 30px; height: 26px; border-radius: var(--radius-sm); }
.removal__stage { flex: 1; min-height: 0; overflow: auto; display: grid; padding: 32px; }
.canvas-shell { position: relative; margin: auto; flex: none; box-shadow: 0 8px 40px rgb(0 0 0 / .15); background: repeating-conic-gradient(#aaa 0% 25%, #eee 0% 50%) 50% / 16px 16px; }
.source-canvas, .paint-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.paint-canvas { touch-action: none; cursor: crosshair; }
.paint-canvas.hidden { opacity: 0; pointer-events: none; }
.paint-canvas.locked { cursor: default; }
.brush-cursor { position: absolute; border-radius: 50%; border: 1px solid white; outline: 1px solid rgb(0 0 0 / .6); background: rgb(248 92 92 / .12); transform: translate(-50%, -50%); pointer-events: none; }
.brush-cursor.erasing { border-style: dashed; background: rgb(255 255 255 / .12); }
.canvas-footnote { flex: none; padding: 12px 20px; text-align: center; font-size: 10px; color: var(--text-subtle); }
.removal__footer { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 16px 24px; border-top: 1px solid var(--border); flex: none; }
.removal__footer strong { display: block; font-size: 12px; font-weight: 500; }
.removal__footer span { display: block; font-size: 11px; color: var(--text-subtle); margin-top: 4px; }
button:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 1050px) { .removal__tools { width: 235px; padding: 20px 14px; } .removal__header { padding: 14px 18px; } }
</style>
