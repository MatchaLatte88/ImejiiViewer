<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEditorStore } from './stores/editor.js'
import { ACCEPTED_EXTENSIONS, isSupportedFile } from './lib/imageLoader.js'
import AppHeader from './components/AppHeader.vue'
import CanvasStage from './components/CanvasStage.vue'
import DropZone from './components/DropZone.vue'
import BackgroundPanel from './components/panels/BackgroundPanel.vue'
import AdjustPanel from './components/panels/AdjustPanel.vue'
import EffectsPanel from './components/panels/EffectsPanel.vue'
import TransformPanel from './components/panels/TransformPanel.vue'
import ExportPanel from './components/panels/ExportPanel.vue'
import AppIcon from './components/ui/AppIcon.vue'

const store = useEditorStore()

const fileInput = ref(null)
const isDragging = ref(false)
let dragDepth = 0

const TOOLS = [
  { id: 'background', label: 'Hintergrund', icon: 'eyedropper', component: BackgroundPanel },
  { id: 'adjust', label: 'Farbe', icon: 'palette', component: AdjustPanel },
  { id: 'effects', label: 'Effekte', icon: 'sparkles', component: EffectsPanel },
  { id: 'transform', label: 'Form', icon: 'crop', component: TransformPanel },
]

const activePanel = computed(
  () => TOOLS.find((tool) => tool.id === store.activeTool)?.component ?? BackgroundPanel,
)

const accept = ACCEPTED_EXTENSIONS.join(',')

function openFileDialog() {
  fileInput.value?.click()
}

async function handleFiles(files) {
  const file = Array.from(files || []).find(isSupportedFile)
  if (!file) {
    store.setNotice('error', 'Kein unterstuetztes Bildformat gefunden.')
    return
  }
  try {
    await store.loadFile(file)
  } catch {
    // Fehlermeldung kommt bereits aus dem Store.
  }
}

function onFileInput(event) {
  handleFiles(event.target.files)
  event.target.value = ''
}

// --- Drag & Drop --------------------------------------------------------
function onDragEnter(event) {
  if (!event.dataTransfer?.types?.includes('Files')) return
  dragDepth++
  isDragging.value = true
}

function onDragOver(event) {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragging.value = false
}

function onDrop(event) {
  event.preventDefault()
  dragDepth = 0
  isDragging.value = false
  handleFiles(event.dataTransfer?.files)
}

// --- Zwischenablage -----------------------------------------------------
function onPaste(event) {
  const items = Array.from(event.clipboardData?.items || [])
  const item = items.find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'))
  if (!item) return
  const file = item.getAsFile()
  if (file) handleFiles([file])
}

// --- Tastatur -----------------------------------------------------------
function isTypingTarget(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
}

function onKeyDown(event) {
  const meta = event.ctrlKey || event.metaKey

  if (meta && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) store.redo()
    else store.undo()
    return
  }
  if (meta && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    openFileDialog()
    return
  }
  if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (store.hasImage) store.exportSingle({ format: 'png' })
    return
  }

  if (isTypingTarget(event.target)) return

  if (event.key === 'Escape') {
    store.eyedropperMode = null
    return
  }
  if (event.key.toLowerCase() === 'i' && store.hasImage) {
    store.eyedropperMode = store.eyedropperMode ? null : 'add'
    return
  }
  if (event.code === 'Space' && store.hasImage && !event.repeat) {
    event.preventDefault()
    store.showOriginal = true
  }
}

function onKeyUp(event) {
  if (event.code === 'Space') store.showOriginal = false
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('paste', onPaste)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('paste', onPaste)
})
</script>

<template>
  <div
    class="app"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <AppHeader @open-file="openFileDialog" />

    <main class="app__body">
      <nav v-if="store.hasImage" class="toolbar">
        <button
          v-for="tool in TOOLS"
          :key="tool.id"
          type="button"
          class="toolbar__item"
          :class="{ 'is-active': store.activeTool === tool.id }"
          :title="tool.label"
          @click="store.activeTool = tool.id"
        >
          <AppIcon :name="tool.icon" :size="18" />
          <span>{{ tool.label }}</span>
        </button>
      </nav>

      <section v-if="store.hasImage" class="sidebar">
        <component :is="activePanel" />
      </section>

      <CanvasStage v-if="store.hasImage" />
      <DropZone v-else :is-dragging="isDragging" :is-loading="store.isLoading" @open-file="openFileDialog" />

      <ExportPanel v-if="store.hasImage" />
    </main>

    <Transition name="toast">
      <div v-if="store.notice" class="toast" :class="'toast--' + store.notice.type">
        <AppIcon
          :name="store.notice.type === 'error' ? 'alert' : store.notice.type === 'success' ? 'check' : 'info'"
          :size="15"
        />
        <span>{{ store.notice.message }}</span>
        <button type="button" class="toast__close" @click="store.dismissNotice()">
          <AppIcon name="close" :size="13" />
        </button>
      </div>
    </Transition>

    <div v-if="isDragging && store.hasImage" class="drop-overlay">
      <div class="drop-overlay__box">
        <AppIcon name="upload" :size="26" />
        <p>Neues Bild hier ablegen</p>
      </div>
    </div>

    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      :accept="accept"
      @change="onFileInput"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.app__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 68px;
  flex: none;
  padding: var(--space-2) 6px;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
}

.toolbar__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 9px 2px;
  border: none;
  background: transparent;
  border-radius: var(--radius);
  color: var(--text-subtle);
  font-size: 10px;
  transition:
    background var(--transition),
    color var(--transition);
}

.toolbar__item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.toolbar__item.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}

.sidebar {
  width: var(--panel-width);
  flex: none;
  overflow-y: auto;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: min(520px, calc(100vw - 32px));
  padding: 10px 12px 10px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 40;
}

.toast--error {
  border-color: var(--danger);
  color: var(--danger);
}

.toast--success {
  border-color: var(--success);
  color: var(--success);
}

.toast--info {
  color: var(--text-muted);
}

.toast__close {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: var(--space-2);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-subtle);
}

.toast__close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--transition),
    transform var(--transition);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.drop-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(2px);
  z-index: 50;
  pointer-events: none;
}

.drop-overlay__box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-6);
  border: 2px dashed var(--accent);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  color: var(--accent);
  box-shadow: var(--shadow-lg);
}

.drop-overlay__box p {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

@media (max-width: 1280px) {
  .sidebar,
  :deep(.export) {
    --panel-width: 280px;
  }
}
</style>
