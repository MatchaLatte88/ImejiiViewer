<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useLibraryStore } from '../stores/library.js'
import { hasEdits } from '../lib/photoPipeline.js'
import { formatBytes } from '../lib/download.js'
import AppIcon from './ui/AppIcon.vue'
import AppButton from './ui/AppButton.vue'

const store = useLibraryStore()
const emit = defineEmits(['add-files'])

const listEl = ref(null)

const SORT_OPTIONS = [
  { value: 'added', label: 'Added' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
  { value: 'date', label: 'Date' },
]

const summary = computed(
  () => store.items.length + ' images / ' + formatBytes(store.totalBytes),
)

// Das aktive Vorschaubild immer in den sichtbaren Bereich holen.
watch(
  () => store.activeId,
  async () => {
    await nextTick()
    listEl.value
      ?.querySelector('.thumb.is-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  },
)
</script>

<template>
  <footer class="strip">
    <div class="strip__head">
      <span class="strip__count">{{ summary }}</span>
      <span v-if="store.editedCount" class="strip__edited">{{ store.editedCount }} edited</span>
      <select
        class="strip__sort"
        :value="store.sortMode"
        aria-label="Sort images"
        @change="store.sortBy($event.target.value)"
      >
        <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
          Sort: {{ option.label }}
        </option>
      </select>
      <AppButton icon="plus" size="sm" title="Add images" @click="emit('add-files')" />
      <AppButton
        icon="trash"
        size="sm"
        variant="danger"
        title="Remove all images"
        :disabled="!store.items.length"
        @click="store.clearAll()"
      />
    </div>

    <ul ref="listEl" class="strip__list">
      <li
        v-for="item in store.items"
        :key="item.id"
        class="thumb"
        :class="{ 'is-active': item.id === store.activeId }"
        :title="item.name + ' - ' + item.width + ' x ' + item.height"
        @click="store.select(item.id)"
      >
        <span class="thumb__frame checkerboard">
          <img :src="item.thumbnail" :alt="item.name" loading="lazy" />
        </span>
        <span class="thumb__name">{{ item.name }}</span>
        <span v-if="hasEdits(item.edits)" class="thumb__badge" title="Edited">
          <AppIcon name="check" :size="10" />
        </span>
        <button
          type="button"
          class="thumb__remove"
          title="Remove from list"
          @click.stop="store.remove(item.id)"
        >
          <AppIcon name="close" :size="11" />
        </button>
      </li>
    </ul>
  </footer>
</template>

<style scoped>
.strip {
  flex: none;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
}

.strip__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-3);
  border-bottom: 1px solid var(--border);
}

.strip__count {
  font-size: 11px;
  color: var(--text-subtle);
}

.strip__edited {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 10px;
  font-weight: 600;
}

.strip__sort {
  margin-left: auto;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-size: 11px;
  color: var(--text-muted);
}

.strip__list {
  display: flex;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  list-style: none;
  overflow-x: auto;
  overflow-y: hidden;
}

.thumb {
  position: relative;
  flex: none;
  width: 88px;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}

.thumb:hover {
  background: var(--bg-hover);
}

.thumb.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.thumb__frame {
  display: grid;
  place-items: center;
  width: 100%;
  height: 60px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.thumb__frame img {
  max-width: 100%;
  max-height: 100%;
  display: block;
}

.thumb__name {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-subtle);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumb.is-active .thumb__name {
  color: var(--text);
}

.thumb__badge {
  position: absolute;
  top: 7px;
  left: 7px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-contrast);
}

.thumb__remove {
  position: absolute;
  top: 5px;
  right: 5px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text-muted);
  opacity: 0;
  box-shadow: var(--shadow-sm);
  transition: opacity var(--transition), color var(--transition);
}

.thumb:hover .thumb__remove {
  opacity: 1;
}

.thumb__remove:hover {
  color: var(--danger);
}
</style>
