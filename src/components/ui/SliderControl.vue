<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Number, required: true },
  label: { type: String, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  unit: { type: String, default: '' },
  resetValue: { type: Number, default: null },
  disabled: { type: Boolean, default: false },
  hint: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const percent = computed(() => ((props.modelValue - props.min) / (props.max - props.min)) * 100)

/** Bipolar sliders fill from the center so the neutral point stays visible. */
const isBipolar = computed(() => props.min < 0 && props.max > 0)

const trackStyle = computed(() => {
  const zero = ((0 - props.min) / (props.max - props.min)) * 100
  const from = isBipolar.value ? Math.min(zero, percent.value) : 0
  const to = isBipolar.value ? Math.max(zero, percent.value) : percent.value
  return {
    background: `linear-gradient(to right,
      var(--bg-active) 0%, var(--bg-active) ${from}%,
      var(--accent) ${from}%, var(--accent) ${to}%,
      var(--bg-active) ${to}%, var(--bg-active) 100%)`,
  }
})

function onInput(event) {
  emit('update:modelValue', Number(event.target.value))
}

function onNumberInput(event) {
  const value = Number(event.target.value)
  if (Number.isNaN(value)) return
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, value)))
}

function reset() {
  emit('update:modelValue', props.resetValue ?? (isBipolar.value ? 0 : props.min))
}
</script>

<template>
  <div class="slider" :class="{ 'is-disabled': disabled }">
    <div class="slider__head">
      <button
        type="button"
        class="slider__label"
        :title="hint || 'Double-click to reset'"
        @dblclick="reset"
      >
        {{ label }}
      </button>
      <div class="slider__value">
        <input
          class="slider__number"
          type="number"
          :value="modelValue"
          :min="min"
          :max="max"
          :step="step"
          :disabled="disabled"
          @input="onNumberInput"
        />
        <span v-if="unit" class="slider__unit">{{ unit }}</span>
      </div>
    </div>
    <input
      class="slider__range"
      type="range"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :style="trackStyle"
      :aria-label="label"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.slider.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.slider__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: 6px;
}

.slider__label {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--text-muted);
  user-select: none;
}

.slider__label:hover {
  color: var(--text);
}

.slider__value {
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: var(--text);
}

.slider__number {
  width: 46px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 1px 2px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 11px;
  -moz-appearance: textfield;
}

.slider__number::-webkit-outer-spin-button,
.slider__number::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.slider__number:hover,
.slider__number:focus {
  border-color: var(--border-strong);
  background: var(--bg-input);
  outline: none;
}

.slider__unit {
  font-size: 10px;
  color: var(--text-subtle);
}

.slider__range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
}

.slider__range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 2px solid var(--accent);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition);
}

.slider__range::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.slider__range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 2px solid var(--accent);
  cursor: pointer;
}
</style>
