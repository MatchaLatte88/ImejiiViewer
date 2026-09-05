<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStudioStore } from '../../stores/studio.js'
import { useLibraryStore } from '../../stores/library.js'
import { useEditorStore } from '../../stores/editor.js'
import { openCurrentInStudio } from '../studio-host.js'
import { isDesktop } from '../../lib/desktop.js'
import { clamp } from '../ai-remove/mask.js'
import { SDXL_SIZES } from '../../lib/studioDocument.js'
import AppButton from '../../components/ui/AppButton.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import SliderControl from '../../components/ui/SliderControl.vue'

const emit = defineEmits(['open-file'])
const studio = useStudioStore(), library = useLibraryStore(), editor = useEditorStore()
const stage = ref(null), image = ref(null), overlay = ref(null), maskInput = ref(null)
const brush = ref(6), erase = ref(false), zoom = ref(1), showMask = ref(true), setup = ref(true)
const size = ref({ width: 640, height: 600 }), cursor = ref(null), thumbnails = ref([])
let observer, stroke = null, pointerId, frame, resizeFrame, renderVersion = 0, disposed = false
const editable = computed(() => studio.operation === 'inpaint' && studio.hasSource && !studio.busy && !studio.selectedResult && !studio.compare)
const displaySize = computed(() => studio.selectedResult && !studio.compare ? { width: studio.selectedResult.provenance.outputWidth || studio.document.width, height: studio.selectedResult.provenance.outputHeight || studio.document.height }
  : studio.operation !== 'text-to-image' && studio.source ? { width: studio.source.width, height: studio.source.height } : null)
