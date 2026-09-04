<script setup>
import { computed } from 'vue'
import { useLibraryStore } from '../../stores/library.js'
import { DEFAULT_ADJUSTMENTS } from '../../lib/adjustments.js'
import { DEFAULT_COLOR_SHIFT, targetHue } from '../../lib/colorShifts.js'
import ToneCurve from '../ui/ToneCurve.vue'
import LocalLightControls from '../ui/LocalLightControls.vue'
import { createEdits } from '../../lib/photoPipeline.js'
import SliderControl from '../ui/SliderControl.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'
import AppButton from '../ui/AppButton.vue'
import ColorField from '../ui/ColorField.vue'

const store = useLibraryStore()

const edits = computed(() => store.activeItem?.edits || createEdits())
const adjust = computed(() => edits.value.adjustments)
const shifts = computed(() => edits.value.colorShifts)
const disabled = computed(() => !store.activeItem || store.isDecoding)

const LOOKS = [
  { id: 'neutral', label: 'Neutral', values: {} },
  { id: 'punchy', label: 'Punchy', values: { contrast: 16, vibrance: 18, saturation: 6 } },
  { id: 'soft', label: 'Soft', values: { contrast: -10, exposure: 6, saturation: -6 } },
  { id: 'bw', label: 'B & W', values: { grayscale: 100, contrast: 14 } },
  { id: 'warm', label: 'Warm', values: { temperature: 28, vibrance: 10 } },
  { id: 'cool', label: 'Cool', values: { temperature: -28, vibrance: 8 } },
]

function applyLook(look) {
  if (!store.activeItem) return
  store.activeItem.edits.adjustments = { ...DEFAULT_ADJUSTMENTS, ...look.values }
}

function resetColors() {
  if (!store.activeItem) return
  store.activeItem.edits.adjustments = { ...DEFAULT_ADJUSTMENTS }
}

