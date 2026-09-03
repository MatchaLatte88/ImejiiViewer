<script setup>
import { computed } from 'vue'
import { useLibraryStore } from '../../stores/library.js'
import { createEdits, previewGeometry } from '../../lib/photoPipeline.js'
import SliderControl from '../ui/SliderControl.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import AppButton from '../ui/AppButton.vue'

const store = useLibraryStore()

const edits = computed(() => store.activeItem?.edits || createEdits())
const disabled = computed(() => !store.activeItem || store.isDecoding)

const ASPECTS = [
  { value: null, label: 'Free' },
  { value: 1, label: '1:1' },
  { value: 4 / 3, label: '4:3' },
  { value: 3 / 2, label: '3:2' },
  { value: 16 / 9, label: '16:9' },
]

/** Zuschnittverhaeltnisse gaengiger Social-Media-Formate - ergaenzen ASPECTS um Hoch- und Breitformate. */
const SOCIAL_ASPECTS = [
  { value: 9 / 16, label: 'Story', ratio: '9:16' },
  { value: 4 / 5, label: 'Portrait', ratio: '4:5' },
  { value: 2 / 3, label: 'Pinterest', ratio: '2:3' },
  { value: 4, label: 'Banner', ratio: '4:1' },
]

const RESIZE_MODES = [
  { value: 'none', label: 'Off' },
  { value: 'longest', label: 'Longest' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'percent', label: 'Percent' },
]

/** Groesse vor dem Skalieren - Basis fuer die Hochskalier-Warnung. */
const croppedSize = computed(() => {
  const item = store.activeItem
  if (!item) return null
  return previewGeometry(item.width, item.height, { ...item.edits, resize: { mode: 'none' } })
})

const targetSize = computed(() => store.outputSize)

const isUpscaling = computed(() => {
  const item = store.activeItem
  const target = targetSize.value
  if (!item || !target) return false
  return target.width > croppedSize.value.width || target.height > croppedSize.value.height
})

const resizeUnit = computed(() => (edits.value.resize.mode === 'percent' ? '%' : 'px'))
const resizeMax = computed(() => (edits.value.resize.mode === 'percent' ? 400 : 8000))

function setResizeMode(mode) {
  if (!store.activeItem) return
  const resize = store.activeItem.edits.resize
  resize.mode = mode
  if (mode === 'percent') resize.value = 100
  else if (mode === 'width') resize.value = croppedSize.value?.width || 1920
  else if (mode === 'height') resize.value = croppedSize.value?.height || 1080
  else if (mode === 'longest') resize.value = 1920
}

function resetGeometry() {
  if (!store.activeItem) return
  const item = store.activeItem
  item.edits.rotate = 0
  item.edits.flipH = false
  item.edits.flipV = false
  item.edits.straighten = 0
  item.edits.crop = null
  item.edits.resize = { mode: 'none', value: 100 }
  store.cropDraft = null
}
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Crop</span>
        <button type="button" class="link-btn" :disabled="disabled" @click="resetGeometry">reset</button>
      </div>
      <div class="stack">
        <AppButton
          icon="crop"
          block
          :active="store.cropMode"
          :disabled="disabled"
          @click="store.cropMode = !store.cropMode"
        >
          {{ store.cropMode ? 'Cropping - drag in the image' : 'Start crop' }}
        </AppButton>

        <SegmentedControl
          :model-value="store.cropAspect"
          :options="ASPECTS"
          :disabled="disabled"
          @update:model-value="store.cropAspect = $event"
        />

        <div class="section-label">Social media</div>
        <div class="chips">
          <button
            v-for="preset in SOCIAL_ASPECTS"
            :key="preset.label"
            type="button"
            class="chip"
            :class="{ 'is-active': store.cropAspect === preset.value }"
            :disabled="disabled"
            :title="preset.label + ' ' + preset.ratio"
            @click="store.cropAspect = preset.value"
          >
            {{ preset.label }}
          </button>
        </div>

        <div v-if="store.cropMode" class="btn-row">
          <AppButton variant="primary" size="sm" :disabled="!store.cropDraft" @click="store.applyCrop()">
            Apply crop
          </AppButton>
          <AppButton size="sm" @click="store.cancelCrop()">Cancel</AppButton>
        </div>

        <div v-if="edits.crop" class="row-between">
          <span class="hint">Cropped to {{ Math.round(edits.crop.width * 100) }} x {{ Math.round(edits.crop.height * 100) }} %</span>
          <AppButton size="sm" variant="ghost" icon="close" title="Remove crop" @click="store.clearCrop()" />
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Rotate &amp; flip</span></div>
      <div class="stack">
        <div class="btn-row">
          <AppButton icon="rotate" size="sm" :disabled="disabled" title="Rotate left" @click="store.rotateBy(-90)">
            -90
          </AppButton>
          <AppButton icon="rotate" size="sm" :disabled="disabled" title="Rotate right" @click="store.rotateBy(90)">
            +90
          </AppButton>
          <AppButton
            icon="flipH"
            size="sm"
            title="Flip horizontally"
            :active="edits.flipH"
            :disabled="disabled"
            @click="store.flip('h')"
          />
          <AppButton
            icon="flipV"
            size="sm"
            title="Flip vertically"
            :active="edits.flipV"
            :disabled="disabled"
            @click="store.flip('v')"
          />
        </div>
        <SliderControl
          v-model="edits.straighten"
          label="Straighten"
          unit="deg"
          :min="-45"
          :max="45"
          :step="0.1"
          :reset-value="0"
          :disabled="disabled"
          hint="Rotates freely and trims the empty corners automatically"
        />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Resize</span></div>
      <div class="stack">
        <SegmentedControl
          :model-value="edits.resize.mode"
          :options="RESIZE_MODES"
          :disabled="disabled"
          @update:model-value="setResizeMode"
        />
        <SliderControl
          v-if="edits.resize.mode !== 'none'"
          v-model="edits.resize.value"
          label="Target"
          :unit="resizeUnit"
          :min="1"
          :max="resizeMax"
          :disabled="disabled"
        />
        <div v-if="targetSize" class="size-box">
          <div class="size-box__row">
            <span>Source</span>
            <span class="mono">{{ store.activeItem?.width }} x {{ store.activeItem?.height }}</span>
          </div>
          <div class="size-box__row size-box__row--strong">
            <span>Output</span>
            <span class="mono">{{ targetSize.width }} x {{ targetSize.height }}</span>
          </div>
        </div>
        <p v-if="isUpscaling" class="hint hint--warn">
          The target is larger than the source - the image will be upscaled and lose detail.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.btn-row {
  display: flex;
  gap: var(--space-2);
}

.btn-row > * {
  flex: 1;
}

.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.link-btn {
  border: none;
  background: none;
  padding: 0;
  font-size: 11px;
  color: var(--text-subtle);
  text-transform: none;
  letter-spacing: 0;
}

.link-btn:hover:not(:disabled) {
  color: var(--accent-text);
}

.link-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.section-label {
  font-size: 11px;
  color: var(--text-subtle);
  margin-top: 2px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 12px;
  transition:
    background var(--transition),
    color var(--transition),
    border-color var(--transition);
}

.chip:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-text);
}

.chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.size-box {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.size-box__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 11px;
  color: var(--text-subtle);
}

.size-box__row--strong {
  margin-top: 3px;
  color: var(--text);
}

.hint--warn {
  color: var(--warning);
}
</style>