const hasPreview = computed(() => Boolean(displaySize.value))
const fit = computed(() => displaySize.value ? Math.min((size.value.width - 40) / displaySize.value.width, (size.value.height - 40) / displaySize.value.height) : 1)
const canvasStyle = computed(() => displaySize.value ? { width: Math.max(1, displaySize.value.width * fit.value * zoom.value) + 'px', height: Math.max(1, displaySize.value.height * fit.value * zoom.value) + 'px' } : {})
const cursorStyle = computed(() => cursor.value && studio.source ? {
  left: cursor.value[0] * 100 + '%', top: cursor.value[1] * 100 + '%',
  width: brush.value / 100 * Math.min(studio.source.width, studio.source.height) * fit.value * zoom.value + 'px',
  height: brush.value / 100 * Math.min(studio.source.width, studio.source.height) * fit.value * zoom.value + 'px',
} : {})
const originLabel = computed(() => ({ 'file': 'Opened image', 'photo-working-copy': 'Current photo edits', 'logo-working-copy': 'Current logo · up to 4096 px', 'subject-studio-before-composition': 'Photo before Subject Studio styles' })[studio.document?.sourceOrigin?.kind] || 'Saved source snapshot')
const operationCopy = computed(() => ({
  'text-to-image': { title: 'Text to image', description: 'Create a new image from your prompt.', prompt: 'Describe the complete image to generate.', status: 'Describe an image, choose its size and generate a variant.' },
  inpaint: { title: 'Inpainting', description: 'Reimagine a selected area and keep the rest.', prompt: 'Describe the content inside your selection.', status: 'Paint a selection, then describe the replacement.' },
  outpaint: { title: 'Outpainting', description: 'Continue an image beyond its current edges.', prompt: 'Describe how the scene should continue.', status: 'Choose the new canvas edges and describe how the scene continues.' },
})[studio.operation])
const sizeValue = computed({
  get: () => studio.document ? studio.document.parameters.width + 'x' + studio.document.parameters.height : '1024x1024',
  set: value => { if (studio.document) { const [width, height] = value.split('x').map(Number); studio.document.parameters.width = width; studio.document.parameters.height = height } },
})
const randomizeSeed = computed({
  get: () => studio.document?.parameters?.randomizeSeed !== false,
  set: value => { if (studio.document) studio.document.parameters.randomizeSeed = value },
})
const modelOptions = computed(() => studio.connection?.models?.length ? studio.connection.models : studio.document?.parameters?.model ? [studio.document.parameters.model] : [])
const modelDisplay = model => model === 'sd_xl_base_1.0.safetensors' ? 'SDXL Base 1.0 · official filename' : model
const testLabel = computed(() => 'Test local ' + operationCopy.value.title.toLowerCase())
async function act(fn) { studio.error = ''; try { await fn() } catch (error) { studio.error = error.message } }
async function renderImage() {
  const version = ++renderVersion
  await nextTick()
  if (!image.value || !hasPreview.value) return
  const canvas = studio.selectedResult && !studio.compare ? await studio.resultCanvas() : studio.operation !== 'text-to-image' ? studio.source : null
  if (disposed || version !== renderVersion || !image.value || !canvas) return
  const ratio = Math.min(1, 2048 / Math.max(canvas.width, canvas.height))
  image.value.width = Math.max(1, Math.round(canvas.width * ratio)); image.value.height = Math.max(1, Math.round(canvas.height * ratio))
  image.value.getContext('2d').drawImage(canvas, 0, 0, image.value.width, image.value.height)
  renderMask()
}
function renderMask() {
  if (!overlay.value || !studio.source || studio.operation !== 'inpaint') return
  const mask = studio.mask(stroke)
  overlay.value.width = mask.width; overlay.value.height = mask.height
  const ctx = overlay.value.getContext('2d')
  if (!showMask.value || studio.selectedResult || studio.compare) return
  ctx.drawImage(mask, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = 'rgba(244, 91, 100, .56)'
  ctx.fillRect(0, 0, mask.width, mask.height); ctx.globalCompositeOperation = 'source-over'
}
function scheduleMask() { if (!frame) frame = requestAnimationFrame(() => { frame = null; renderMask() }) }
function point(event) {
  const rect = overlay.value.getBoundingClientRect()
  return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)]
}
function begin(event) {
  if (event.button !== 0 || !editable.value || stroke) return
  const count = studio.document.strokes.reduce((n, s) => n + s.points.length, 0)
  if (studio.document.strokes.length >= 120 || count >= 24000) { studio.error = 'Mask history is full. Save this project and open the source as a new session.'; return }
  overlay.value.focus(); overlay.value.setPointerCapture(event.pointerId); pointerId = event.pointerId
  stroke = { erase: erase.value, size: brush.value / 100, points: [point(event)] }; studio.drawing = true
  cursor.value = point(event); scheduleMask()
}
function move(event) {
  cursor.value = point(event)
  if (!stroke || event.pointerId !== pointerId) return
  if (studio.document.strokes.reduce((n, s) => n + s.points.length, 0) + stroke.points.length >= 24000) { finish(); return }
  stroke.points.push(point(event)); scheduleMask()
}
function finish() {
  if (!stroke) return
  const completed = stroke; stroke = null; studio.drawing = false
  void act(() => studio.addStroke(completed)); scheduleMask()
}
function keydown(event) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable) return
  if (!isDesktop && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? studio.redo() : studio.undo(); return }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.code === 'Space' && studio.source && studio.selectedResult?.provenance.sourceSha256) { event.preventDefault(); studio.compare = true }
  if (event.key.toLowerCase() === 'b') erase.value = false
  if (event.key.toLowerCase() === 'e') erase.value = true
  if (event.key === '[') brush.value = Math.max(1, brush.value - 1)
  if (event.key === ']') brush.value = Math.min(50, brush.value + 1)
}
const keyup = event => { if (event.code === 'Space') studio.compare = false }
const blur = () => { studio.compare = false; finish() }
function refreshThumbnails() {
  for (const thumbnail of thumbnails.value) URL.revokeObjectURL(thumbnail.url)
  thumbnails.value = (studio.document?.results || []).map(result => ({ ...result, url: studio.resultURL(result) }))
}
watch(() => [studio.source, studio.selected, studio.compare, studio.operation], () => { void act(renderImage) })
watch(() => [studio.document?.revision, showMask.value, studio.operation], scheduleMask)
watch(() => studio.document?.results.map(result => result.id + result.accepted).join(','), refreshThumbnails)
watch(() => studio.connection, value => { if (value?.modelAvailable) setup.value = false })
onMounted(async () => {
  observer = new ResizeObserver(entries => {
    const rect = entries[0].contentRect
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => { size.value = { width: rect.width, height: rect.height } })
  })
  observer.observe(stage.value)
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur)
  await act(() => studio.initialize()); refreshThumbnails(); await act(renderImage)
})
onBeforeUnmount(() => {
  finish(); disposed = true; observer?.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(resizeFrame)
  window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur)
  for (const thumbnail of thumbnails.value) URL.revokeObjectURL(thumbnail.url)
  studio.compare = false
})
</script>

