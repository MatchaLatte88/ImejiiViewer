import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLibraryStore } from './library.js'
import { useEditorStore } from './editor.js'
import { useUiStore } from './ui.js'
import { useStudioStore } from './studio.js'
import { usePluginStore } from './plugins.js'
import { resolveImageFile, confirmDiscard, saveBlob } from '../lib/desktop.js'
import { deleteDraft, listDrafts, loadDraft, saveDraft, projectBlob, readProject, studioProjectBlob } from '../lib/drafts.js'
import { slugify } from '../lib/exportImage.js'

export const useDraftStore = defineStore('drafts', () => {
  const entries = ref([]), status = ref('idle'), error = ref(''), restoring = ref(false)
  const projectBusy = ref(false)
  const studio = useStudioStore(), plugins = usePluginStore()
  const canExport = computed(() => ui.mode === 'ai-studio' ? studio.hasDocument : ui.mode === 'logo' ? editor.hasImage : library.hasItems)
  const library = useLibraryStore(), editor = useEditorStore(), ui = useUiStore()
  const saved = new WeakMap(), originals = new WeakMap()
  let stop, timer, version = 0, running = null
  async function refresh() { entries.value = await listDrafts() }
  async function fileFor(descriptor) {
    if (!originals.has(descriptor)) originals.set(descriptor, resolveImageFile(descriptor).catch(problem => { originals.delete(descriptor); throw problem }))
    return originals.get(descriptor)
  }
  function snapshot() {
    return [
      ...library.items.filter(item => library.hasSavedEdits(item)).map(item => ({ key: item, id: item.draftId || 'photo:' + item.id, file: item.file, kind: 'photo', state: library.draftState(item.id) })),
      ...(editor.source && (editor.isDirty || editor.canUndo || editor.canRedo) ? [{ key: editor.source, id: editor.source.draftId, file: editor.sourceFile, kind: 'logo', state: editor.draftState() }] : []),
    ]
  }
  function changed() {
    if (restoring.value) return
    version++
    clearTimeout(timer)
    status.value = 'pending'
    timer = setTimeout(() => { void flush() }, 650)
  }
  function flush() {
    clearTimeout(timer)
    if (running) return running
    if (restoring.value) return Promise.resolve()
    running = persist().finally(() => { running = null })
    return running
  }
  async function persist() {
    try {
      while (true) {
        const started = version, work = snapshot()
        status.value = 'saving'
        for (const entry of work) {
          const serialized = JSON.stringify(entry.state)
          if (saved.get(entry.key) === serialized) continue
          await saveDraft(await fileFor(entry.file), entry.kind, entry.state, entry.id)
          entry.key.draftId = entry.id
          saved.set(entry.key, serialized)
        }
        if (started === version) break
      }
      error.value = ''; status.value = 'saved'; await refresh()
    } catch (problem) {
      error.value = problem.message; status.value = 'error'
    }
  }
  async function restore(id) {
    if (restoring.value || projectBusy.value) return
    await flush()
    restoring.value = true
    try {
      const entry = await loadDraft(id)
      if (entry.kind === 'studio') { await restoreStudio(entry) }
      else if (entry.kind === 'photo') { if (await library.restoreDraft(entry)) ui.setMode('images') }
      else if (await editor.restoreDraft(entry)) ui.setMode('logo')
      changedAfterRestore()
    } catch (problem) { error.value = problem.message; status.value = 'error' }
    finally { restoring.value = false }
  }
  async function restoreStudio(entry) {
    if (!plugins.studioEnabled) {
      const result = entry.state.results.at(-1)
      if (!result) throw new Error('Enable AI Studio in Images → Plugins to continue this saved SDXL session.')
      const file = new File([entry.artifacts.get(result.artifact)], entry.name + '-' + result.provenance.operation + '.png', { type: 'image/png' })
      const state = { edits: library.freshPhotoEdits(), extensions: { 'sdxl-studio': result.provenance } }
      if (await library.restoreDraft({ id: 'photo:' + result.id, file, state })) ui.setMode('images')
      ui.setNotice('info', 'Saved variant opened. Enable AI Studio to continue the complete session.')
      return
    }
    await studio.restore(entry); ui.setMode('ai-studio')
  }
  function changedAfterRestore() { status.value = 'pending'; setTimeout(changed, 0) }
  async function exportProject(id) {
    if (projectBusy.value || restoring.value) return
    projectBusy.value = true
    try {
      await flush()
      const entry = await loadDraft(id)
      await saveBlob(entry.kind === 'studio' ? await studioProjectBlob(entry.state, entry.artifacts) : await projectBlob(entry.file, entry.kind, entry.state), slugify(entry.name) + '.imejii')
    } catch (problem) { ui.setNotice('error', 'Project export failed: ' + problem.message, 8000) }
    finally { projectBusy.value = false }
  }
  async function exportCurrent() {
    if (projectBusy.value || restoring.value) return
    if (ui.mode === 'ai-studio') {
      projectBusy.value = true
      try { await studio.exportProject() } catch (problem) { ui.setNotice('error', problem.message, 8000) }
      finally { projectBusy.value = false }
      return
    }
    const entry = ui.mode === 'logo' ? (editor.source ? { file: editor.sourceFile, kind: 'logo', state: editor.draftState() } : null)
      : (library.activeItem ? { file: library.activeItem.file, kind: 'photo', state: library.draftState(library.activeId) } : null)
    if (!entry) return
    projectBusy.value = true
    try {
      const file = await fileFor(entry.file)
      await saveBlob(await projectBlob(file, entry.kind, entry.state), slugify(file.name) + '.imejii')
    } catch (problem) { ui.setNotice('error', 'Project export failed: ' + problem.message, 8000) }
    finally { projectBusy.value = false }
  }
  async function importProject(file) {
    if (!file || restoring.value || projectBusy.value) return
    await flush(); restoring.value = true
    try {
      const entry = await readProject(file)
      if (entry.kind === 'studio') { await restoreStudio(entry) }
      else if (entry.kind === 'photo') { if (await library.restoreDraft(entry)) ui.setMode('images') }
      else if (await editor.restoreDraft(entry)) ui.setMode('logo')
      changedAfterRestore()
    } catch (problem) { ui.setNotice('error', 'Project could not be opened: ' + problem.message, 8000) }
    finally { restoring.value = false }
  }
  // Compare the actual recipes too: beforeunload may run before Vue's watcher.
  const hasUnsavedWork = computed(() => ['pending', 'saving', 'error'].includes(status.value) || snapshot().some(entry => saved.get(entry.key) !== JSON.stringify(entry.state)))
  async function remove(id) {
    if (restoring.value || projectBusy.value) return
    if (id === 'studio:' + studio.document?.id) { ui.setNotice('info', 'Open a different Studio session before deleting this saved copy.'); return }
    if (!await confirmDiscard('Delete this saved copy and its edit history? Your original image on disk is not changed. Open edits may be saved again.')) return
    try { await deleteDraft(id); await refresh() }
    catch (problem) { error.value = problem.message; status.value = 'error' }
  }
  async function start() {
    if (stop) return
    try { await refresh() } catch (problem) { error.value = problem.message; status.value = 'error' }
    stop = watch(() => JSON.stringify(snapshot().map(entry => ({ id: entry.id, state: entry.state }))), changed)
    window.addEventListener('imejii:saved-work', refreshSavedWork)
    if (snapshot().length) changed()
  }
  function refreshSavedWork() { void refresh().catch(problem => { error.value = problem.message }) }
  function dispose() { stop?.(); stop = null; clearTimeout(timer); window.removeEventListener('imejii:saved-work', refreshSavedWork) }
  return { entries, status, error, restoring, projectBusy, canExport, hasUnsavedWork, start, dispose, flush, restore, remove, exportProject, exportCurrent, importProject }
})
