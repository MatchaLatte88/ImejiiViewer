<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLibraryStore } from '../stores/library.js'
import AppButton from './ui/AppButton.vue'
import AppIcon from './ui/AppIcon.vue'

// Im Betrachter faellt alles weg, was das Bild veraendert - er zeigt nur an.
const props = defineProps({
  editing: { type: Boolean, default: false },
})

const store = useLibraryStore()

const rootEl = ref(null)
const stageEl = ref(null)
const canvasEl = ref(null)
const stageSize = ref({ width: 0, height: 0 })
const chromeVisible = ref(true)
const offset = ref({ x: 0, y: 0 })
const isPanning = ref(false)

let panStart = null
let resizeObserver = null
let slideshowTimer = null
let idleTimer = null

// --- Vergleichs-Slider ---------------------------------------------------
// Nur sinnvoll, wenn Original und Ergebnis dieselben Pixelmasse haben - sonst
// muesste eine Seite verzerrt werden, um in denselben Rahmen zu passen.
const sliderCompare = ref(false)
const sliderPos = ref(50)
const canvasOrigEl = ref(null)

const canCompareSlider = computed(() => {
  const source = store.sourceCanvas
  const preview = store.previewCanvas
  return Boolean(
    source && preview && source.width === preview.width && source.height === preview.height,
  )
})

const showSlider = computed(
  () => sliderCompare.value && canCompareSlider.value && !store.cropMode,
)

// Beim Aufnehmen einer Farbe zaehlt, was auf dem Schirm steht - also das Ergebnis.
const displayCanvas = computed(() =>
  store.showOriginal && !sliderCompare.value && !store.eyedropperMode
    ? store.sourceCanvas
    : store.previewCanvas,
)

const displaySize = computed(() => {
  const canvas = displayCanvas.value
  return canvas ? { width: canvas.width, height: canvas.height } : { width: 0, height: 0 }
})

const fitScale = computed(() => {
  const { width, height } = displaySize.value
  if (!width || !height || !stageSize.value.width) return 1
  const padding = store.isFullscreen ? 0 : 56
  return Math.min(
    (stageSize.value.width - padding) / width,
    (stageSize.value.height - padding) / height,
    8,
  )
})

const scale = computed(() => (store.fitToView ? fitScale.value : store.zoom))

const frameSize = computed(() => ({
  width: displaySize.value.width * scale.value + 'px',
  height: displaySize.value.height * scale.value + 'px',
}))

const frameStyle = computed(() => ({
  ...frameSize.value,
  transform: `translate(${offset.value.x}px, ${offset.value.y}px)`,
}))

function draw() {
  const canvas = canvasEl.value
  const source = displayCanvas.value
  if (!canvas || !source) return
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0)
  if (props.editing && store.clippingWarning && !store.showOriginal && !store.eyedropperMode) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue
      if (Math.max(data[i], data[i + 1], data[i + 2]) >= 254) { data[i] = 255; data[i + 1] = 32; data[i + 2] = 48 }
      else if (Math.max(data[i], data[i + 1], data[i + 2]) <= 1) { data[i] = 40; data[i + 1] = 100; data[i + 2] = 255 }
    }
    ctx.putImageData(pixels, 0, 0)
  }
}

watch(
  [() => store.renderVersion, displayCanvas, () => store.clippingWarning, () => store.eyedropperMode],
  () => {
    // Noch vor dem DOM-Patch zeichnen: sonst wird das alte Bild fuer einen
    // Frame auf die neue Rahmengroesse gestreckt - das Zucken beim Wechsel.
    if (canvasEl.value) draw()
    else nextTick(draw)
  },
  { immediate: true },
)
watch(
  () => store.activeId,
  () => {
    endCropDrag()
    endSliderDrag()
    offset.value = { x: 0, y: 0 }
    sliderPos.value = 50
  },
)

function drawOriginal() {
  const canvas = canvasOrigEl.value
  const source = store.sourceCanvas
  if (!canvas || !source) return
  canvas.width = source.width
  canvas.height = source.height
  canvas.getContext('2d').drawImage(source, 0, 0)
}

watch(
  [showSlider, () => store.sourceCanvas],
  ([visible]) => {
    if (visible) nextTick(drawOriginal)
  },
  { immediate: true },
)

watch(canCompareSlider, (canCompare) => {
  if (!canCompare) sliderCompare.value = false
})

function measure() {
  if (!stageEl.value) return
  stageSize.value = { width: stageEl.value.clientWidth, height: stageEl.value.clientHeight }
}