<template>
  <section class="ai-studio" aria-label="AI Studio SDXL workspace">
    <aside class="tools">
      <div class="studio-title"><span class="eyebrow">LOCAL CREATIVE TOOLS</span><h2>AI Studio<span>01</span></h2></div>
      <div class="operation-switch" aria-label="SDXL operation">
        <button v-for="item in [{ id: 'text-to-image', label: 'Text' }, { id: 'inpaint', label: 'Inpaint' }, { id: 'outpaint', label: 'Outpaint' }]" :key="item.id" type="button" :aria-pressed="studio.operation === item.id" :disabled="studio.busy || studio.drawing" @click="act(() => studio.setOperation(item.id))">{{ item.label }}</button>
      </div>
      <div class="operation"><AppIcon name="wand" :size="16" /><strong>{{ operationCopy.title }}</strong><span class="dot" /></div>
      <p class="small">{{ operationCopy.description }}</p>
      <div class="divider" />
      <template v-if="studio.operation === 'text-to-image'">
        <span class="eyebrow">01 / CANVAS</span>
        <label class="field">Output size<select v-model="sizeValue" :disabled="studio.busy"><option v-for="([width, height]) in SDXL_SIZES" :key="width + 'x' + height" :value="width + 'x' + height">{{ width }} × {{ height }}</option></select></label>
        <p class="small">SDXL-native aspect ratios. Each run creates one local variant.</p>
      </template>
      <template v-else>
        <span class="eyebrow">01 / SOURCE</span>
        <AppButton icon="upload" :disabled="studio.busy || studio.drawing" @click="emit('open-file')">Open image</AppButton>
        <AppButton v-if="library.activeItem" variant="ghost" :disabled="studio.busy || studio.drawing" @click="act(() => openCurrentInStudio('images'))">Use current photo</AppButton>
        <AppButton v-if="editor.hasImage" variant="ghost" :disabled="studio.busy || studio.drawing" @click="act(() => openCurrentInStudio('logo'))">Use current logo</AppButton>
        <template v-if="studio.source">
          <p class="source-name">{{ studio.document.name }}</p><p class="small">{{ originLabel }}<br>{{ studio.document.width }} × {{ studio.document.height }} px<span v-if="studio.document.sourceOrigin?.area"><br>Selection: {{ studio.document.sourceOrigin.area }}</span></p>
        </template>
      </template>
      <template v-if="studio.operation === 'inpaint'">
        <div class="divider" />
        <span class="eyebrow">02 / SELECTION</span>
        <div class="brush-modes">
          <button type="button" :aria-pressed="!erase" :disabled="!editable" @click="erase = false">Paint <kbd>B</kbd></button>
          <button type="button" :aria-pressed="erase" :disabled="!editable" @click="erase = true">Erase <kbd>E</kbd></button>
        </div>
        <SliderControl v-model="brush" label="Brush size" :min="1" :max="50" unit="%" :disabled="!editable" />
        <label class="check"><input v-model="showMask" type="checkbox"> Show selection</label>
        <p class="small"><i class="swatch" /> Coral marks the area to repaint. Keep it close to the desired object with a little margin; the complete marked area is regenerated. Hold Space to compare.</p>
        <AppButton variant="ghost" :disabled="!editable || studio.drawing" @click="act(() => studio.clearMask())">Clear selection</AppButton>
        <AppButton variant="ghost" :disabled="!editable || studio.drawing" @click="maskInput.click()">Import mask PNG</AppButton>
        <input ref="maskInput" type="file" accept="image/png" class="sr-only" aria-label="Import grayscale mask" @change="act(() => studio.importMask($event.target.files[0])); $event.target.value = ''">
        <p class="small">Mask import: white repaints, black preserves. Same dimensions as the source.</p>
      </template>
      <template v-else-if="studio.operation === 'outpaint' && studio.document">
        <div class="divider" />
        <span class="eyebrow">02 / EXTEND</span>
        <div class="outpaint-grid">
          <label>Left<input v-model.number="studio.document.parameters.outpaint.left" type="number" min="0" max="2048" step="64" :disabled="studio.busy"></label>
          <label>Right<input v-model.number="studio.document.parameters.outpaint.right" type="number" min="0" max="2048" step="64" :disabled="studio.busy"></label>
          <label>Top<input v-model.number="studio.document.parameters.outpaint.top" type="number" min="0" max="2048" step="64" :disabled="studio.busy"></label>
          <label>Bottom<input v-model.number="studio.document.parameters.outpaint.bottom" type="number" min="0" max="2048" step="64" :disabled="studio.busy"></label>
        </div>
        <label class="field">Blend overlap<input v-model.number="studio.document.parameters.outpaint.overlap" type="number" min="0" max="256" step="8" :disabled="studio.busy"></label>
        <p class="small">Pixels added around the source. The overlap softens the join while preserving the interior.</p>
      </template>
      <p class="footnote">Originals stay intact.<br>Every result starts as a variant.</p>
    </aside>

    <div class="visual">
      <div class="canvas-bar"><span>{{ studio.selectedResult ? 'VARIANT PREVIEW' : 'SOURCE & SELECTION' }}</span><div><button type="button" :disabled="!studio.hasSource" @click="zoom = Math.max(.25, zoom / 1.25)" aria-label="Zoom out">−</button><button type="button" @click="zoom = 1">{{ Math.round(zoom * 100) }}% · Fit</button><button type="button" :disabled="!studio.hasSource" @click="zoom = Math.min(4, zoom * 1.25)" aria-label="Zoom in">+</button></div></div>
      <div ref="stage" class="stage">
        <div v-if="hasPreview" class="canvas-wrap" :style="canvasStyle">
          <canvas ref="image" class="source-canvas" />
          <canvas v-show="studio.operation === 'inpaint' && !studio.selectedResult" ref="overlay" class="mask-canvas" :class="{ editable }" tabindex="0" role="img" aria-label="Inpainting mask canvas. Drag to paint. B paints, E erases, Control Z undoes." @pointerdown="begin" @pointermove="move" @pointerup="finish" @pointercancel="finish" @lostpointercapture="finish" @pointerleave="cursor = null" />
          <span v-if="cursor && editable" class="brush-cursor" :style="cursorStyle" />
          <span v-if="studio.compare" class="compare-label">SOURCE</span>
        </div>
        <div v-else class="empty">
          <div class="empty-mark"><AppIcon name="wand" :size="32" /><span class="mark-corner tl" /><span class="mark-corner tr" /><span class="mark-corner bl" /><span class="mark-corner br" /></div>
          <span class="eyebrow">LOCAL SDXL · YOUR CANVAS</span>
          <h3>{{ studio.operation === 'text-to-image' ? 'Start with words.' : 'Start with your image.' }}</h3>
          <p>{{ studio.operation === 'text-to-image' ? 'Describe the scene and generate a new local image.' : studio.operation === 'outpaint' ? 'Choose a source and continue it beyond the frame.' : 'Paint what you want to change and describe what belongs there.' }}</p>
          <AppButton v-if="studio.operation !== 'text-to-image'" variant="primary" icon="upload" @click="emit('open-file')">Choose a source image</AppButton>
          <p class="small">Your masks and variants are saved on this device.</p>
        </div>
      </div>
      <div class="job-status" role="status" aria-live="polite"><span v-if="studio.busy" class="working-dot" /><span>{{ studio.currentJob?.message || operationCopy.status }}</span><span class="save-status">{{ studio.saveState === 'saved' ? 'Saved locally' : studio.saveState === 'error' ? 'Save failed' : 'Saving…' }}</span></div>
      <div class="variants" aria-label="Generated variants">
        <div class="variants-title"><span class="eyebrow">VARIANTS</span><span>{{ thumbnails.length }} / 8</span></div>
        <button v-if="studio.source && studio.operation !== 'text-to-image'" type="button" class="source-tile" :aria-pressed="!studio.selected" @click="studio.selected = null"><AppIcon name="image" :size="18" /><span>{{ studio.operation === 'inpaint' ? 'Source + mask' : 'Source image' }}</span></button>
        <div v-for="(thumbnail, index) in thumbnails" :key="thumbnail.id" class="variant-tile" :class="{ selected: studio.selected === thumbnail.id }">
          <button type="button" class="variant-select" :aria-pressed="studio.selected === thumbnail.id" :aria-label="'Preview variant ' + (index + 1)" @click="studio.selected = thumbnail.id"><img :src="thumbnail.url" :alt="'SDXL variant ' + (index + 1)"><span>{{ String(index + 1).padStart(2, '0') }} {{ thumbnail.accepted ? '· Saved to Images' : '· ' + thumbnail.provenance.operation }}</span></button>
          <button type="button" class="remove-variant" :disabled="studio.busy" :aria-label="'Remove variant ' + (index + 1)" @click="studio.removeResult(thumbnail.id)">×</button>
        </div>
        <p v-if="!thumbnails.length" class="small variants-empty">Generated options appear here.<br>Choose what to keep.</p>
      </div>
    </div>

    <aside class="parameters">
      <button type="button" class="connection" :aria-expanded="setup" @click="setup = !setup"><span :class="['connection-dot', { connected: studio.connection?.modelAvailable }]" /><span>{{ studio.connection?.modelAvailable ? 'ComfyUI connected' : 'Connect local ComfyUI' }}<small>{{ studio.connection?.modelAvailable ? '127.0.0.1:' + studio.port : 'Local backend setup' }}</small></span><AppIcon name="chevron" :size="12" /></button>
      <div v-if="setup" class="setup">
        <p>Start your trusted ComfyUI installation on this computer. Imejii reads locally installed <strong>SDXL .safetensors</strong> checkpoints and runs them through three pinned workflows.</p>
        <label class="field">Local port <input v-model.number="studio.port" type="number" min="1024" max="65535" :disabled="studio.busy || studio.connecting"></label>
        <AppButton :disabled="studio.busy || studio.connecting || !isDesktop" @click="act(() => studio.connect())">{{ studio.connecting ? 'Checking…' : 'Connect & check' }}</AppButton>
        <p class="small">Connect checks the server and standard nodes. Source images and masks are copied only for inpainting or outpainting. ComfyUI keeps its own input and output copies.</p>
        <p v-if="!isDesktop" class="error">Open the desktop app to use local SDXL.</p>
        <p v-if="studio.connection && !studio.connection.modelAvailable" class="error">No safe .safetensors checkpoint was reported by ComfyUI. Add an SDXL checkpoint under models/checkpoints and reconnect.</p>
      </div>
      <div class="prompt-heading"><span class="eyebrow">03 / PROMPT</span><h3>{{ studio.operation === 'text-to-image' ? 'What do you imagine?' : studio.operation === 'outpaint' ? 'What continues?' : 'What belongs here?' }}</h3><p class="small">{{ operationCopy.prompt }}</p></div>
      <fieldset :disabled="!studio.hasInput || studio.busy || studio.drawing">
        <template v-if="studio.document">
          <label class="field">Prompt<textarea v-model="studio.document.parameters.prompt" maxlength="4000" rows="5" placeholder="A ceramic vase with wildflowers, soft window light, natural shadows…" /></label>
          <label class="field">Negative prompt <span class="optional">optional</span><textarea v-model="studio.document.parameters.negative" maxlength="4000" rows="2" placeholder="Blurry, distorted, text…" /></label>
          <div class="model-label"><label class="field">SDXL checkpoint<select v-model="studio.document.parameters.model" :disabled="studio.busy || !studio.connection?.modelAvailable"><option v-for="model in modelOptions" :key="model" :value="model">{{ modelDisplay(model) }}</option></select></label><small>From ComfyUI/models/checkpoints · {{ operationCopy.title }} uses a pinned local workflow. Reconnect after adding a model.</small></div>
          <p v-if="studio.operation !== 'text-to-image'" class="small">Full replacement strength is fixed at 1.0 so the neutral masked latent cannot remain as a gray patch.</p>
          <details class="advanced"><summary>Advanced settings</summary><label class="seed-mode"><input v-model="randomizeSeed" type="checkbox" :disabled="studio.busy"> New random seed for every variant</label><label class="field">{{ randomizeSeed ? 'Last used seed' : 'Fixed seed' }}<input v-model.number="studio.document.parameters.seed" type="number" min="0" max="4294967295" step="1" :disabled="randomizeSeed || studio.busy"></label><button v-if="!randomizeSeed" type="button" class="random-seed" :disabled="studio.busy" @click="studio.randomSeed">New random seed</button><SliderControl v-model="studio.document.parameters.steps" label="Steps" :min="1" :max="50" /><SliderControl v-model="studio.document.parameters.cfg" label="Prompt guidance" :min="1" :max="15" :step=".5" /><p class="small">DPM++ 2M SDE · Karras<br>Scene-aware context crop with edge padding. Alpha is preserved.</p></details>
        </template>
        <p v-else class="small">{{ studio.operation === 'text-to-image' ? 'Choose Text again to create a new prompt session.' : 'Open a source image to begin.' }}</p>
      </fieldset>
      <div class="run-actions">
        <template v-if="studio.validationRequired"><p class="small">This checkpoint and workflow combination needs one local test for the current connection. A listed filename alone does not prove SDXL compatibility.</p><AppButton variant="primary" icon="wand" :disabled="!studio.hasInput || !studio.connection?.modelAvailable || studio.busy || studio.drawing" @click="act(() => studio.run(true))">{{ testLabel }}</AppButton></template>
        <AppButton v-else variant="primary" icon="wand" :disabled="!studio.hasInput || !studio.connection?.modelAvailable || studio.busy || studio.drawing" @click="act(() => studio.run())">Generate variant</AppButton>
        <AppButton v-if="studio.busy && studio.currentJob && studio.currentJob.state !== 'canceled'" variant="ghost" @click="act(() => studio.cancel())">Cancel result</AppButton>
        <template v-if="studio.selectedResult"><AppButton variant="primary" :disabled="studio.busy" @click="act(() => studio.acceptResult())">Keep & open in Images</AppButton><AppButton :disabled="studio.busy" icon="download" @click="act(() => studio.exportResult())">Export variant PNG</AppButton></template>
        <p v-if="studio.error" class="error" role="alert">{{ studio.error }}</p>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.ai-studio { display: grid; grid-template-columns: 208px minmax(0, 1fr) 300px; width: 100%; min-height: 0; color: var(--text); background: var(--bg); }
