<script setup>
import { isDesktop } from '../../lib/desktop.js'
import { computed, ref } from 'vue'
import { useEditorStore } from '../../stores/editor.js'
import { EXPORT_FORMATS, formatBytes } from '../../lib/exportImage.js'
import MetadataControls from '../ui/MetadataControls.vue'
import { useEstimatedSize } from '../../composables/useEstimatedSize.js'
import { DEFAULT_ICO_SIZES } from '../../lib/ico.js'
import { EXPORT_PRESETS, QUICK_SIZES } from '../../lib/presets.js'
import SliderControl from '../ui/SliderControl.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'
import IconPreview from '../IconPreview.vue'
import IconContextPreview from '../IconContextPreview.vue'

const store = useEditorStore()

const format = ref('png')
const quality = ref(92)
const selectedSizes = ref([32, 128, 512])
const icoSizes = ref([...DEFAULT_ICO_SIZES])
const presetName = ref('')
const busy = ref('')

const formatOptions = Object.entries(EXPORT_FORMATS).map(([value, config]) => ({
  value,
  label: config.label,
}))

const needsQuality = computed(() => ['jpeg', 'webp'].includes(format.value))
const disabled = computed(() => !store.hasImage || store.isLoading || store.exportBusy || busy.value !== '')

/** JPG has no transparency - the background color from the shape section is used instead. */
const background = computed(() => store.settings.transform.background)
const alphaWarning = computed(
  () => format.value === 'jpeg' && !background.value,
)

function toggleSize(size) {
  const index = selectedSizes.value.indexOf(size)
  if (index >= 0) selectedSizes.value.splice(index, 1)
  else selectedSizes.value.push(size)
}

function toggleIcoSize(size) {
  const index = icoSizes.value.indexOf(size)
  if (index >= 0) icoSizes.value.splice(index, 1)
  else icoSizes.value.push(size)
}

async function run(key, action) {
  if (disabled.value) return
  busy.value = key
  try {
    await action()
  } catch (error) {
    store.setNotice('error', 'Export failed: ' + error.message, 7000)
  } finally {
    busy.value = ''
  }
}

const exportOptions = computed(() => ({
  format: format.value,
  quality: quality.value / 100,
  background: background.value,
}))

const { bytes: estimatedBytes } = useEstimatedSize(
  () => store.previewCanvas,
  () => format.value,
  () => quality.value,
  [() => store.renderVersion],
)
</script>