onMounted(() => {
  measure()
  resizeObserver = new ResizeObserver(measure)
  if (stageEl.value) resizeObserver.observe(stageEl.value)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  draw()
})

onBeforeUnmount(() => {
  endCropDrag()
  endSliderDrag()
  store.showOriginal = false
  resizeObserver?.disconnect()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (idleTimer) clearTimeout(idleTimer)
  stopSlideshow()
})

// --- Zoom, Pan, Vollbild -----------------------------------------------
function setZoom(next) {
  store.zoom = Math.min(24, Math.max(0.05, next))
  store.fitToView = false
}

function zoomBy(factor) {
  setZoom((store.fitToView ? fitScale.value : store.zoom) * factor)
}

function resetView() {
  store.fitToView = true
  offset.value = { x: 0, y: 0 }
}

function onWheel(event) {
  if (!store.activeItem) return
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12)
}

function onPointerDown(event) {
  if (store.eyedropperMode && event.button === 0) return
  if (store.cropMode || event.button > 1) return
  isPanning.value = true
  panStart = { x: event.clientX - offset.value.x, y: event.clientY - offset.value.y }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function onPointerMove(event) {
  if (!isPanning.value || !panStart) return
  offset.value = { x: event.clientX - panStart.x, y: event.clientY - panStart.y }
}

function onPointerUp(event) {
  isPanning.value = false
  panStart = null
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await rootEl.value?.requestFullscreen?.()
  } else {
    await document.exitFullscreen()
  }
}

function onFullscreenChange() {
  store.isFullscreen = Boolean(document.fullscreenElement)
  if (store.isFullscreen) hideChromeLater()
  else revealChrome()
  nextTick(measure)
}

// Im Vollbild soll nur das Bild stehen: Statusleiste und Pfeile kommen bei
// Mausbewegung und ziehen sich nach kurzer Ruhe wieder zurueck.
const IDLE_DELAY = 2200

function revealChrome() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  chromeVisible.value = true
}

function hideChromeLater() {
  revealChrome()
  if (!store.isFullscreen) return
  idleTimer = setTimeout(() => {
    chromeVisible.value = false
  }, IDLE_DELAY)
}

function onPointerActivity() {
  if (store.isFullscreen) hideChromeLater()
}

function onStageDoubleClick() {
  if (store.cropMode) return
  toggleFullscreen()
}

// --- Diashow ------------------------------------------------------------
function startSlideshow() {
  stopSlideshow()
  store.slideshow.active = true
  slideshowTimer = setInterval(() => store.step(1), Math.max(1, store.slideshow.interval) * 1000)
}

function stopSlideshow() {
  store.slideshow.active = false
  if (slideshowTimer) clearInterval(slideshowTimer)
  slideshowTimer = null
}

function toggleSlideshow() {
  if (store.slideshow.active) stopSlideshow()
  else startSlideshow()
}

watch(
  () => store.slideshow.interval,
  () => {
    if (store.slideshow.active) startSlideshow()
  },
)

// --- Zuschneiden --------------------------------------------------------
const cropRect = computed(() => store.cropDraft)

const cropPixels = computed(() => {
  if (!cropRect.value || !displaySize.value.width) return null
  const item = store.activeItem
  const geometry = store.outputSize
  if (!item || !geometry) return null
  // Der Entwurf ist relativ - fuer die Anzeige auf die echte Ausgabe hochrechnen.
  return {
    width: Math.max(1, Math.round(geometry.width * cropRect.value.width)),
    height: Math.max(1, Math.round(geometry.height * cropRect.value.height)),
  }
})

const cropStyle = computed(() => {
  if (!cropRect.value) return {}
  return {
    left: cropRect.value.x * 100 + '%',
    top: cropRect.value.y * 100 + '%',
    width: cropRect.value.width * 100 + '%',
    height: cropRect.value.height * 100 + '%',
  }
})

let dragMode = null
let dragStart = null

function beginCropDrag(event, mode) {
  if (!store.cropMode) return
  event.stopPropagation()
  event.preventDefault()
  dragMode = mode
  const frame = canvasEl.value.getBoundingClientRect()
  dragStart = {
    frame,
    pointerX: (event.clientX - frame.left) / frame.width,
    pointerY: (event.clientY - frame.top) / frame.height,
    rect: { ...(store.cropDraft || { x: 0, y: 0, width: 1, height: 1 }) },
  }
  if (mode === 'new') {
    store.cropDraft = {
      x: dragStart.pointerX,
      y: dragStart.pointerY,
      width: 0,
      height: 0,
    }
    dragStart.rect = { ...store.cropDraft }
  }
  window.addEventListener('pointermove', onCropDrag)
  window.addEventListener('pointerup', endCropDrag)
}

