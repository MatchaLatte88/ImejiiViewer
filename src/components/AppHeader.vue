<script setup>
import { computed } from 'vue'
import { useUiStore } from '../stores/ui.js'
import { useEditorStore } from '../stores/editor.js'
import { useLibraryStore } from '../stores/library.js'
import { usePluginStore } from '../stores/plugins.js'
import { useStudioStore } from '../stores/studio.js'
import { openCurrentInStudio } from '../plugins/studio-host.js'
import { useTheme } from '../composables/useTheme.js'
import AppButton from './ui/AppButton.vue'
import AppIcon from './ui/AppIcon.vue'
import SegmentedControl from './ui/SegmentedControl.vue'

const ui = useUiStore()
const editor = useEditorStore()
const library = useLibraryStore()
const plugins = usePluginStore(), studio = useStudioStore()
const { theme, toggleTheme } = useTheme()

const emit = defineEmits(['open-file', 'set-mode'])

const isImageMode = computed(() => ui.mode === 'images')
const isViewMode = computed(() => ui.mode === 'view')

/** Betrachter und Bildmodus arbeiten an derselben Bibliothek. */
const usesLibrary = computed(() => ['view', 'images'].includes(ui.mode))

const MODES = computed(() => [
  { value: 'logo', label: 'Logo', icon: 'palette', title: 'Cut out logos and build icon sets' },
  { value: 'images', label: 'Images', icon: 'layers', title: 'View, edit and convert photos' },
  ...(plugins.studioEnabled ? [{ value: 'ai-studio', label: 'AI Studio', icon: 'wand', title: 'Local SDXL creation and editing (Ctrl+4)' }] : []),
])

/** Der Header bedient alle Modi - hier laufen die Unterschiede zusammen. */
const state = computed(() => {
  if (ui.mode === 'ai-studio') {
    const result = studio.selectedResult?.provenance
    return { hasContent: studio.hasDocument, name: studio.document?.name, input: studio.hasSource ? studio.document.width + ' x ' + studio.document.height : null,
      output: result ? result.outputWidth + ' x ' + result.outputHeight : studio.operation === 'text-to-image' && studio.document ? studio.document.parameters.width + ' x ' + studio.document.parameters.height : null,
      canUndo: studio.canUndo, canRedo: studio.canRedo, canCompare: studio.hasSource && Boolean(studio.selectedResult?.provenance.sourceSha256), canReset: studio.operation === 'inpaint' && studio.hasSource, openLabel: 'Open source' }
  }
  if (usesLibrary.value) {
    const item = library.activeItem
    const output = library.outputSize
    return {
      hasContent: library.hasItems,
      name: item?.name || null,
      input: item ? item.width + ' x ' + item.height : null,
      output: output ? output.width + ' x ' + output.height : null,
      canUndo: library.canUndo,
      canRedo: library.canRedo,
      openLabel: 'Open images',
    }
  }

  const output = editor.outputSize
  return {
    hasContent: editor.hasImage,
    name: editor.source?.name || null,
    input: editor.source ? editor.source.width + ' x ' + editor.source.height : null,
    output: output ? output.width + ' x ' + output.height : null,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    openLabel: 'Open image',
  }
})

function undo() {
  ui.mode === 'ai-studio' ? studio.undo() : isImageMode.value ? library.undo() : editor.undo()
}

function redo() {
  ui.mode === 'ai-studio' ? studio.redo() : isImageMode.value ? library.redo() : editor.redo()
}

function reset() {
  try { ui.mode === 'ai-studio' ? studio.operation === 'inpaint' && studio.clearMask() : isImageMode.value ? library.resetEdits() : editor.resetSettings() }
  catch (error) { ui.setNotice('error', error.message) }
}

function setCompare(value) {
  if (ui.mode === 'ai-studio') { studio.compare = value; return }
  if (isImageMode.value) library.showOriginal = value
  else editor.showOriginal = value
}

