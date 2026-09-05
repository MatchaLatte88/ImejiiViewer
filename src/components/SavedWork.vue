<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useDraftStore } from '../stores/drafts.js'
import { useStudioStore } from '../stores/studio.js'
const store = useDraftStore()
const studio = useStudioStore()
const expanded = ref(false)
const projectInput = ref(null)
onMounted(() => { void store.start() })
onBeforeUnmount(() => store.dispose())
</script>

<template>
  <section class="saved-work" aria-label="Saved work">
    <div class="saved-work__bar">
      <button type="button" :aria-expanded="expanded" @click="expanded = !expanded">Saved work <span>{{ store.entries.length }}</span></button>
      <span role="status" aria-live="polite" :class="{ warning: store.status === 'error' }">
        {{ store.status === 'saving' ? 'Saving original + edits…' : store.status === 'pending' ? 'Unsaved changes…' : store.status === 'error' ? 'Local save failed' : 'Edits are saved locally' }}
      </span>
      <span v-if="studio.dirty" role="status" :class="{ warning: studio.saveState === 'error' }">Studio: {{ studio.saveState === 'error' ? 'save failed' : 'saving changes…' }}</span>
      <button v-if="studio.saveState === 'error'" type="button" @click="studio.flush().catch(() => {})">Retry Studio save</button>
      <button v-if="store.status === 'error' || store.status === 'pending'" type="button" @click="store.flush()">Save now</button>
      <button type="button" :disabled="store.restoring || store.projectBusy" @click="projectInput.click()">Open project</button>
      <button type="button" :disabled="!store.canExport || store.restoring || store.projectBusy" @click="store.exportCurrent()">{{ store.projectBusy ? 'Saving project…' : 'Save project…' }}</button>
      <input ref="projectInput" class="sr-only" type="file" accept=".imejii" aria-label="Open Imejii project" @change="store.importProject($event.target.files[0]); $event.target.value = ''">
    </div>
    <div v-if="expanded || store.error" class="saved-work__content">
      <p v-if="store.error" class="warning">{{ store.error }} Keep the app open. Use “Save project…” to back up current edits or export the rendered result.</p>
      <template v-if="expanded">
        <p>Originals, edit settings and undo history stay on this device. Save an .imejii project as a portable backup: clearing app/browser data removes the automatic copies. Projects include the original file, including its private metadata.</p>
        <p v-if="!store.entries.length">Your first edit will appear here automatically.</p>
        <ul v-else>
          <li v-for="entry in store.entries" :key="entry.id">
            <div><strong>{{ entry.name }}</strong><small>{{ entry.kind === 'studio' ? 'AI Studio' : entry.kind === 'logo' ? 'Logo' : 'Photo' }} · {{ new Date(entry.updated).toLocaleString() }}</small></div>
            <button type="button" :disabled="store.restoring" @click="store.restore(entry.id)">Restore</button>
            <button type="button" :disabled="store.restoring" @click="store.exportProject(entry.id)">Project…</button>
            <button type="button" :disabled="store.restoring" :aria-label="'Delete saved copy of ' + entry.name" @click="store.remove(entry.id)">Delete copy</button>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.saved-work { background: var(--bg-panel); border-bottom: 1px solid var(--border); font-size: 11px; }
.saved-work__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 6px 20px; color: var(--text-subtle); }
button { background: none; color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 8px; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
span span, small { color: var(--text-subtle); }
.saved-work__content { padding: 4px 20px 12px; max-height: 230px; overflow: auto; }
ul { list-style: none; margin: 8px 0 0; padding: 0; }
li { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--border); }
li div { flex: 1; min-width: 0; } strong, small { display: block; overflow-wrap: anywhere; }
.warning { color: var(--danger); }
</style>