function onCropDrag(event) {
  if (!dragMode || !dragStart) return
  const { frame } = dragStart
  const px = Math.min(1, Math.max(0, (event.clientX - frame.left) / frame.width))
  const py = Math.min(1, Math.max(0, (event.clientY - frame.top) / frame.height))
  const dx = px - dragStart.pointerX
  const dy = py - dragStart.pointerY
  const start = dragStart.rect
  const aspect = store.cropAspect

  let rect
  if (dragMode === 'move') {
    rect = {
      x: Math.min(1 - start.width, Math.max(0, start.x + dx)),
      y: Math.min(1 - start.height, Math.max(0, start.y + dy)),
      width: start.width,
      height: start.height,
    }
  } else if (dragMode === 'new') {
    rect = {
      x: Math.min(dragStart.pointerX, px),
      y: Math.min(dragStart.pointerY, py),
      width: Math.abs(px - dragStart.pointerX),
      height: Math.abs(py - dragStart.pointerY),
    }
    if (aspect) rect = enforceAspect(rect, aspect, px < dragStart.pointerX, py < dragStart.pointerY)
  } else {
    let { x, y, width, height } = start
    if (dragMode.includes('w')) {
      const nx = Math.min(start.x + start.width - 0.02, Math.max(0, start.x + dx))
      width = start.x + start.width - nx
      x = nx
    }
    if (dragMode.includes('e')) {
      width = Math.min(1 - start.x, Math.max(0.02, start.width + dx))
    }
    if (dragMode.includes('n')) {
      const ny = Math.min(start.y + start.height - 0.02, Math.max(0, start.y + dy))
      height = start.y + start.height - ny
      y = ny
    }
    if (dragMode.includes('s')) {
      height = Math.min(1 - start.y, Math.max(0.02, start.height + dy))
    }
    rect = { x, y, width, height }
    if (aspect) rect = enforceAspect(rect, aspect, dragMode.includes('w'), dragMode.includes('n'))
  }

  store.cropDraft = rect
}

/** Haelt das Verhaeltnis ein, ohne aus dem Bild zu laufen. */
function enforceAspect(rect, aspect, anchorRight, anchorBottom) {
  const displayAspect = displaySize.value.width / displaySize.value.height
  // aspect ist ein Bildverhaeltnis - relative Koordinaten muessen es umrechnen.
  const relativeAspect = aspect / displayAspect

  let width = rect.width
  let height = width / relativeAspect
  if (height > 1) {
    height = 1
    width = height * relativeAspect
  }

  let x = anchorRight ? rect.x + rect.width - width : rect.x
  let y = anchorBottom ? rect.y + rect.height - height : rect.y
  x = Math.min(1 - width, Math.max(0, x))
  y = Math.min(1 - height, Math.max(0, y))
  return { x, y, width, height }
}

function endCropDrag() {
  dragMode = null
  dragStart = null
  window.removeEventListener('pointermove', onCropDrag)
  window.removeEventListener('pointerup', endCropDrag)
  const rect = store.cropDraft
  if (rect && (rect.width < 0.02 || rect.height < 0.02)) store.cropDraft = null
}

watch(
  () => store.cropMode,
  (active) => {
    if (active && !store.cropDraft) {
      store.cropDraft = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      if (store.cropAspect) {
        store.cropDraft = enforceAspect(store.cropDraft, store.cropAspect, false, false)
      }
    }
  },
)

watch(
  () => store.cropAspect,
  (aspect) => {
    if (aspect && store.cropDraft) {
      store.cropDraft = enforceAspect(store.cropDraft, aspect, false, false)
    }
  },
)

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// --- Vergleichs-Slider: Ziehen -------------------------------------------
let sliderDragging = false

function updateSliderFromEvent(event) {
  const frame = canvasEl.value?.getBoundingClientRect()
  if (!frame || !frame.width) return
  const pct = ((event.clientX - frame.left) / frame.width) * 100
  sliderPos.value = Math.min(100, Math.max(0, pct))
}

function beginSliderDrag(event) {
  if (!showSlider.value) return
  event.stopPropagation()
  event.preventDefault()
  sliderDragging = true
  updateSliderFromEvent(event)
  window.addEventListener('pointermove', onSliderDrag)
  window.addEventListener('pointerup', endSliderDrag)
}

