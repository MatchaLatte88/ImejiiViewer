<script setup>
import { isDesktop } from '../../lib/desktop.js'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../stores/library.js'
import { useUiStore } from '../../stores/ui.js'
import { EXPORT_FORMATS, formatBytes } from '../../lib/exportImage.js'
import { resizeCanvas } from '../../lib/transform.js'
import { applyWatermark, WATERMARK_POSITIONS } from '../../lib/watermark.js'
import { useEstimatedSize } from '../../composables/useEstimatedSize.js'
import SliderControl from '../ui/SliderControl.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'
import AppButton from '../ui/AppButton.vue'

const store = useLibraryStore()
const ui = useUiStore()

const singleFormat = ref('png')
const singleQuality = ref(92)
const busy = ref('')

const { bytes: singleEstBytes } = useEstimatedSize(
  () => store.previewCanvas,
  () => singleFormat.value,
  () => singleQuality.value,
  [() => store.renderVersion],
)

const { bytes: batchEstBytes } = useEstimatedSize(
  () => store.previewCanvas,
  () => store.batch.format,
  () => store.batch.quality,
  [() => store.renderVersion],
)

// --- Wasserzeichen-Vorschau ----------------------------------------------
const watermarkPreviewEl = ref(null)
const PREVIEW_BOX = { width: 264, height: 160 }

function drawWatermarkPreview() {
  const target = watermarkPreviewEl.value
  const source = store.previewCanvas
  if (!target) return
  target.width = PREVIEW_BOX.width
  target.height = PREVIEW_BOX.height
  const ctx = target.getContext('2d')
  ctx.clearRect(0, 0, PREVIEW_BOX.width, PREVIEW_BOX.height)
  if (!source) return
  const scaled = resizeCanvas(source, PREVIEW_BOX.width, PREVIEW_BOX.height, 'contain')
  applyWatermark(scaled, store.watermark)
  ctx.drawImage(scaled, 0, 0)
}

watch(
  [() => store.renderVersion, () => store.watermark.enabled],
  () => nextTick(drawWatermarkPreview),
)
watch(store.watermark, () => nextTick(drawWatermarkPreview), { deep: true })
onMounted(drawWatermarkPreview)

const formatOptions = Object.entries(EXPORT_FORMATS).map(([value, config]) => ({
  value,
  label: config.label,
}))

const RESIZE_MODES = [
  { value: 'none', label: 'Off' },
  { value: 'longest', label: 'Longest' },
  { value: 'width', label: 'Width' },
  { value: 'percent', label: 'Percent' },
]

const disabled = computed(() => !store.activeItem || store.isDecoding || store.exportBusy || Boolean(store.batchProgress) || busy.value !== '')
const batchDisabled = computed(() => !store.items.length || store.isImporting || store.exportBusy || store.batchProgress !== null)

const batchUnit = computed(() => (store.batch.resize.mode === 'percent' ? '%' : 'px'))
const batchMax = computed(() => (store.batch.resize.mode === 'percent' ? 400 : 8000))

/** Beispielhafte Zielgroessen - zeigt sofort, was die Stapel-Einstellung bewirkt. */
const preview = computed(() =>
  store.items.slice(0, 3).map((item) => ({
    id: item.id,
    name: item.name,
    size: store.batchTargetSize(item),
  })),
)

const progressPercent = computed(() => {
  const progress = store.batchProgress
  if (!progress || !progress.total) return 0
  return Math.round((progress.done / progress.total) * 100)
})

async function run(key, action) {
  busy.value = key
  try {
    await action()
  } catch (error) {
    ui.setNotice('error', 'Export failed: ' + error.message, 7000)
  } finally {
    busy.value = ''
  }
}

function setBatchMode(mode) {
  store.batch.resize.mode = mode
  if (mode === 'percent') store.batch.resize.value = 100
  else if (mode === 'width') store.batch.resize.value = 1920
  else if (mode === 'longest') store.batch.resize.value = 1920
}
</script>

