<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor.js'
import { DEFAULT_KEYING } from '../../lib/pipeline.js'
import { contrastColor, hexToRgb, rgbToHex } from '../../lib/color.js'
import SliderControl from '../ui/SliderControl.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ColorField from '../ui/ColorField.vue'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'

const store = useEditorStore()
const keying = computed(() => store.settings.keying)
const hasKeys = computed(() => keying.value.keys.length > 0)

const modeOptions = [
  { value: false, label: 'Everywhere', title: 'Remove every matching pixel in the image' },
  { value: true, label: 'Connected', title: 'Only the area connected to the border or the clicked point' },
]

function startPicker(mode) {
  store.eyedropperMode = store.eyedropperMode === mode ? null : mode
}

function resetKeying() {
  store.settings.keying = { ...DEFAULT_KEYING, keys: [], seeds: [] }
}

function addManualColor() {
  store.addKeyColor('#ffffff')
}

/** Replace the color in place so the order stays intact. */
function updateKeyColor(index, hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return
  keying.value.keys.splice(index, 1, { hex: rgbToHex(rgb.r, rgb.g, rgb.b), ...rgb })
}
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Remove background</span>
        <button v-if="hasKeys" type="button" class="link-btn" @click="resetKeying">
          reset
        </button>
      </div>

      <div class="stack">
        <AppButton icon="wand" block @click="store.autoDetectBackground()">
          Detect background automatically
        </AppButton>

        <div class="picker-row">
          <AppButton
            icon="eyedropper"
            block
            :active="store.eyedropperMode === 'add'"
            title="Pick a color from the image and add it to the list"
            @click="startPicker('add')"
          >
            Pick color
          </AppButton>
          <AppButton
            icon="plus"
            title="Add a color manually"
            @click="addManualColor"
          />
        </div>

        <p v-if="store.eyedropperMode" class="hint hint--accent">
          The preview now shows the original. Click the background color.
        </p>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title">
        <span>Transparent colors ({{ keying.keys.length }})</span>
        <button v-if="hasKeys" type="button" class="link-btn" @click="store.clearKeyColors()">
          remove all
        </button>
      </div>

      <p v-if="!hasKeys" class="hint">
        No color selected yet. Use the eyedropper on the background - every similar
        pixel then becomes transparent.
      </p>

      <ul v-else class="keys">
        <li v-for="(key, index) in keying.keys" :key="key.hex + index" class="keys__item">
          <span
            class="keys__swatch"
            :style="{ background: key.hex, color: contrastColor(key.r, key.g, key.b) }"
          >
            <AppIcon name="check" :size="12" />
          </span>
          <ColorField
            :model-value="key.hex"
            class="keys__field"
            @update:model-value="(value) => updateKeyColor(index, value)"
          />
          <AppButton
            icon="trash"
            variant="danger"
            size="sm"
            title="Remove color"
            @click="store.removeKeyColor(index)"
          />
        </li>
      </ul>
    </section>

    <section class="panel-section" :class="{ 'is-muted': !hasKeys }">
      <div class="section-title"><span>Selection</span></div>
      <div class="stack">
        <SegmentedControl v-model="keying.contiguous" :options="modeOptions" :disabled="!hasKeys" />
        <p v-if="keying.contiguous" class="hint">
          Only the area connected to the image border or the clicked point is removed.
          Matching colors inside the logo stay untouched.
        </p>

        <SliderControl
          v-model="keying.tolerance"
          label="Tolerance"
          unit="%"
          :min="0"
          :max="100"
          :step="0.5"
          :reset-value="DEFAULT_KEYING.tolerance"
          :disabled="!hasKeys"
          hint="How far a color may deviate and still be removed"
        />
        <SliderControl
          v-model="keying.softness"
          label="Soft transition"
          unit="%"
          :min="0"
          :max="50"
          :step="0.5"
          :reset-value="DEFAULT_KEYING.softness"
          :disabled="!hasKeys"
          hint="Width of the semi-transparent transition"
        />
      </div>
    </section>

    <section class="panel-section" :class="{ 'is-muted': !hasKeys }">
      <div class="section-title"><span>Edges</span></div>
      <div class="stack">
        <SliderControl
          v-model="keying.despill"
          label="Remove color fringe"
          unit="%"
          :min="0"
          :max="100"
          :reset-value="DEFAULT_KEYING.despill"
          :disabled="!hasKeys"
          hint="Removes the background color from semi-transparent edge pixels"
        />
        <SliderControl
          v-model="keying.edgeContract"
          label="Shrink mask"
          :min="-100"
          :max="100"
          :reset-value="0"
          :disabled="!hasKeys"
          hint="Positive removes leftover fringes, negative keeps more of the subject"
        />
        <SliderControl
          v-model="keying.feather"
          label="Feather"
          unit="px"
          :min="0"
          :max="10"
          :step="0.5"
          :reset-value="0"
          :disabled="!hasKeys"
        />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Check the result</span></div>
      <ToggleSwitch
        v-model="store.showOriginal"
        label="Show original"
        hint="Displays the untouched image for comparison"
      />
    </section>
  </div>
</template>

<style scoped>
.panel-section.is-muted {
  opacity: 0.55;
}

.picker-row {
  display: flex;
  gap: var(--space-2);
}

.picker-row > :first-child {
  flex: 1;
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

.link-btn:hover {
  color: var(--accent-text);
}

.hint--accent {
  color: var(--accent-text);
}

.keys {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.keys__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.keys__swatch {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
}

.keys__field {
  flex: 1;
  min-width: 0;
}
</style>
