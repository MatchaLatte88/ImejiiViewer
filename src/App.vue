<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStudioStore } from './stores/studio.js'
import { plugins } from './plugins/registry.js'
import { pluginActivity } from './plugins/host.js'
import { useUiStore } from './stores/ui.js'
import { useEditorStore } from './stores/editor.js'
import { useLibraryStore } from './stores/library.js'
import { useDraftStore } from './stores/drafts.js'
import { useTheme } from './composables/useTheme.js'
import { ACCEPTED_EXTENSIONS, isSupportedFile } from './lib/imageLoader.js'
import { adoptFiles, getStartupFiles, isDesktop, onFilesOpened, onMenuAction, pickImages } from './lib/desktop.js'
import AppHeader from './components/AppHeader.vue'
import SavedWork from './components/SavedWork.vue'
import LogoMode from './components/LogoMode.vue'
import ImageMode from './components/ImageMode.vue'
import ViewMode from './components/ViewMode.vue'
import AppIcon from './components/ui/AppIcon.vue'

const ui = useUiStore()
const editor = useEditorStore()
const library = useLibraryStore()
const drafts = useDraftStore()
const studio = useStudioStore()
const StudioWorkspace = defineAsyncComponent(plugins.find(entry => entry.manifest.workspace === 'ai-studio').loadWorkspace)
const { toggleTheme } = useTheme()

const fileInput = ref(null)
const isDragging = ref(false)
let dragDepth = 0
let releaseMenu = null
let releaseFiles = null

const accept = ACCEPTED_EXTENSIONS.join(',')
const isImageMode = computed(() => ui.mode === 'images')
/** Betrachter und Bildmodus teilen sich die Bibliothek, der Logo-Modus nicht. */
const usesLibrary = computed(() => ['view', 'images'].includes(ui.mode))
const hasContent = computed(() => ui.mode === 'ai-studio' ? studio.hasDocument : usesLibrary.value ? library.hasItems : editor.hasImage)

/** Im Desktop kommt der Systemdialog, im Browser das versteckte File-Input. */
async function openFileDialog() {
  if (pluginActivity.active) return
  if (!isDesktop) {
    fileInput.value?.click()
    return
  }
  try {
    const result = await pickImages({ multiple: usesLibrary.value })
    if (result) {
      await handleFiles(result.files)
      if (result.error) ui.setNotice('error', 'Some files could not be opened: ' + result.error, 10000)
    }
  } catch (error) {
    ui.setNotice('error', 'Could not open the file: ' + error.message, 7000)
  }
}

/** Dateien landen je nach Modus im Logo-Editor oder in der Bildbibliothek. */
async function handleFiles(files) {
  if (pluginActivity.active) return
  const targetMode = ui.mode
  const adopted = await adoptFiles(Array.from(files || []))
  const supported = adopted.files.filter(isSupportedFile)
  if (!supported.length) {
    ui.setNotice('error', 'No supported image format found.')
    return
  }

  if (targetMode === 'ai-studio') { await studio.openFile(supported[0]); return }
  if (['view', 'images'].includes(targetMode)) {
    const ids = await library.addFiles(supported)
    if (adopted.error) ui.setNotice('error', adopted.error, 10000)
    return ids
  }

  try {
    await editor.loadFile(supported[0])
    if (adopted.error) ui.setNotice('error', adopted.error, 10000)
  } catch {
    // The error message already comes from the store.
  }
}

function onFileInput(event) {
  void handleFiles(event.target.files).catch(reportError)
  event.target.value = ''
}

// --- Drag & Drop --------------------------------------------------------
function onDragEnter(event) {
  if (pluginActivity.active) return
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
  if (pluginActivity.active) return
  dragDepth = 0
  isDragging.value = false
  void handleFiles(event.dataTransfer?.files).catch(reportError)
}

function onPaste(event) {
  if (pluginActivity.active) return
  const files = Array.from(event.clipboardData?.items || [])
    .filter((entry) => entry.kind === 'file' && entry.type.startsWith('image/'))
    .map((entry) => entry.getAsFile())
    .filter(Boolean)
  if (files.length) { event.preventDefault(); void handleFiles(files).catch(reportError) }
}

function onKeyDown(event) {
  if (pluginActivity.active) return
  // Im Desktop bedient das Anwendungsmenue diese Kuerzel.
  if (isDesktop) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveCurrent().catch(reportError)
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    openFileDialog()
  }
}

// --- Moduswechsel -------------------------------------------------------
// Welches Bild zuletzt in den Logo-Editor gewandert ist. So geht eine begonnene
// Logo-Bearbeitung beim Hin- und Herwechseln nicht verloren.
let modeVersion = 0

/**
 * Der Logo-Editor arbeitet an einem einzelnen Bild und hat keine Bibliothek -
 * wer aus dem Betrachter kommt, nimmt das sichtbare Bild also mit.
 */
async function setMode(next) {
  if (pluginActivity.active) return
  const version = ++modeVersion
  const item = usesLibrary.value ? library.activeItem : null
  if (next === 'logo' && item && editor.sourceFile !== item.file) {
    try {
      const loaded = await editor.loadFile(item.file)
      if (!loaded || version !== modeVersion) return
    } catch { return }
  }
  if (version === modeVersion) ui.setMode(next)
}