<template>
  <aside class="export">
    <AppButton v-if="store.exportBusy" @click="store.cancelExport()">Cancel export</AppButton>
    <section class="panel-section">
      <div class="section-title"><span>Preview</span></div>
      <div class="preview-row">
        <IconPreview :size="16" />
        <IconPreview :size="32" />
        <IconPreview :size="48" />
        <IconPreview :size="64" />
      </div>
      <p class="hint">This is how the result looks at real icon size.</p>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>In context</span></div>
      <IconContextPreview />
    </section>

    <section class="panel-section">
      <p class="hint">Icon bundles always use PNG/ICO. Desktop sets go into a new subfolder; browser sets download as ZIP.</p>
      <div class="section-title"><span>Format</span></div>
      <div class="stack">
        <SegmentedControl v-model="format" :options="formatOptions" />
        <SliderControl
          v-if="needsQuality"
          v-model="quality"
          label="Quality"
          unit="%"
          :min="30"
          :max="100"
          :reset-value="92"
        />
        <p v-if="alphaWarning" class="hint hint--warn">
          <AppIcon name="alert" :size="12" />
          JPG cannot store transparency. Without a background color (tab <b>Shape</b>)
          transparent areas are filled with white.
        </p>
        <p v-if="estimatedBytes != null" class="hint">
          ~{{ formatBytes(estimatedBytes) }} estimated (preview resolution)
        </p>
      </div>
    </section>

    <MetadataControls v-model:options="store.metadataOptions" :disabled="!store.hasImage || store.exportBusy" />
    <section class="panel-section">
      <div class="section-title"><span>Sizes</span></div>
      <div class="chips">
        <button
          v-for="size in QUICK_SIZES"
          :key="size"
          type="button"
          class="chip mono"
          :class="{ 'is-active': selectedSizes.includes(size) }"
          @click="toggleSize(size)"
        >
          {{ size }}
        </button>
      </div>
      <div class="stack" style="margin-top: var(--space-3)">
        <AppButton
          icon="download"
          variant="primary"
          block
          :disabled="disabled || !selectedSizes.length"
          @click="
            run('sizes', () =>
              store.exportCustomSizes([...selectedSizes].sort((a, b) => a - b), exportOptions),
            )
          "
        >
          {{ selectedSizes.length > 1 ? selectedSizes.length + (isDesktop ? ' sizes to folder' : ' sizes as ZIP') : 'Export size' }}
        </AppButton>
        <AppButton
          icon="image"
          block
          :disabled="disabled"
          @click="run('full', () => store.exportSingle(exportOptions))"
        >
          Export at original size
        </AppButton>
        <AppButton
          icon="copy"
          block
          :disabled="disabled"
          @click="run('clip', () => store.copyToClipboard())"
        >
          Copy PNG to clipboard
        </AppButton>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Windows icon (.ico)</span></div>
      <div class="chips">
        <button
          v-for="size in DEFAULT_ICO_SIZES"
          :key="size"
          type="button"
          class="chip mono"
          :class="{ 'is-active': icoSizes.includes(size) }"
          @click="toggleIcoSize(size)"
        >
          {{ size }}
        </button>
      </div>
      <AppButton
        icon="download"
        block
        style="margin-top: var(--space-3)"
        :disabled="disabled || !icoSizes.length"
        @click="run('ico', () => store.exportIco([...icoSizes].sort((a, b) => a - b)))"
      >
        .ico with {{ icoSizes.length }} sizes
      </AppButton>
      <p class="hint" style="margin-top: var(--space-2)">
        Contains every selected resolution in one file - Windows picks the matching one.
      </p>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Ready-made bundles</span></div>
      <ul class="presets">
        <li v-for="preset in EXPORT_PRESETS" :key="preset.id">
          <button
            type="button"
            class="preset"
            :disabled="disabled"
            @click="run(preset.id, () => store.exportPreset(preset.id, exportOptions))"
          >
            <span class="preset__head">
              <span class="preset__name">{{ preset.name }}</span>
              <AppIcon :name="busy === preset.id ? 'reset' : 'download'" :size="14" />
            </span>
            <span class="preset__desc">{{ preset.description }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Your own presets</span></div>
      <div class="stack">
        <div class="save-row">
          <input
            v-model="presetName"
            class="save-row__input"
            type="text"
            placeholder="e.g. product logo light"
            @keyup.enter="
              () => {
                store.savePreset(presetName)
                presetName = ''
              }
            "
          />
          <AppButton
            icon="save"
            title="Save current settings"
            @click="
              () => {
                store.savePreset(presetName)
                presetName = ''
              }
            "
          />
        </div>
        <p v-if="!store.savedPresets.length" class="hint">
          Saved settings can be applied to other images - handy for a consistent
          product family.
        </p>
        <ul v-else class="saved">
          <li v-for="preset in store.savedPresets" :key="preset.id">
            <button type="button" class="saved__apply" @click="store.applySavedPreset(preset.id)">
              <AppIcon name="layers" :size="13" />
              {{ preset.name }}
            </button>
            <AppButton
              icon="trash"
              variant="danger"
              size="sm"
              title="Delete preset"
              @click="store.deleteSavedPreset(preset.id)"
            />
          </li>
        </ul>
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

.preview-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: var(--space-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  min-width: 42px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-muted);
  transition:
    background var(--transition),
    color var(--transition),
    border-color var(--transition);
}

.chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-text);
}

.presets {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.preset {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-input);
  transition:
    border-color var(--transition),
    background var(--transition);
}

.preset:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.preset:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preset__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--text);
}

.preset__name {
  font-size: 12px;
  font-weight: 600;
}

.preset__desc {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-subtle);
  line-height: 1.4;
}

.save-row {
  display: flex;
  gap: var(--space-2);
}

.save-row__input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-input);
}

.save-row__input:focus {
  outline: none;
  border-color: var(--accent);
}

.saved {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.saved li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.saved__apply {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: var(--bg-input);
  color: var(--text-muted);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved__apply:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.hint--warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--warning);
}

.hint--warn b {
  font-weight: 600;
}
</style>