const isComparing = computed(() =>
  ui.mode === 'ai-studio' ? studio.compare : isImageMode.value ? library.showOriginal : editor.showOriginal,
)
async function sendToStudio() {
  try { await openCurrentInStudio(ui.mode) } catch (error) { ui.setNotice('error', error.message, 8000) }
}
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
        <h1>Imejii</h1>
        <p>View, edit and convert images</p>
      </div>
    </div>

    <!-- Der Betrachter bietet den Weg in die Bearbeitung an, die Werkzeugmodi
         den Weg zurueck. -->
    <div v-if="isViewMode" class="header__switch">
      <AppButton v-if="plugins.studioEnabled" icon="wand" @click="emit('set-mode', 'ai-studio')">AI Studio</AppButton>
      <AppButton icon="palette" title="Cut out logos and build icon sets (Ctrl+2)" @click="emit('set-mode', 'logo')">
        Logo Creator
      </AppButton>
      <AppButton
        icon="sliders"
        :variant="state.hasContent ? 'primary' : 'default'"
        :disabled="!state.hasContent"
        title="Edit this image (Ctrl+3)"
        @click="emit('set-mode', 'images')"
      >
        Edit
      </AppButton>
    </div>

    <div v-else class="header__switch">
      <AppButton icon="image" variant="ghost" title="Back to the viewer (Ctrl+1)" @click="emit('set-mode', 'view')" />
      <SegmentedControl
        class="header__modes"
        :style="{ width: MODES.length * 95 + 'px' }"
        :model-value="ui.mode"
        :options="MODES"
        @update:model-value="emit('set-mode', $event)"
      />
    </div>

    <div v-if="state.name" class="header__meta">
      <span class="header__filename" :title="state.name">{{ state.name }}</span>
      <template v-if="state.input"><span class="header__divider" /><span class="mono">{{ state.input }} px</span></template>
      <AppIcon v-if="state.input && state.output" name="chevron" :size="12" />
      <span v-if="state.output" class="mono header__output">{{ state.output }} px</span>
    </div>

    <div class="header__actions">
      <AppButton v-if="plugins.studioEnabled && ui.mode !== 'ai-studio' && state.hasContent" icon="wand" variant="ghost" title="Open current rendered image in AI Studio" @click="sendToStudio" />
      <!-- Im Betrachter gibt es nichts zu bearbeiten - die Werkzeuge entfallen. -->
      <template v-if="!isViewMode">
        <AppButton
          icon="undo"
          variant="ghost"
          title="Undo (Ctrl+Z)"
          :disabled="!state.canUndo"
          @click="undo"
        />
        <AppButton
          icon="redo"
          variant="ghost"
          title="Redo (Ctrl+Shift+Z)"
          :disabled="!state.canRedo"
          @click="redo"
        />
        <AppButton
          icon="eye"
          variant="ghost"
          title="Compare with original (hold Space)"
          :active="isComparing"
          :disabled="ui.mode === 'ai-studio' ? !state.canCompare : !state.hasContent"
          @mousedown="setCompare(true)"
          @mouseup="setCompare(false)"
          @mouseleave="setCompare(false)"
        />
        <AppButton
          icon="reset"
          variant="ghost"
          :title="ui.mode === 'ai-studio' ? 'Clear selection (undoable)' : isImageMode ? 'Reset edits for this image' : 'Reset all settings'"
          :disabled="ui.mode === 'ai-studio' ? !state.canReset || studio.busy || studio.drawing : !state.hasContent"
          @click="reset"
        />
        <span class="header__divider" />
      </template>
      <AppButton
        :icon="theme === 'dark' ? 'sun' : 'moon'"
        variant="ghost"
        :title="theme === 'dark' ? 'Light theme' : 'Dark theme'"
        @click="toggleTheme"
      />
      <AppButton
        icon="upload"
        :variant="isViewMode && state.hasContent ? 'default' : 'primary'"
        @click="emit('open-file')"
      >
        {{ state.openLabel }}
      </AppButton>
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
  color: var(--accent-text);
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

.header__switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

.header__modes {
  flex: none;
  width: 190px;
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
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 500;
}

.header__output {
  color: var(--accent-text);
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

@media (max-width: 1240px) {
  .header__meta {
    display: none;
  }
}

@media (max-width: 900px) {
  .header__title {
    display: none;
  }
}
</style>
