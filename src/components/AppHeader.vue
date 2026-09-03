<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { useTheme } from '../composables/useTheme.js'
import { formatBytes } from '../lib/download.js'
import AppButton from './ui/AppButton.vue'
import AppIcon from './ui/AppIcon.vue'

const store = useEditorStore()
const { theme, toggleTheme } = useTheme()

const emit = defineEmits(['open-file'])

const meta = computed(() => {
  if (!store.source) return null
  const output = store.outputSize
  return {
    name: store.source.name,
    input: store.source.width + ' x ' + store.source.height,
    output: output ? output.width + ' x ' + output.height : '-',
    size: formatBytes(store.source.size),
  }
})
</script>

<template>
  <header class="header">
    <div class="header__brand">
      <span class="header__mark">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.18" />
          <path
            d="M7 17V7h4a3.5 3.5 0 0 1 0 7H9.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="16" cy="15.5" r="2" fill="currentColor" />
        </svg>
      </span>
      <div class="header__title">
        <h1>Logo Creator</h1>
        <p>Icons &amp; Logos aus Bildern</p>
      </div>
    </div>

    <div v-if="meta" class="header__meta">
      <span class="header__filename" :title="meta.name">{{ meta.name }}</span>
      <span class="header__divider" />
      <span class="mono">{{ meta.input }} px</span>
      <AppIcon name="chevron" :size="12" />
      <span class="mono header__output">{{ meta.output }} px</span>
    </div>

    <div class="header__actions">
      <AppButton
        icon="undo"
        variant="ghost"
        title="Rueckgaengig (Strg+Z)"
        :disabled="!store.canUndo"
        @click="store.undo()"
      />
      <AppButton
        icon="redo"
        variant="ghost"
        title="Wiederholen (Strg+Umschalt+Z)"
        :disabled="!store.canRedo"
        @click="store.redo()"
      />
      <AppButton
        icon="eye"
        variant="ghost"
        title="Original vergleichen (Taste halten: Leertaste)"
        :active="store.showOriginal"
        :disabled="!store.hasImage"
        @mousedown="store.showOriginal = true"
        @mouseup="store.showOriginal = false"
        @mouseleave="store.showOriginal = false"
      />
      <AppButton
        icon="reset"
        variant="ghost"
        title="Alle Einstellungen zuruecksetzen"
        :disabled="!store.hasImage"
        @click="store.resetSettings()"
      />
      <span class="header__divider" />
      <AppButton
        :icon="theme === 'dark' ? 'sun' : 'moon'"
        variant="ghost"
        :title="theme === 'dark' ? 'Helles Design' : 'Dunkles Design'"
        @click="toggleTheme"
      />
      <AppButton icon="upload" variant="primary" @click="emit('open-file')">Bild oeffnen</AppButton>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: var(--header-height);
  padding: 0 var(--space-4);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.header__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.header__mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
}

.header__title h1 {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.header__title p {
  font-size: 11px;
  color: var(--text-subtle);
  line-height: 1.2;
}

.header__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 4px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-muted);
}

.header__filename {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 500;
}

.header__output {
  color: var(--accent);
}

.header__divider {
  width: 1px;
  height: 16px;
  background: var(--border);
  flex: none;
}

.header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
  flex: none;
}

@media (max-width: 1100px) {
  .header__meta {
    display: none;
  }
}
</style>
