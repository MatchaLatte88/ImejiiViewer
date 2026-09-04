<script setup>
import { computed, ref, watch } from 'vue'
import { normalizeLocalMasks } from '../../lib/localLight.js'
import SliderControl from './SliderControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { useLibraryStore } from '../../stores/library.js'
const props = defineProps({ disabled: Boolean })
const store = useLibraryStore()
const item = computed(() => store.activeItem)
const selected = ref(0)
const masks = computed(() => item.value?.edits.localMasks || [])
const active = computed(() => masks.value[selected.value])
const ratio = computed(() => (item.value?.width || 1) / (item.value?.height || 1))
watch(() => item.value?.id, () => { selected.value = 0 })
watch(() => masks.value.length, length => { selected.value = Math.max(0, Math.min(selected.value, length - 1)) })
function add(type) {
  if (props.disabled || masks.value.length >= 8) return
  item.value.edits.localMasks.push(normalizeLocalMasks([{ type }])[0])
  selected.value = masks.value.length - 1
}
function place(event) {
  if (!active.value || props.disabled) return
  const rect = event.currentTarget.getBoundingClientRect()
  active.value.x = Math.round((event.clientX - rect.left) / rect.width * 100)
  active.value.y = Math.round((event.clientY - rect.top) / rect.height * 100)
}
</script>
<template>
  <section class="panel-section">
    <div class="section-title"><span>Local light</span><span>{{ masks.length }}/8</span></div>
    <div class="stack">
      <div class="buttons"><button :disabled="disabled || masks.length >= 8" @click="add('radial')">+ Radial</button><button :disabled="disabled || masks.length >= 8" @click="add('linear')">+ Gradient</button></div>
      <p class="hint">Lighten a subject or darken a sky. Positions stay attached to the original when you crop or rotate.</p>
      <div v-if="masks.length" class="buttons" role="group" aria-label="Local masks">
        <button v-for="(mask, index) in masks" :key="index" :aria-pressed="selected === index" @click="selected = index">{{ index + 1 }} · {{ mask.type }}</button>
      </div>
      <template v-if="active">
        <div class="map" :style="{ aspectRatio: ratio }" @click="place">
          <img :src="item.thumbnail" alt="Original image — click to position the mask" draggable="false">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <ellipse v-if="active.type === 'radial'" :cx="active.x" :cy="active.y" :rx="active.radius / ratio" :ry="active.radius" />
            <line v-else :x1="active.x" :y1="active.y" :x2="active.x + Math.cos(active.angle * Math.PI / 180) * active.radius / ratio" :y2="active.y + Math.sin(active.angle * Math.PI / 180) * active.radius" />
            <circle :cx="active.x" :cy="active.y" r="1.5" />
          </svg>
        </div>
        <ToggleSwitch v-model="active.enabled" label="Enable mask" :disabled="disabled" />
        <SliderControl v-model="active.exposure" label="Local exposure" unit="EV" :min="-2" :max="2" :step="0.1" :disabled="disabled" />
        <SliderControl v-model="active.x" label="Center X" unit="%" :disabled="disabled" />
        <SliderControl v-model="active.y" label="Center Y" unit="%" :disabled="disabled" />
        <SliderControl v-model="active.radius" :label="active.type === 'radial' ? 'Radius' : 'Transition width'" :min="1" :max="150" unit="%" :reset-value="35" :disabled="disabled" />
        <SliderControl v-if="active.type === 'radial'" v-model="active.feather" label="Feather" :min="1" :max="100" unit="%" :reset-value="70" :disabled="disabled" />
        <SliderControl v-else v-model="active.angle" label="Angle" :min="-180" :max="180" unit="°" :reset-value="90" :disabled="disabled" />
        <ToggleSwitch v-model="active.invert" label="Invert mask" :disabled="disabled" />
        <button :disabled="disabled" @click="item.edits.localMasks.splice(selected, 1)">Remove mask</button>
      </template>
    </div>
  </section>
</template>
<style scoped>
.buttons { display: flex; gap: 6px; flex-wrap: wrap; }
button { padding: 5px 8px; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-muted); border-radius: var(--radius-sm); font-size: 11px; }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent-text); }
.map { position: relative; overflow: hidden; border-radius: var(--radius); background: var(--bg-input); cursor: crosshair; }
img, svg { display: block; width: 100%; height: 100%; } svg { position: absolute; inset: 0; pointer-events: none; }
ellipse, line, circle { stroke: white; stroke-width: 1; vector-effect: non-scaling-stroke; fill: rgb(255 100 100 / 0.2); }
</style>