<template>
  <aside class="export">
    <section class="panel-section">
      <div class="section-title"><span>Save current image</span></div>
      <AppButton v-if="store.exportBusy" @click="store.cancelExport()">Cancel export</AppButton>
      <div class="stack">
        <SegmentedControl v-model="singleFormat" :options="formatOptions" />
        <SliderControl
          v-if="singleFormat !== 'png'"
          v-model="singleQuality"
          label="Quality"
          unit="%"
          :min="30"
          :max="100"
          :reset-value="92"
        />
        <p v-if="singleFormat === 'jpeg'" class="hint">JPEG has no transparency. Transparent areas become white.</p>
        <p v-if="singleEstBytes != null" class="hint">
          ~{{ formatBytes(singleEstBytes) }} estimated (preview resolution)
        </p>
        <AppButton
          icon="download"
          variant="primary"
          block
          :disabled="disabled"
          @click="run('save', () => store.saveActiveAs(singleFormat, singleQuality))"
        >
          Save as {{ (EXPORT_FORMATS[singleFormat] || {}).label }}
        </AppButton>
        <AppButton
          icon="copy"
          block
          :disabled="disabled"
          @click="run('copy', () => store.copyActiveToClipboard())"
        >
          Copy PNG to clipboard
        </AppButton>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Watermark</span></div>
      <div class="stack">
        <ToggleSwitch
          v-model="store.watermark.enabled"
          label="Add watermark on export"
          hint="Applies to single, clipboard and batch export"
        />
        <template v-if="store.watermark.enabled">
          <label class="field">
            <span class="field__label">Text</span>
            <input
              v-model="store.watermark.text"
              class="field__input"
              type="text"
              placeholder="e.g. © Your Name"
              spellcheck="false"
            />
          </label>
          <SegmentedControl
            :model-value="store.watermark.position"
            :options="WATERMARK_POSITIONS"
            @update:model-value="store.watermark.position = $event"
          />
          <SliderControl
            v-model="store.watermark.opacity"
            label="Opacity"
            unit="%"
            :min="10"
            :max="100"
            :reset-value="65"
          />
          <SliderControl
            v-model="store.watermark.scale"
            label="Size"
            unit="%"
            :min="1"
            :max="15"
            :reset-value="4"
          />
          <div class="watermark-preview checkerboard">
            <canvas ref="watermarkPreviewEl" />
          </div>
        </template>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Batch export</span></div>
      <div class="stack">
        <SegmentedControl
          :model-value="store.batch.format"
          :options="formatOptions"
          @update:model-value="store.batch.format = $event"
        />
        <SliderControl
          v-if="store.batch.format !== 'png'"
          v-model="store.batch.quality"
          label="Quality"
          unit="%"
          :min="30"
          :max="100"
          :reset-value="88"
        />
        <p v-if="store.batch.format === 'jpeg'" class="hint">JPEG uses a white background for transparent areas.</p>
        <p v-if="batchEstBytes != null" class="hint">
          ~{{ formatBytes(batchEstBytes) }} per image (approx., current photo)
        </p>

        <div class="section-label">Resize</div>
        <SegmentedControl
          :model-value="store.batch.resize.mode"
          :options="RESIZE_MODES"
          @update:model-value="setBatchMode"
        />
        <SliderControl
          v-if="store.batch.resize.mode !== 'none'"
          v-model="store.batch.resize.value"
          label="Target"
          :unit="batchUnit"
          :min="1"
          :max="batchMax"
        />

        <ToggleSwitch
          v-model="store.batch.applyEdits"
          label="Apply per-image edits"
          hint="Off skips per-image edits. Batch resize and watermark still apply."
        />

        <label class="field">
          <span class="field__label">File name pattern</span>
          <input v-model="store.batch.pattern" class="field__input" type="text" spellcheck="false" />
          <span class="hint">
            Placeholders: <code>{name}</code> <code>{index}</code> <code>{width}</code>
            <code>{height}</code>
          </span>
        </label>

        <ul v-if="preview.length" class="preview">
          <li v-for="entry in preview" :key="entry.id">
            <span class="preview__name">{{ entry.name }}</span>
            <span class="mono">{{ entry.size.width }} x {{ entry.size.height }}</span>
          </li>
          <li v-if="store.items.length > preview.length" class="preview__more">
            + {{ store.items.length - preview.length }} more
          </li>
        </ul>

        <p class="hint">{{ isDesktop ? 'Exports go into a new, unique subfolder. Existing files are preserved.' : 'ZIP limit: 256 MiB.' }} Settings are captured when export starts.</p>
        <AppButton v-if="store.batchProgress" @click="store.cancelBatch()">Cancel export</AppButton>
        <div v-if="store.batchProgress" class="progress" role="status" aria-live="polite">
          <div class="progress__bar"><span :style="{ width: progressPercent + '%' }" /></div>
          <span class="hint">
            {{ store.batchProgress.done }} / {{ store.batchProgress.total }} -
            {{ store.batchProgress.label }}
          </span>
        </div>

        <AppButton
          icon="download"
          variant="primary"
          block
          :disabled="batchDisabled"
          @click="store.runBatch()"
        >
          {{ 'Export ' + store.items.length + ' image(s)' + (isDesktop ? ' to folder' : ' as ZIP') }}
        </AppButton>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.export {
  width: var(--panel-width);
  flex: none;
  overflow-y: auto;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
}

.section-label {
  font-size: 11px;
  color: var(--text-subtle);
  margin-top: 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field__label {
  font-size: 12px;
  color: var(--text-muted);
}

.field__input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-family: var(--font-mono);
  font-size: 11px;
}

.field__input:focus {
  outline: none;
  border-color: var(--accent);
}

.hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-active);
  font-family: var(--font-mono);
  font-size: 10px;
}

.preview {
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  font-size: 11px;
  color: var(--text-subtle);
}

.preview li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 1px 0;
}

.preview__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview__more {
  color: var(--text-subtle);
  opacity: 0.7;
}

.progress {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.progress__bar {
  height: 5px;
  border-radius: 999px;
  background: var(--bg-active);
  overflow: hidden;
}

.progress__bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 160ms linear;
}

.watermark-preview {
  width: 100%;
  height: 160px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
}

.watermark-preview canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
