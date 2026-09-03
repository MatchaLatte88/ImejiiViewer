<script setup>
import AppIcon from './AppIcon.vue'

defineProps({
  variant: { type: String, default: 'default' }, // default | primary | ghost | danger
  size: { type: String, default: 'md' }, // sm | md
  icon: { type: String, default: '' },
  block: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
</script>

<template>
  <button
    type="button"
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'btn--block': block, 'is-active': active }]"
    :disabled="disabled"
    :title="title"
  >
    <AppIcon v-if="icon" :name="icon" :size="size === 'sm' ? 14 : 16" />
    <span v-if="$slots.default" class="btn__label"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  border-radius: var(--radius);
  padding: 0 12px;
  height: 32px;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background var(--transition),
    border-color var(--transition),
    color var(--transition),
    transform var(--transition);
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn--sm {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
}

.btn--block {
  display: flex;
  width: 100%;
}

.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.btn--primary:hover:not(:disabled) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

.btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-muted);
}

.btn--ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: transparent;
  color: var(--text);
}

.btn--danger {
  color: var(--danger);
  border-color: transparent;
  background: transparent;
}

.btn--danger:hover:not(:disabled) {
  background: var(--danger-soft);
}

.btn.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.btn__label {
  line-height: 1;
}
</style>
