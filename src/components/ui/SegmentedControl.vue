<script setup>
import AppIcon from './AppIcon.vue'

defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, required: true }, // [{ value, label?, icon?, title? }]
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="segmented" :class="{ 'is-disabled': disabled }" role="group">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="segmented__item"
      :class="{ 'is-active': option.value === modelValue }"
      :title="option.title || option.label"
      :aria-pressed="option.value === modelValue"
      :disabled="disabled"
      :aria-label="option.title || option.label"
      @click="emit('update:modelValue', option.value)"
    >
      <AppIcon v-if="option.icon" :name="option.icon" :size="14" />
      <span v-if="option.label">{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.segmented.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.segmented__item {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: calc(var(--radius) - 3px);
  font-size: 12px;
  white-space: nowrap;
  transition:
    background var(--transition),
    color var(--transition);
}

.segmented__item:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.segmented__item.is-active {
  background: var(--bg-elevated);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
</style>
