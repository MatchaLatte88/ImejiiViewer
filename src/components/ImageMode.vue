<script setup>
import { computed, ref } from 'vue'
import { useLibraryStore } from '../stores/library.js'
import { usePhotoShortcuts } from '../composables/usePhotoShortcuts.js'
import { ACCEPTED_EXTENSIONS } from '../lib/imageLoader.js'
import PhotoViewer from './PhotoViewer.vue'
import LibraryStrip from './LibraryStrip.vue'
import PhotoAdjustPanel from './panels/PhotoAdjustPanel.vue'
import PhotoTransformPanel from './panels/PhotoTransformPanel.vue'
import PhotoInfoPanel from './panels/PhotoInfoPanel.vue'
import PhotoExportPanel from './panels/PhotoExportPanel.vue'
import AppIcon from './ui/AppIcon.vue'
import AppButton from './ui/AppButton.vue'

const props = defineProps({
  isDragging: { type: Boolean, default: false },
})

const emit = defineEmits(['open-files'])

const store = useLibraryStore()
const viewerRef = ref(null)
const activeTool = ref('adjust')

const TOOLS = [
  { id: 'adjust', label: 'Adjust', icon: 'sliders', component: PhotoAdjustPanel },
  { id: 'transform', label: 'Transform', icon: 'crop', component: PhotoTransformPanel },
  { id: 'info', label: 'Info', icon: 'info', component: PhotoInfoPanel },
]

const activePanel = computed(
  () => TOOLS.find((tool) => tool.id === activeTool.value)?.component ?? PhotoAdjustPanel,
)

usePhotoShortcuts(viewerRef, { editing: true })
</script>

<template>
  <div class="image-mode">
    <template v-if="store.hasItems">
      <nav class="toolbar">
        <button
          v-for="tool in TOOLS"
          :key="tool.id"
          type="button"
          class="toolbar__item"
          :class="{ 'is-active': activeTool === tool.id }"
          :title="tool.label"
          @click="activeTool = tool.id"
        >
          <AppIcon :name="tool.icon" :size="18" />
          <span>{{ tool.label }}</span>
        </button>
      </nav>

      <section class="sidebar">
        <component :is="activePanel" />
      </section>

      <div class="center">
        <PhotoViewer ref="viewerRef" editing />
        <LibraryStrip @add-files="emit('open-files')" />
      </div>

      <PhotoExportPanel />
    </template>

    <div v-else class="empty" :class="{ 'is-dragging': props.isDragging }">
      <div class="empty__card">
        <div class="empty__icon"><AppIcon name="layers" :size="28" /></div>
        <h2>Drop images here</h2>
        <p class="empty__lead">
          View, edit and convert any number of images - crop, straighten, resize, adjust colors and
          export the whole set in one go. Everything stays on your machine.
        </p>

        <div class="empty__actions">
          <AppButton icon="folder" variant="primary" :disabled="store.isImporting" @click="emit('open-files')">
            {{ store.isImporting ? 'Reading files ...' : 'Choose images' }}
          </AppButton>
          <span class="empty__or">multi-select is supported</span>
        </div>

        <ul class="empty__formats">
          <li v-for="ext in ACCEPTED_EXTENSIONS" :key="ext" class="mono">{{ ext }}</li>
        </ul>

        <dl class="empty__keys">
          <div><dt>&larr; &rarr;</dt><dd>Browse images</dd></div>
          <div><dt>C</dt><dd>Crop</dd></div>
          <div><dt>R</dt><dd>Rotate</dd></div>
          <div><dt>F</dt><dd>Fullscreen</dd></div>
          <div><dt>S</dt><dd>Slideshow</dd></div>
          <div><dt>Space</dt><dd>Compare with original</dd></div>
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-mode {
  display: flex;
  flex: 1;
  min-width: 0;
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
  transition: background var(--transition), color var(--transition);
}

.toolbar__item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.toolbar__item.is-active {
  background: var(--accent-soft);
  color: var(--accent-text);
}

.sidebar {
  width: var(--panel-width);
  flex: none;
  overflow-y: auto;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}

.center {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

/* --- Startzustand --- */
.empty {
  flex: 1;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background: var(--canvas-bg);
  background-image: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0);
  background-size: 24px 24px;
}

.empty__card {
  width: min(560px, 100%);
  padding: var(--space-6);
  text-align: center;
  background: var(--bg-elevated);
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow);
  transition: border-color var(--transition), background var(--transition);
}

.empty.is-dragging .empty__card {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.empty__icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  margin: 0 auto var(--space-4);
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.empty__card h2 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.empty__lead {
  max-width: 400px;
  margin: var(--space-2) auto 0;
  color: var(--text-muted);
  line-height: 1.55;
}

.empty__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin: var(--space-5) 0 var(--space-4);
  flex-wrap: wrap;
}

.empty__or {
  font-size: 12px;
  color: var(--text-subtle);
}

.empty__formats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  padding: 0;
  margin: 0 0 var(--space-5);
  list-style: none;
}

.empty__formats li {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-subtle);
}

.empty__keys {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px var(--space-4);
  margin: 0;
  padding-top: var(--space-5);
  border-top: 1px solid var(--border);
  text-align: left;
}

.empty__keys > div {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.empty__keys dt {
  min-width: 46px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
}

.empty__keys dd {
  margin: 0;
  font-size: 11px;
  color: var(--text-subtle);
}
</style>