function onSliderDrag(event) {
  if (!sliderDragging) return
  updateSliderFromEvent(event)
}

function endSliderDrag() {
  sliderDragging = false
  window.removeEventListener('pointermove', onSliderDrag)
  window.removeEventListener('pointerup', endSliderDrag)
}

// --- Pipette ------------------------------------------------------------
const hoverColor = ref(null)

watch(
  () => store.eyedropperMode,
  () => {
    hoverColor.value = null
  },
)

function toImageCoords(event) {
  const canvas = canvasEl.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null
  return { x, y }
}

function onPickMove(event) {
  if (!store.eyedropperMode) {
    hoverColor.value = null
    return
  }
  const point = toImageCoords(event)
  hoverColor.value = point ? store.samplePreviewColor(point.x, point.y) : null
}

function onPickClick(event) {
  if (!store.eyedropperMode) return
  const point = toImageCoords(event)
  if (!point) return
  store.pickColorShift(point.x, point.y)
  // Mit gedrueckter Umschalttaste bleibt die Pipette fuer weitere Farben aktiv.
  if (!event.shiftKey) store.eyedropperMode = false
}

defineExpose({ resetView, zoomBy, setZoom, toggleFullscreen, toggleSlideshow })
</script>

<template>
  <section
    ref="rootEl"
    class="viewer"
    :class="{
      'is-fullscreen': store.isFullscreen,
      'is-idle': store.isFullscreen && !chromeVisible,
    }"
    @pointermove="onPointerActivity"
  >
    <div
      ref="stageEl"
      class="stage"
      :class="{
        'is-panning': isPanning,
        'is-cropping': store.cropMode,
        'is-picking': store.eyedropperMode,
      }"
      @wheel="onWheel"
      @dblclick="onStageDoubleClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div v-if="store.activeItem" class="frame checkerboard" :style="frameStyle">
        <canvas
          ref="canvasEl"
          class="frame__canvas"
          @mousemove="onPickMove"
          @mouseleave="hoverColor = null"
          @click="onPickClick"
        />

        <div v-if="showSlider" class="compare" @pointerdown="beginSliderDrag">
          <div class="compare__reveal" :style="{ width: sliderPos + '%' }">
            <canvas ref="canvasOrigEl" class="compare__original" :style="frameSize" />
            <span class="compare__label compare__label--before">Before</span>
          </div>
          <span class="compare__label compare__label--after">After</span>
          <div class="compare__handle" :style="{ left: sliderPos + '%' }">
            <span class="compare__grip"><AppIcon name="compare" :size="14" /></span>
          </div>
        </div>

        <div
          v-if="store.cropMode"
          class="crop"
          @pointerdown="beginCropDrag($event, 'new')"
        >
          <template v-if="cropRect">
            <div class="crop__shade" :style="{ height: cropRect.y * 100 + '%', top: 0 }" />
            <div
              class="crop__shade"
              :style="{ top: (cropRect.y + cropRect.height) * 100 + '%', bottom: 0 }"
            />
            <div
              class="crop__shade"
              :style="{
                top: cropRect.y * 100 + '%',
                height: cropRect.height * 100 + '%',
                left: 0,
                width: cropRect.x * 100 + '%',
              }"
            />
            <div
              class="crop__shade"
              :style="{
                top: cropRect.y * 100 + '%',
                height: cropRect.height * 100 + '%',
                left: (cropRect.x + cropRect.width) * 100 + '%',
                right: 0,
              }"
            />

            <div class="crop__box" :style="cropStyle" @pointerdown="beginCropDrag($event, 'move')">
              <span class="crop__grid" />
              <span
                v-for="handle in HANDLES"
                :key="handle"
                class="crop__handle"
                :class="'crop__handle--' + handle"
                @pointerdown="beginCropDrag($event, handle)"
              />
              <span v-if="cropPixels" class="crop__size mono">
                {{ cropPixels.width }} x {{ cropPixels.height }}
              </span>
            </div>
          </template>
        </div>
      </div>

      <div v-if="store.eyedropperMode" class="picker-hint">
        <AppIcon name="eyedropper" :size="14" />
        <span>
          Click the color you want to change.
          Hold <b>Shift</b> for several colors, <b>Esc</b> to exit.
        </span>
        <span v-if="hoverColor" class="picker-hint__swatch">
          <i :style="{ background: hoverColor.hex }" />
          <span class="mono">{{ hoverColor.hex }}</span>
        </span>
      </div>

      <div v-if="store.isDecoding" class="viewer__busy">Loading image ...</div>
      <div v-if="store.showOriginal && !store.eyedropperMode" class="viewer__badge">Original</div>

      <div v-if="store.canStep" class="viewer__nav">
        <button type="button" class="viewer__arrow" title="Previous image" @click="store.step(-1)">
          <AppIcon name="chevron" :size="20" class="flip" />
        </button>
        <button type="button" class="viewer__arrow" title="Next image" @click="store.step(1)">
          <AppIcon name="chevron" :size="20" />
        </button>
      </div>
    </div>

    <footer class="bar" @pointerenter="revealChrome" @pointerleave="hideChromeLater">
      <div class="bar__group">
        <AppButton icon="zoomOut" variant="ghost" size="sm" title="Zoom out" @click="zoomBy(1 / 1.25)" />
        <button type="button" class="bar__zoom mono" title="Load original-resolution detail and show actual pixels" :disabled="store.isDecoding" @click="store.showActualPixels()">
          {{ store.sourceLimit && Math.max(store.activeItem?.width || 0, store.activeItem?.height || 0) > store.sourceLimit ? 'Preview ' : '' }}{{ Math.round(scale * 100) }} %
        </button>
        <AppButton icon="zoomIn" variant="ghost" size="sm" title="Zoom in" @click="zoomBy(1.25)" />
        <AppButton
          icon="fit"
          variant="ghost"
          size="sm"
          title="Fit to view"
          :active="store.fitToView"
          @click="resetView"
        />
      </div>

      <div class="bar__group">
        <template v-if="props.editing">
          <AppButton
            icon="crop"
            size="sm"
            title="Crop (C)"
            :active="store.cropMode"
            :disabled="!store.activeItem"
            @click="store.cropMode = !store.cropMode"
          />
          <template v-if="store.cropMode">
            <AppButton size="sm" variant="primary" :disabled="!store.cropDraft" @click="store.applyCrop()">
              Apply
            </AppButton>
            <AppButton size="sm" @click="store.cancelCrop()">Cancel</AppButton>
          </template>
          <AppButton
            icon="eye"
            variant="ghost"
            size="sm"
            title="Compare with original (hold Space)"
            :active="store.showOriginal"
            :disabled="!store.activeItem"
            @mousedown="store.showOriginal = true"
            @mouseup="store.showOriginal = false"
            @mouseleave="store.showOriginal = false"
          />
          <AppButton
            icon="compare"
            variant="ghost"
            size="sm"
            title="Compare slider"
            :active="sliderCompare"
            :disabled="!canCompareSlider"
            @click="sliderCompare = !sliderCompare"
          />
        </template>
        <AppButton
          icon="sparkles"
          variant="ghost"
          size="sm"
          :active="store.slideshow.active"
          :disabled="!store.canStep"
          title="Slideshow (S)"
          @click="toggleSlideshow"
        />
        <select
          v-if="store.slideshow.active"
          v-model.number="store.slideshow.interval"
          class="bar__select"
          aria-label="Slideshow interval"
        >
          <option v-for="seconds in [2, 3, 5, 10]" :key="seconds" :value="seconds">
            {{ seconds }} s
          </option>
        </select>
        <AppButton
          icon="fit"
          variant="ghost"
          size="sm"
          title="Fullscreen (F)"
          :active="store.isFullscreen"
          @click="toggleFullscreen"
        />
      </div>

      <div class="bar__info">
        <template v-if="store.activeItem">
          <span class="mono">{{ store.position.index }} / {{ store.position.total }}</span>
          <span class="bar__dot" />
          <span class="mono" v-if="store.outputSize">
            {{ store.outputSize.width }} x {{ store.outputSize.height }} px
          </span>
        </template>
        <span v-if="store.isRendering" class="bar__busy">processing ...</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.viewer {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--canvas-bg);
}

