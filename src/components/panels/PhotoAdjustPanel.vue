<script setup>
import { computed } from 'vue'
import { useLibraryStore } from '../../stores/library.js'
import { DEFAULT_ADJUSTMENTS } from '../../lib/adjustments.js'
import { createEdits } from '../../lib/photoPipeline.js'
import SliderControl from '../ui/SliderControl.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'
import AppButton from '../ui/AppButton.vue'

const store = useLibraryStore()

const edits = computed(() => store.activeItem?.edits || createEdits())
const adjust = computed(() => edits.value.adjustments)
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

    <section class="panel-section">
      <div class="section-title"><span>Color</span></div>
      <div class="stack">
        <SliderControl v-model="adjust.temperature" label="Temperature" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.saturation" label="Saturation" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.vibrance" label="Vibrance" :min="-100" :max="100" :disabled="disabled" />
        <SliderControl v-model="adjust.hue" label="Hue" unit="deg" :min="-180" :max="180" :disabled="disabled" />
        <SliderControl v-model="adjust.grayscale" label="Grayscale" unit="%" :min="0" :max="100" :disabled="disabled" />
        <ToggleSwitch v-model="adjust.invert" label="Invert colors" :disabled="disabled" />
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
