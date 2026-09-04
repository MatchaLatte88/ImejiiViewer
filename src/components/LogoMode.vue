<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { useUiStore } from '../stores/ui.js'
import { isDesktop } from '../lib/desktop.js'
import CanvasStage from './CanvasStage.vue'
import DropZone from './DropZone.vue'
import BackgroundPanel from './panels/BackgroundPanel.vue'
import AdjustPanel from './panels/AdjustPanel.vue'
import EffectsPanel from './panels/EffectsPanel.vue'
import TransformPanel from './panels/TransformPanel.vue'
import ExportPanel from './panels/ExportPanel.vue'
import AppIcon from './ui/AppIcon.vue'

const props = defineProps({
  isDragging: { type: Boolean, default: false },
})

const emit = defineEmits(['open-file'])

const store = useEditorStore()
const ui = useUiStore()

const TOOLS = [
  { id: 'background', label: 'Background', icon: 'eyedropper', component: BackgroundPanel },
  { id: 'adjust', label: 'Color', icon: 'palette', component: AdjustPanel },
  { id: 'effects', label: 'Effects', icon: 'sparkles', component: EffectsPanel },
  { id: 'transform', label: 'Shape', icon: 'crop', component: TransformPanel },
]

const activePanel = computed(
  () => TOOLS.find((tool) => tool.id === store.activeTool)?.component ?? BackgroundPanel,
)

/** Ein erneuter Klick auf das aktive Werkzeug klappt sein Panel weg. */
function selectTool(id) {
  if (store.activeTool === id) ui.togglePanel('tools')
  else {
    store.activeTool = id
    ui.panels.tools = true
  }
}

function isTypingTarget(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
}

function onKeyDown(event) {
  // Auf dem Desktop laufen Strg-Kuerzel ueber das Anwendungsmenue.
  const meta = event.ctrlKey || event.metaKey
  if (isTypingTarget(event.target)) return

  if (!isDesktop && meta && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) store.redo()
    else store.undo()
    return
  }

  if (meta || event.altKey || store.isLoading) return

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

const onBlur = () => { store.showOriginal = false }
onMounted(() => {
  window.addEventListener('blur', onBlur)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  onBlur()
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<template>
  <div class="logo-mode">
    <nav v-if="store.hasImage" class="toolbar">
      <button
        v-for="tool in TOOLS"
        :key="tool.id"
        type="button"
        class="toolbar__item"
        :class="{ 'is-active': ui.panels.tools && store.activeTool === tool.id }"
        :title="tool.label"
        @click="selectTool(tool.id)"
      >
        <AppIcon :name="tool.icon" :size="18" />
        <span>{{ tool.label }}</span>
      </button>

      <button
        type="button"
        class="toolbar__item toolbar__collapse"
        :class="{ 'is-open': ui.panels.tools }"
        :title="ui.panels.tools ? 'Hide the tool panel' : 'Show the tool panel'"
        :aria-expanded="ui.panels.tools"
        @click="ui.togglePanel('tools')"
      >
        <AppIcon name="chevron" :size="18" />
        <span>{{ ui.panels.tools ? 'Hide' : 'Show' }}</span>
      </button>
    </nav>

    <section v-if="store.hasImage" v-show="ui.panels.tools" class="sidebar" :inert="store.isLoading">
      <component :is="activePanel" />
    </section>

    <CanvasStage v-if="store.hasImage" />
    <DropZone
      v-else
      :is-dragging="props.isDragging"
      :is-loading="store.isLoading"
      @open-file="emit('open-file')"
    />

    <button
      v-if="store.hasImage"
      type="button"
      class="panel-toggle"
      :class="{ 'is-open': ui.panels.export }"
      :title="ui.panels.export ? 'Hide the export panel' : 'Show the export panel'"
      :aria-expanded="ui.panels.export"
      @click="ui.togglePanel('export')"
    >
      <AppIcon name="chevron" :size="14" />
    </button>

    <ExportPanel v-if="store.hasImage" v-show="ui.panels.export" />
  </div>
</template>

<style scoped>
.logo-mode {
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

/* Ein- und Ausklappen: der Pfeil zeigt, wohin das Panel verschwindet. */
.toolbar__collapse {
  margin-top: auto;
}

.toolbar__collapse.is-open svg {
  transform: rotate(180deg);
}

.panel-toggle {
  display: grid;
  place-items: center;
  width: 18px;
  flex: none;
  border: none;
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-subtle);
  transition: background var(--transition), color var(--transition);
}

.panel-toggle:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.panel-toggle:not(.is-open) svg {
  transform: rotate(180deg);
}

.sidebar {
  width: var(--panel-width);
  flex: none;
  overflow-y: auto;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}
</style>