.tools, .parameters { display: flex; flex-direction: column; gap: 14px; padding: 22px 18px; background: var(--bg-panel); overflow: auto; min-height: 0; }
.tools { border-right: 1px solid var(--border); } .parameters { border-left: 1px solid var(--border); }
.tools > *, .parameters > * { flex-shrink: 0; }
.eyebrow { font: 9px var(--font-mono); letter-spacing: .12em; color: var(--text-subtle); }
h2 { font-size: 24px; font-weight: 600; letter-spacing: -.055em; margin: 8px 0 10px; display: flex; justify-content: space-between; align-items: baseline; } h2 span { font: 11px var(--font-mono); color: var(--accent-text); }
h3 { font-size: 18px; letter-spacing: -.035em; font-weight: 500; margin: 7px 0 10px; }
p { margin: 0; font-size: 12px; line-height: 1.65; color: var(--text-muted); } .small, .footnote { font-size: 11px; color: var(--text-subtle); line-height: 1.65; } .footnote { margin-top: auto; padding-top: 20px; }
.operation { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--accent-soft); color: var(--accent-text); font-size: 12px; }
.operation-switch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
.operation-switch button { border: 0; border-radius: calc(var(--radius) - 2px); padding: 7px 3px; color: var(--text-subtle); background: transparent; font-size: 9px; }
.operation-switch button[aria-pressed=true] { color: var(--text); background: var(--bg-active); }
.dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; margin-left: auto; }
.divider { border-top: 1px solid var(--border); margin: 2px 0; } .source-name { overflow-wrap: anywhere; color: var(--text); font-size: 12px; margin-bottom: -10px; }
.brush-modes { display: flex; gap: 4px; } .brush-modes button { flex: 1; border: 1px solid var(--border); padding: 8px 6px; border-radius: var(--radius); font-size: 11px; color: var(--text-muted); background: transparent; display: flex; justify-content: space-between; }
.brush-modes button[aria-pressed=true] { background: var(--bg-active); color: var(--text); border-color: var(--text-subtle); } kbd { font: 9px var(--font-mono); color: var(--text-subtle); }
.check { display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); align-items: center; } input[type=checkbox] { accent-color: var(--accent); }
.swatch { display: inline-block; width: 7px; height: 7px; background: #f45b64; border-radius: 50%; margin-right: 3px; }
.visual { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.canvas-bar { height: 42px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--border); color: var(--text-subtle); flex-shrink: 0; }
.canvas-bar > span { font: 9px var(--font-mono); letter-spacing: .12em; } .canvas-bar button { background: none; border: none; font: 10px var(--font-mono); padding: 5px 7px; color: var(--text-muted); }
.stage { flex: 1; min-height: 180px; overflow: auto; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0) 0 0 / 20px 20px; }
.canvas-wrap { position: relative; flex: none; box-shadow: 0 6px 35px #0003; background-color: var(--bg-panel); background-image: conic-gradient(var(--bg-active) 25%, transparent 0 50%, var(--bg-active) 0 75%, transparent 0); background-size: 16px 16px; }
.source-canvas, .mask-canvas { display: block; width: 100%; height: 100%; } .mask-canvas { position: absolute; inset: 0; touch-action: none; } .mask-canvas.editable { cursor: crosshair; }
.brush-cursor { position: absolute; border: 1px solid white; box-shadow: 0 0 0 1px #0008; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; }
.compare-label { position: absolute; top: 10px; left: 10px; font: 10px var(--font-mono); background: #111d; color: white; padding: 5px 8px; pointer-events: none; }
.empty { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 35px 10px; max-width: 360px; } .empty h3 { margin: 0; font-size: clamp(24px, 2.6vw, 36px); line-height: 1.1; letter-spacing: -.06em; } .empty p { font-size: 13px; } .empty p.small { font-size: 10px; }
.empty-mark { position: relative; display: grid; place-items: center; width: 100px; height: 100px; color: var(--accent-text); margin-bottom: 12px; }
.mark-corner { position: absolute; width: 14px; height: 14px; border-color: var(--text-subtle); opacity: .7; } .tl { top: 0; left: 0; border-left: 1px solid; border-top: 1px solid; } .tr { top: 0; right: 0; border-right: 1px solid; border-top: 1px solid; } .bl { bottom: 0; left: 0; border-left: 1px solid; border-bottom: 1px solid; } .br { bottom: 0; right: 0; border-right: 1px solid; border-bottom: 1px solid; }
.job-status { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 9px 15px; border-top: 1px solid var(--border); font-size: 10px; color: var(--text-muted); line-height: 1.5; } .save-status { margin-left: auto; white-space: nowrap; color: var(--text-subtle); } .working-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
.variants { height: 116px; flex-shrink: 0; padding: 14px; display: flex; align-items: stretch; gap: 12px; overflow: auto; border-top: 1px solid var(--border); background: var(--bg-panel); }
.variants-title { display: flex; flex-direction: column; justify-content: space-between; padding: 4px 8px 4px 0; font: 9px var(--font-mono); color: var(--text-subtle); }
.source-tile { min-width: 90px; display: grid; place-content: center; gap: 8px; justify-items: center; color: var(--text-muted); background: none; border: 1px solid var(--border); border-radius: var(--radius); font-size: 9px; }
.source-tile[aria-pressed=true], .variant-tile.selected { border-color: var(--accent); } .variant-tile { position: relative; border: 1px solid var(--border); border-radius: var(--radius); min-width: 108px; overflow: hidden; }
.variant-select { width: 108px; height: 100%; display: flex; flex-direction: column; gap: 3px; padding: 4px; border: 0; background: none; color: var(--text-muted); font-size: 9px; text-align: left; } .variant-select img { width: 100%; flex: 1; min-height: 0; object-fit: contain; } .remove-variant { position: absolute; right: 3px; top: 3px; background: #111b; color: white; border: 0; border-radius: 3px; width: 16px; height: 16px; }
.variants-empty { align-self: center; margin-left: 6px; }
.connection { display: flex; align-items: center; gap: 10px; background: transparent; border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 12px; color: var(--text); text-align: left; font-size: 11px; }
.connection > span:nth-child(2) { flex: 1; } .connection small { display: block; color: var(--text-subtle); font: 9px var(--font-mono); margin-top: 5px; } .connection-dot { width: 6px; height: 6px; background: var(--text-subtle); border-radius: 50%; } .connection-dot.connected { background: var(--success); }
.setup { display: flex; flex-direction: column; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.prompt-heading { margin-top: 5px; } fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 18px; }
.field { display: block; font-size: 11px; color: var(--text-muted); } .optional { color: var(--text-subtle); font-size: 10px; float: right; }
textarea, input[type=number], select { display: block; width: 100%; margin-top: 8px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg); color: var(--text); padding: 10px; font: 12px/1.6 var(--font-sans); } textarea { resize: vertical; min-height: 62px; } textarea::placeholder { color: var(--text-subtle); }
.outpaint-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.outpaint-grid label { font-size: 10px; color: var(--text-muted); }
.outpaint-grid input { margin-top: 4px; padding: 7px; }
.model-label { display: grid; gap: 7px; border-block: 1px solid var(--border); padding: 13px 0; } .model-label > span { font: 9px var(--font-mono); color: var(--text-subtle); letter-spacing: .1em; } .model-label strong { font-size: 12px; font-weight: 500; } .model-label small { font-size: 10px; color: var(--text-subtle); }
.advanced { font-size: 11px; color: var(--text-muted); } summary { cursor: pointer; margin-bottom: 15px; } .advanced .slider { margin-top: 18px; } .seed-mode { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; cursor: pointer; } .seed-mode input { accent-color: var(--accent); } .random-seed { margin-top: 6px; padding: 0; background: none; border: 0; color: var(--accent-text); font-size: 10px; } .advanced p { margin-top: 14px; }
.run-actions { display: flex; flex-direction: column; gap: 10px; margin-top: auto; padding-top: 10px; } .error { color: var(--danger); font-size: 11px; overflow-wrap: anywhere; }
button:focus-visible, textarea:focus-visible, input:focus-visible, canvas:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; } button:disabled { opacity: .4; cursor: default; }
@media (max-width: 1200px) { .ai-studio { grid-template-columns: 168px minmax(0, 1fr) 260px; } .tools, .parameters { padding: 16px 12px; } .empty .eyebrow { max-width: 180px; line-height: 1.7; } .save-status { display: none; } }
@media (max-width: 850px) { .ai-studio { grid-template-columns: 146px minmax(240px, 1fr); overflow: auto; } .parameters { grid-column: 1 / -1; border-top: 1px solid var(--border); overflow: visible; } .tools, .visual { min-height: 570px; } .footnote { display: none; } }
</style>
