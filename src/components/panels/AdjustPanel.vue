<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor.js'
import { DEFAULT_ADJUSTMENTS } from '../../lib/adjustments.js'
import SliderControl from '../ui/SliderControl.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'
import AppButton from '../ui/AppButton.vue'

const store = useEditorStore()
const adjust = computed(() => store.settings.adjustments)

/** Quick looks for everyday logo work. */
const QUICK_LOOKS = [
  { id: 'neutral', label: 'Neutral', values: {} },
  { id: 'punchy', label: 'Punchy', values: { contrast: 18, saturation: 14, vibrance: 10 } },
  { id: 'flat', label: 'Flat', values: { contrast: -12, saturation: -8, exposure: 4 } },
  { id: 'mono', label: 'Grayscale', values: { grayscale: 100, contrast: 10 } },
  { id: 'invert', label: 'Inverted', values: { invert: true } },
]

function applyLook(look) {
  store.settings.adjustments = { ...DEFAULT_ADJUSTMENTS, ...look.values }
}

function resetAdjustments() {
  store.settings.adjustments = { ...DEFAULT_ADJUSTMENTS }
}
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Quick looks</span>
        <button type="button" class="link-btn" @click="resetAdjustments">reset</button>
      </div>
      <div class="looks">
        <AppButton v-for="look in QUICK_LOOKS" :key="look.id" size="sm" @click="applyLook(look)">
          {{ look.label }}
        </AppButton>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Tone</span></div>
      <div class="stack">
        <SliderControl v-model="adjust.exposure" label="Exposure" :min="-100" :max="100" />
        <SliderControl v-model="adjust.brightness" label="Brightness" :min="-100" :max="100" />
        <SliderControl v-model="adjust.contrast" label="Contrast" :min="-100" :max="100" />
        <SliderControl
          v-model="adjust.gamma"
          label="Gamma"
          :min="10"
          :max="300"
          :reset-value="100"
          hint="Lighten or darken the midtones"
        />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Color</span></div>
      <div class="stack">
        <SliderControl
          v-model="adjust.temperature"
          label="Temperature"
          :min="-100"
          :max="100"
          hint="Negative = cooler, positive = warmer"
        />
        <SliderControl v-model="adjust.saturation" label="Saturation" :min="-100" :max="100" />
        <SliderControl
          v-model="adjust.vibrance"
          label="Vibrance"
          :min="-100"
          :max="100"
          hint="Boosts muted colors more than already saturated ones"
        />
        <SliderControl v-model="adjust.hue" label="Hue" unit="deg" :min="-180" :max="180" />
        <SliderControl v-model="adjust.grayscale" label="Grayscale" unit="%" :min="0" :max="100" />
      </div>
    </section>

    <section class="panel-section">
      <ToggleSwitch v-model="adjust.invert" label="Invert colors" />
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

.link-btn:hover {
  color: var(--accent-text);
}
</style>
