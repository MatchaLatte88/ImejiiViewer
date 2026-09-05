<script setup>
import { defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'
import { usePluginStore } from '../../stores/plugins.js'
import { useStudioStore } from '../../stores/studio.js'
import { useUiStore } from '../../stores/ui.js'
import { plugins } from '../../plugins/registry.js'
import { pluginActivity } from '../../plugins/host.js'
import AppButton from '../ui/AppButton.vue'
const store = usePluginStore(), studio = useStudioStore(), ui = useUiStore()
const { enabled } = storeToRefs(store)
const entries = plugins.map(entry => ({ ...entry, component: defineAsyncComponent(entry.load) }))
async function toggle(id) {
  if (pluginActivity.active || id === 'sdxl-studio' && (studio.busy || studio.drawing || studio.connecting)) return
  try {
    if (id === 'sdxl-studio' && store.studioEnabled) await studio.deactivate()
    store.toggle(id)
    if (id === 'sdxl-studio' && !store.studioEnabled && ui.mode === 'ai-studio') ui.setMode('images')
  } catch (error) { ui.setNotice('error', error.message) }
}
</script>

<template>
  <div class="plugins-panel">
    <header><span class="eyebrow">WORKSPACE EXTENSIONS</span><h2>Plugins</h2><p>Optional tools. Your editor stays independent.</p></header>
    <section v-for="entry in entries" :key="entry.manifest.id" class="plugin-card">
      <div class="plugin-card__heading"><h3>{{ entry.manifest.name }}</h3><span class="version">v{{ entry.manifest.version }}</span></div>
      <p>{{ entry.manifest.description }}</p>
      <AppButton :variant="enabled.includes(entry.manifest.id) ? 'ghost' : 'primary'" :disabled="pluginActivity.active || entry.manifest.workspace && (studio.busy || studio.drawing || studio.connecting)" @click="toggle(entry.manifest.id)">
        {{ enabled.includes(entry.manifest.id) ? 'Disable plugin' : 'Enable plugin' }}
      </AppButton>
      <component :is="entry.component" v-if="enabled.includes(entry.manifest.id)" />
      <p v-else class="note">No model is downloaded when you enable this tool.</p>
    </section>
    <p class="note">Reviewed Imejii plugins only. No third-party scripts are loaded.</p>
  </div>
</template>

<style scoped>
.plugins-panel { padding: 20px 16px; display: grid; gap: 22px; }
.eyebrow { font-size: 9px; letter-spacing: .14em; color: var(--accent-text); }
h2 { font-size: 20px; margin: 7px 0; letter-spacing: -.03em; }
h3 { font-size: 13px; margin: 0; }
p { color: var(--text-muted); font-size: 12px; line-height: 1.6; margin: 8px 0 14px; }
.plugin-card { padding-top: 16px; border-top: 1px solid var(--border); }
.plugin-card__heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.version { font-size: 10px; color: var(--text-subtle); font-family: var(--font-mono); }
.note { font-size: 11px; color: var(--text-subtle); margin-bottom: 0; }
</style>
