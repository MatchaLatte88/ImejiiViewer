<script setup>
import { ref, watch } from 'vue'
import { hexToRgb, rgbToHex } from '../../lib/color.js'

const props = defineProps({
  modelValue: { type: String, default: '#ffffff' },
  label: { type: String, default: '' },
  allowEmpty: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const draft = ref(props.modelValue || '#ffffff')

watch(
  () => props.modelValue,
  (value) => {
    draft.value = value || '#ffffff'
  },
)

function commitText() {
  const rgb = hexToRgb(draft.value)
  if (!rgb) {
    draft.value = props.modelValue || '#ffffff'
    return
  }
  emit('update:modelValue', rgbToHex(rgb.r, rgb.g, rgb.b))
}
</script>

<template>
  <div class="color-field">
    <label class="color-field__swatch" :style="{ background: modelValue || '#ffffff' }">
      <input
        type="color"
        class="color-field__input"
        :value="modelValue || '#ffffff'"
        :aria-label="label || 'Farbe'"
        @input="emit('update:modelValue', $event.target.value)"
      />
    </label>
    <input
      v-model="draft"
      class="color-field__text mono"
      type="text"
      spellcheck="false"
      :aria-label="(label || 'Farbe') + ' als Hex-Wert'"
      @blur="commitText"
      @keyup.enter="commitText"
    />
    <slot />
  </div>
</template>

<style scoped>
.color-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.color-field__swatch {
  position: relative;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  cursor: pointer;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
}

.color-field__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}

.color-field__text {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  text-transform: lowercase;
}

.color-field__text:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