.viewer.is-fullscreen {
  background: #0a0c10;
}

.stage {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: grab;
  background-image: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0);
  background-size: 24px 24px;
}

.stage.is-panning {
  cursor: grabbing;
}

.stage.is-cropping,
.stage.is-picking {
  cursor: crosshair;
}

/* --- Pipette --- */
.picker-hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: min(560px, calc(100% - 32px));
  padding: 8px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  box-shadow: var(--shadow);
  font-size: 12px;
  color: var(--text-muted);
}

.picker-hint b {
  color: var(--text);
  font-weight: 600;
}

.picker-hint__swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}

.picker-hint__swatch i {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
}

.frame {
  position: relative;
  box-shadow: var(--shadow-lg);
}

.frame__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* --- Vergleichs-Slider --- */
.compare {
  position: absolute;
  inset: 0;
  cursor: ew-resize;
  user-select: none;
}

.compare__reveal {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.compare__original {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
}

.compare__handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
  transform: translateX(-1px);
  pointer-events: none;
}

.compare__grip {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: #fff;
  color: #111;
  box-shadow: var(--shadow);
}

.compare__label {
  position: absolute;
  top: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  pointer-events: none;
}

.compare__label--before {
  left: 12px;
}

.compare__label--after {
  right: 12px;
}