function reportError(error) { ui.setNotice('error', error.message || String(error), 8000) }
function onBeforeUnload(event) {
  if (!pluginActivity.active && !studio.dirty && !studio.busy && !drafts.hasUnsavedWork && !drafts.projectBusy && !drafts.restoring && !library.isImporting && !library.isDecoding && !library.exportBusy && !library.batchProgress && !editor.isLoading && !editor.exportBusy) return
  event.preventDefault()
  event.returnValue = ''
}

// --- Menuebefehle aus dem Hauptprozess ----------------------------------
async function saveCurrent() {
  if (ui.mode === 'ai-studio') { await studio.exportResult(); return }
  if (usesLibrary.value) {
    if (library.activeItem) await library.saveActiveAs('png', 92)
  } else if (editor.hasImage) {
    await editor.exportSingle({ format: 'png' })
  }
}

async function handleMenuAction(action) {
  if (pluginActivity.active) { window.dispatchEvent(new CustomEvent('imejii:plugin-command', { detail: action })); return }
  const target = document.activeElement
  if (['undo', 'redo'].includes(action) && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable)) {
    document.execCommand(action)
    return
  }
  try {
  switch (action) {
    case 'open':
      await openFileDialog()
      break
    case 'save':
      await saveCurrent()
      break
    case 'undo':
      ui.mode === 'ai-studio' ? studio.undo() : usesLibrary.value ? library.undo() : editor.undo()
      break
    case 'redo':
      ui.mode === 'ai-studio' ? studio.redo() : usesLibrary.value ? library.redo() : editor.redo()
      break
    case 'theme':
      toggleTheme()
      break
    case 'mode:view':
      await setMode('view')
      break
    case 'mode:logo':
      await setMode('logo')
      break
    case 'mode:images':
      await setMode('images')
      break
    case 'mode:ai-studio':
      await setMode('ai-studio')
      break
    default:
      break
  }
  } catch (error) { reportError(error) }
}

// --- Dateien von aussen -------------------------------------------------
/**
 * Bilder, mit denen die App geoeffnet wurde ("Oeffnen mit", Doppelklick) oder
 * die spaeter hereingereicht werden. Aus dem Logo-Modus wechselt die App dafuer
 * in den Betrachter - dort ist Platz fuer beliebig viele Bilder.
 */
const deferredExternalFiles = []
watch(() => pluginActivity.active, async active => {
  if (active) return
  while (deferredExternalFiles.length && !pluginActivity.active) await receiveExternalFiles(deferredExternalFiles.shift()).catch(reportError)
})
async function receiveExternalFiles({ files, error }) {
  if (pluginActivity.active) { deferredExternalFiles.push({ files, error }); return }
  if (!files.length) { if (error) reportError(new Error(error)); return }
  if (!['view', 'images'].includes(ui.mode)) ui.setMode('view')

  // Wer eine Datei im Explorer oeffnet, will genau sie sehen - nicht das Bild,
  // das gerade offen war.
  const addedIds = await handleFiles(files)
  if (addedIds?.length) await library.select(addedIds[0])
  if (error) ui.setNotice('error', 'Some files could not be opened: ' + error, 10000)
}

onMounted(() => {
  window.addEventListener('paste', onPaste)
  window.addEventListener('keydown', onKeyDown)
  releaseMenu = onMenuAction(handleMenuAction)
  releaseFiles = onFilesOpened(payload => receiveExternalFiles(payload).catch(reportError))
  getStartupFiles().then(receiveExternalFiles).catch(reportError)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  releaseMenu?.()
  releaseFiles?.()
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
    <AppHeader @open-file="openFileDialog" @set-mode="setMode" />
    <SavedWork />

    <main class="app__body">
      <ViewMode v-if="ui.mode === 'view'" :is-dragging="isDragging" @open-files="openFileDialog" />
      <ImageMode v-else-if="isImageMode" :is-dragging="isDragging" @open-files="openFileDialog" />
      <LogoMode v-else-if="ui.mode === 'logo'" :is-dragging="isDragging" @open-file="openFileDialog" />
      <StudioWorkspace v-else-if="ui.mode === 'ai-studio'" @open-file="openFileDialog" />
    </main>

    <Transition name="toast">
      <div v-if="ui.notice" class="toast" role="status" aria-live="polite" aria-atomic="true" :class="'toast--' + ui.notice.type">
        <AppIcon
          :name="ui.notice.type === 'error' ? 'alert' : ui.notice.type === 'success' ? 'check' : 'info'"
          :size="15"
        />
        <span>{{ ui.notice.message }}</span>
        <button type="button" class="toast__close" aria-label="Dismiss notification" @click="ui.dismissNotice()">
          <AppIcon name="close" :size="13" />
        </button>
      </div>
    </Transition>

    <div v-if="isDragging && hasContent" class="drop-overlay">
      <div class="drop-overlay__box">
        <AppIcon name="upload" :size="26" />
        <p>{{ usesLibrary ? 'Drop images to add them' : 'Drop a new image here' }}</p>
      </div>
    </div>

    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      aria-label="Open images"
      :accept="accept"
      :multiple="usesLibrary"
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
  transition: opacity var(--transition), transform var(--transition);
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
  padding: var(--space-6);
  border: 2px dashed var(--accent);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  color: var(--accent-text);
  box-shadow: var(--shadow-lg);
}

.drop-overlay__box p {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

@media (max-width: 1280px) {
  .app {
    --panel-width: 280px;
  }
}
</style>
