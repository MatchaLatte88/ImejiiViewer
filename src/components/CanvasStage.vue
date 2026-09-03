<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import AppButton from './ui/AppButton.vue'
import AppIcon from './ui/AppIcon.vue'

const store = useEditorStore()

const stageEl = ref(null)
const canvasEl = ref(null)
const stageSize = ref({ width: 0, height: 0 })
const offset = ref({ x: 0, y: 0 })
const isPanning = ref(false)

let panStart = null
let resizeObserver = null

/** Im Pipettenmodus wird das unbearbeitete Original gezeigt - so passen die Koordinaten. */
const displayCanvas = computed(() => {
  if (store.eyedropperMode || store.showOriginal) return store.originalCanvas
  return store.previewCanvas
})

const displaySize = computed(() => {
  const canvas = displayCanvas.value
  return canvas ? { width: canvas.width, height: canvas.height } : { width: 0, height: 0 }
})

const fitScale = computed(() => {
  const { width, height } = displaySize.value
  if (!width || !height || !stageSize.value.width) return 1
  const padding = 64
  return Math.min(
    (stageSize.value.width - padding) / width,
    (stageSize.value.height - padding) / height,
    4,
  )
})

const scale = computed(() => (store.fitToView ? fitScale.value : store.zoom))

const frameStyle = computed(() => ({
  width: displaySize.value.width * scale.value + 'px',
  height: displaySize.value.height * scale.value + 'px',
  transform: `translate(${offset.value.x}px, ${offset.value.y}px)`,
}))

const isPixelated = computed(() => scale.value >= 3)

function draw() {
  const canvas = canvasEl.value
  const source = displayCanvas.value
  if (!canvas || !source) return
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0)
}

watch([() => store.renderVersion, displayCanvas], () => nextTick(draw), { immediate: true })

watch(
  () => store.source,
  () => {
    offset.value = { x: 0, y: 0 }
    store.fitToView = true
  },
)

function measure() {
  if (!stageEl.value) return
  stageSize.value = {
    width: stageEl.value.clientWidth,
    height: stageEl.value.clientHeight,
  }
}

onMounted(() => {
  measure()
  resizeObserver = new ResizeObserver(measure)
  if (stageEl.value) resizeObserver.observe(stageEl.value)
  draw()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

// --- Zoom & Pan ---------------------------------------------------------
function setZoom(next) {
  store.zoom = Math.min(16, Math.max(0.05, next))
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
  if (!store.hasImage) return
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12)
}

function onPointerDown(event) {
  if (store.eyedropperMode && event.button === 0) return
  if (event.button !== 0 && event.button !== 1) return
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

// --- Pipette ------------------------------------------------------------
const hoverColor = ref(null)

function toImageCoords(event) {
  const canvas = canvasEl.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null
  return { x, y }
}

function onCanvasMove(event) {
  if (!store.eyedropperMode || !store.source) {
    hoverColor.value = null
    return
  }
  const point = toImageCoords(event)
  if (!point) return
  const { data, width, height } = store.source.imageData
  const x = Math.max(0, Math.min(width - 1, Math.floor(point.x)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(point.y)))
  const index = (y * width + x) * 4
  hoverColor.value = {
    hex:
      '#' +
      [data[index], data[index + 1], data[index + 2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join(''),
    x,
    y,
  }
}

function onCanvasClick(event) {
  if (!store.eyedropperMode) return
  const point = toImageCoords(event)
  if (!point) return
  store.pickColorAtSource(point.x, point.y, {
    replace: store.eyedropperMode === 'replace',
    addSeed: true,
  })
  // Mit gedrueckter Umschalttaste bleibt die Pipette fuer weitere Farben aktiv.
  if (!event.shiftKey) store.eyedropperMode = null
}

defineExpose({ resetView })
</script>

<template>
  <section class="stage-wrap">
    <div
      ref="stageEl"
      class="stage"
      :class="{ 'is-panning': isPanning, 'is-picking': store.eyedropperMode }"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div v-if="store.hasImage" class="frame checkerboard" :style="frameStyle">
        <canvas
          ref="canvasEl"
          class="frame__canvas"
          :class="{ 'is-pixelated': isPixelated }"
          @mousemove="onCanvasMove"
          @mouseleave="hoverColor = null"
          @click="onCanvasClick"
        />
      </div>

      <div v-if="store.eyedropperMode" class="picker-hint">
        <AppIcon name="eyedropper" :size="14" />
        <span>
          Click the color that should become transparent.
          Hold <b>Shift</b> for several colors, <b>Esc</b> to exit.
        </span>
        <span v-if="hoverColor" class="picker-hint__swatch">
          <i :style="{ background: hoverColor.hex }" />
          <span class="mono">{{ hoverColor.hex }}</span>
        </span>
      </div>

      <div v-if="store.showOriginal && !store.eyedropperMode" class="compare-badge">Original</div>
    </div>

    <footer class="stage-bar">
      <div class="stage-bar__group">
        <AppButton icon="zoomOut" variant="ghost" size="sm" title="Zoom out" @click="zoomBy(1 / 1.25)" />
        <button type="button" class="stage-bar__zoom mono" title="Set to 100%" @click="setZoom(1)">
          {{ Math.round(scale * 100) }} %
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

      <div class="stage-bar__info">
        <template v-if="store.outputSize">
          <span class="mono">{{ store.outputSize.width }} x {{ store.outputSize.height }} px</span>
          <span class="stage-bar__dot" />
        </template>
        <span v-if="store.isRendering" class="stage-bar__busy">processing ...</span>
        <span v-else-if="store.hasImage">ready</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.stage-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background: var(--canvas-bg);
}

.stage {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: grab;
  /* Feines Raster als Studio-Untergrund */
  background-image:
    radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0);
  background-size: 24px 24px;
}

.stage.is-panning {
  cursor: grabbing;
}

.stage.is-picking {
  cursor: crosshair;
}

.frame {
  position: relative;
  border-radius: 2px;
  box-shadow: var(--shadow-lg);
  transition: width 60ms linear, height 60ms linear;
}

.frame__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.frame__canvas.is-pixelated {
  image-rendering: pixelated;
}

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

.compare-badge {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  box-shadow: var(--shadow);
}

.stage-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 36px;
  padding: 0 var(--space-3);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  flex: none;
}

.stage-bar__group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.stage-bar__zoom {
  min-width: 52px;
  height: 26px;
  padding: 0 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}

.stage-bar__zoom:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.stage-bar__info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  color: var(--text-subtle);
}

.stage-bar__dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--border-strong);
}

.stage-bar__busy {
  color: var(--accent-text);
}
</style>