/* --- Zuschneiden --- */
.crop {
  position: absolute;
  inset: 0;
}

.crop__shade {
  position: absolute;
  left: 0;
  right: 0;
  background: rgb(0 0 0 / 0.55);
  pointer-events: none;
}

.crop__box {
  position: absolute;
  outline: 1px solid rgb(255 255 255 / 0.9);
  cursor: move;
}

.crop__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgb(255 255 255 / 0.28) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(255 255 255 / 0.28) 1px, transparent 1px);
  background-size: 33.333% 33.333%;
}

.crop__handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--accent);
  border: 1px solid rgb(0 0 0 / 0.4);
  border-radius: 2px;
}

.crop__handle--nw { top: -6px; left: -6px; cursor: nwse-resize; }
.crop__handle--n  { top: -6px; left: calc(50% - 6px); cursor: ns-resize; }
.crop__handle--ne { top: -6px; right: -6px; cursor: nesw-resize; }
.crop__handle--e  { top: calc(50% - 6px); right: -6px; cursor: ew-resize; }
.crop__handle--se { bottom: -6px; right: -6px; cursor: nwse-resize; }
.crop__handle--s  { bottom: -6px; left: calc(50% - 6px); cursor: ns-resize; }
.crop__handle--sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.crop__handle--w  { top: calc(50% - 6px); left: -6px; cursor: ew-resize; }

.crop__size {
  position: absolute;
  left: 50%;
  bottom: -26px;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
}

/* --- Overlays --- */
.viewer__busy,
.viewer__badge {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: var(--accent);
  color: var(--accent-contrast);
  box-shadow: var(--shadow);
}

.viewer__busy {
  /* Kurze Ladezeiten sollen nicht aufblitzen - der Hinweis kommt verzoegert. */
  animation: busy-in 120ms ease-out 220ms both;
  background: var(--bg-elevated);
  color: var(--text-muted);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}

@keyframes busy-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.viewer__nav {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  pointer-events: none;
}

.viewer__arrow {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text-muted);
  opacity: 0;
  pointer-events: auto;
  box-shadow: var(--shadow);
  transition: opacity var(--transition), color var(--transition);
}

.stage:hover .viewer__arrow {
  opacity: 0.9;
}

.viewer__arrow:hover {
  color: var(--text);
  opacity: 1;
}

.flip {
  transform: rotate(180deg);
}

/* --- Statusleiste --- */
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 40px;
  padding: 0 var(--space-3);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  flex: none;
}

.bar__group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bar__zoom {
  min-width: 52px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}

.bar__zoom:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.bar__select {
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-size: 11px;
  color: var(--text-muted);
}

.bar__info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  color: var(--text-subtle);
}

.bar__dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--border-strong);
}

.bar__busy {
  color: var(--accent-text);
}

/* --- Vollbild --- */
/* Im Vollbild bleibt nur das Bild: kein Raster, kein Rahmenschatten. */
.viewer.is-fullscreen .stage {
  background-image: none;
}

.viewer.is-fullscreen .frame {
  box-shadow: none;
}

/* Die Leiste schwebt ueber dem Bild - so bleibt die Buehne beim Ein- und
   Ausblenden gleich gross und das Bild springt nicht. */
.viewer.is-fullscreen .bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  border-top: 0;
  box-shadow: var(--shadow-lg);
  transition: opacity 180ms ease, transform 180ms ease;
}

.viewer.is-idle .bar {
  opacity: 0;
  transform: translateY(100%);
  pointer-events: none;
}

.viewer.is-idle .viewer__arrow {
  opacity: 0;
}

.viewer.is-idle .stage {
  cursor: none;
}
</style>