function togglePicker() {
  store.eyedropperMode = !store.eyedropperMode
}
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Automatic</span>
        <button type="button" class="link-btn" :disabled="disabled" @click="resetColors">reset</button>
      </div>
      <div class="stack">
        <AppButton icon="wand" block :disabled="disabled" @click="store.autoEnhance()">
          Auto tone
        </AppButton>
        <div class="looks">
          <AppButton
            v-for="look in LOOKS"
            :key="look.id"
            size="sm"
            :disabled="disabled"
            @click="applyLook(look)"
          >
            {{ look.label }}
          </AppButton>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Tone</span></div>
      <div class="stack">
        <SliderControl v-model="adjust.exposure" label="Exposure" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.brightness" label="Brightness" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.contrast" label="Contrast" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-for="control in [{ key: 'highlights', label: 'Highlights' }, { key: 'shadows', label: 'Shadows' }, { key: 'whites', label: 'Whites' }, { key: 'blacks', label: 'Blacks' }]"
          :key="control.key" v-model="adjust[control.key]" :label="control.label" :min="-100" :max="100" :disabled="disabled" />
        <ToggleSwitch v-model="store.clippingWarning" label="Show clipping (red / blue)" :disabled="disabled" />
        <SliderControl
          v-model="adjust.gamma"
          label="Gamma"
          :min="10"
          :max="300"
          :reset-value="100"
          :disabled="disabled"
          hint="Lighten or darken the midtones"
        />
      </div>
    </section>

    <LocalLightControls :disabled="disabled" />
    <section class="panel-section">
      <div class="section-title"><span>Color</span></div>
      <div class="stack">
        <AppButton icon="eyedropper" block :active="store.eyedropperMode === 'white-balance'" :disabled="disabled" @click="store.eyedropperMode = store.eyedropperMode === 'white-balance' ? false : 'white-balance'">Sample neutral gray</AppButton>
        <p v-if="store.eyedropperMode === 'white-balance'" class="hint">Click a neutral midtone. Samples original colors, before other edits. Avoid clipped whites and deep shadows.</p>
        <SliderControl v-model="adjust.temperature" label="Temperature" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.tint" label="Tint · green / magenta" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.saturation" label="Saturation" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.vibrance" label="Vibrance" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.hue" label="Hue" unit="deg" :min="-180" :max="180" :disabled="disabled" />
        <SliderControl v-model="adjust.grayscale" label="Grayscale" unit="%" :min="0" :max="100" :disabled="disabled" />
        <ToggleSwitch v-model="adjust.invert" label="Invert colors" :disabled="disabled" />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Tone curve</span></div>
      <ToneCurve v-model="edits.curve" :disabled="disabled" />
    </section>

    <section class="panel-section">
      <div class="section-title">
        <span>Selective color</span>
        <button
          v-if="shifts.length"
          type="button"
          class="link-btn"
          :disabled="disabled"
          @click="store.clearColorShifts()"
        >
          remove all
        </button>
      </div>

      <div class="stack">
        <div class="picker-row">
          <AppButton
            icon="eyedropper"
            block
            :active="store.eyedropperMode"
            :disabled="disabled"
            title="Pick a color from the image and change only that color"
            @click="togglePicker"
          >
            Pick color
          </AppButton>
          <AppButton
            icon="plus"
            :disabled="disabled"
            title="Add a color manually"
            @click="store.addColorShift(DEFAULT_COLOR_SHIFT.hex)"
          />
        </div>

        <p v-if="store.eyedropperMode" class="hint hint--accent">
          Click the color in the image you want to change.
        </p>
        <p v-else-if="!shifts.length" class="hint">
          Shifts one color only - everything outside the picked hue stays untouched.
        </p>

        <div v-for="(shift, index) in shifts" :key="index" class="shift">
          <div class="shift__head">
            <ColorField v-model="shift.hex" class="shift__field" label="Target color" />
            <AppButton
              icon="trash"
              variant="danger"
              size="sm"
              title="Remove color"
              @click="store.removeColorShift(index)"
            />
          </div>
          <p v-if="targetHue(shift.hex) === null" class="hint hint--warn">
            Greys, black and white have no hue. Pick a colored area instead.
          </p>
          <SliderControl
            v-model="shift.hue"
            label="Hue"
            unit="deg"
            :min="-180"
            :max="180"
            :disabled="disabled"
          />
          <SliderControl
            v-model="shift.saturation"
            label="Saturation"
            :min="-100"
            :max="100"
            :disabled="disabled"
          />
          <SliderControl
            v-model="shift.lightness"
            label="Lightness"
            :min="-100"
            :max="100"
            :disabled="disabled"
          />
          <SliderControl
            v-model="shift.range"
            label="Range"
            unit="deg"
            :min="5"
            :max="90"
            :reset-value="DEFAULT_COLOR_SHIFT.range"
            :disabled="disabled"
            hint="How many neighboring hues are included"
          />
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Detail</span></div>
      <div class="stack">
        <SliderControl
          v-model="edits.sharpen"
          label="Sharpen"
          unit="%"
          :min="0"
          :max="100"
          :disabled="disabled"
          hint="Helps with soft scans and JPEG sources"
        />
        <SliderControl v-model="edits.blur" label="Blur" unit="px" :min="0" :max="20" :disabled="disabled" />
        <SliderControl
          v-model="edits.vignette"
          label="Vignette"
          unit="%"
          :min="0"
          :max="100"
          :disabled="disabled"
          hint="Darkens the corners towards the frame"
        />
      </div>
    </section>

    <section class="panel-section">
      <AppButton
        icon="layers"
        block
        :disabled="disabled || store.items.length < 2"
        @click="store.applyEditsToAll()"
      >
        Apply settings to all images
      </AppButton>
      <p class="hint" style="margin-top: var(--space-2)">
        Copies color, detail and resize settings to every other image. The crop stays per image.
      </p>
    </section>
  </div>
</template>

<style scoped>
.looks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.picker-row {
  display: flex;
  gap: var(--space-2);
}

.picker-row > :first-child {
  flex: 1;
}

.shift {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.shift__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.shift__field {
  flex: 1;
  min-width: 0;
}

.hint--accent {
  color: var(--accent-text);
}

.hint--warn {
  color: var(--warning);
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
</style>
