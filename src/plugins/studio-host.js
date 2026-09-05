// Workspace transfers belong to the host. Provider code never changes an editor.
import { useStudioStore } from '../stores/studio.js'
import { usePluginStore } from '../stores/plugins.js'
import { useLibraryStore } from '../stores/library.js'
import { useEditorStore } from '../stores/editor.js'
import { useUiStore } from '../stores/ui.js'
import { pluginActivity } from './host.js'

export async function openCurrentInStudio(mode) {
  if (!usePluginStore().studioEnabled) throw new Error('Enable AI Studio in Plugins first.')
  if (pluginActivity.active) throw new Error('Finish the current plugin dialog first.')
  const studio = useStudioStore(), library = useLibraryStore(), editor = useEditorStore()
  if (mode === 'logo') {
    if (!editor.hasImage || editor.isLoading || editor.exportBusy) throw new Error('Wait for the current logo operation.')
    await studio.newSource(editor.renderFullResolution(), editor.source.name, null, { kind: 'logo-working-copy', workingLimit: 4096 })
  } else if (['view', 'images'].includes(mode)) {
    if (!library.activeItem || library.isDecoding || library.isImporting || library.exportBusy || library.batchProgress) throw new Error('Wait for the current image operation.')
    library.slideshow.active = false
    const snapshot = await library.capturePluginPhoto(new AbortController().signal)
    await studio.newSource(snapshot.canvas, snapshot.name, null, { kind: 'photo-working-copy', sourceDraftId: snapshot.draftId, edits: snapshot.edits })
  } else return
  useUiStore().setMode('ai-studio')
}
