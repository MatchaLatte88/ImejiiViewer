<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <label class="toggle" :class="{ 'is-disabled': disabled }">
    <span class="toggle__text">
      <span class="toggle__label">{{ label }}</span>
      <span v-if="hint" class="toggle__hint">{{ hint }}</span>
    </span>
    <input
      class="toggle__input"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', $event.target.checked)"
    />
    <span class="toggle__track"><span class="toggle__thumb" /></span>
  </label>
</template>

<style scoped>
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  cursor: pointer;
  user-select: none;
}

.toggle.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.toggle__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.toggle__label {
  font-size: 12px;
  color: var(--text);
}

.toggle__hint {
  font-size: 11px;
  color: var(--text-subtle);
  line-height: 1.35;
}

.toggle__input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle__track {
  flex: none;
  position: relative;
  width: 34px;
  height: 19px;
  border-radius: 999px;
  background: var(--bg-active);
  border: 1px solid var(--border);
  transition: background var(--transition);
}

.toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--text-muted);
  transition:
    transform var(--transition),
    background var(--transition);
}

.toggle__input:checked + .toggle__track {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle__input:checked + .toggle__track .toggle__thumb {
  transform: translateX(15px);
  background: #fff;
}

.toggle__input:focus-visible + .toggle__track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
