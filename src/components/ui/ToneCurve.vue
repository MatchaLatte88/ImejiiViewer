<script setup>
import { computed, ref } from 'vue'
import { IDENTITY_CURVE, normalizeCurve } from '../../lib/photoCurves.js'
const props = defineProps({ modelValue: { type: Array, required: true }, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const root = ref(null)
let dragging = -1
const labels = ['Black', 'Shadows', 'Midtones', 'Highlights', 'White']
const points = computed(() => normalizeCurve(props.modelValue))
const line = computed(() => points.value.map((value, i) => `${IDENTITY_CURVE[i]},${255 - value}`).join(' '))
function set(index, value) {
  if (props.disabled) return
  const copy = [...points.value]; copy[index] = Math.round(Math.max(0, Math.min(255, value)))
  emit('update:modelValue', copy)
}
function move(event) {
  if (dragging < 0) return
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(root.value.getScreenCTM().inverse())
  set(dragging, 255 - point.y)
}
function down(event, index) { if (props.disabled) return; dragging = index; root.value.setPointerCapture(event.pointerId); move(event) }
function up() { dragging = -1 }
function key(event, index) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  set(index, event.key === 'Home' ? 0 : event.key === 'End' ? 255 : points.value[index] + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1))
}
</script>

<template>
  <div class="tone-curve">
    <svg ref="root" viewBox="-5 -5 265 265" aria-label="Tone curve" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up">
      <path class="grid" d="M0 64H255M0 128H255M0 192H255M64 0V255M128 0V255M192 0V255" />
      <path class="identity" d="M0 255L255 0" />
      <polyline :points="line" />
      <circle v-for="(value, i) in points" :key="i" :cx="IDENTITY_CURVE[i]" :cy="255 - value" r="6"
        role="slider" :tabindex="disabled ? -1 : 0" :aria-label="labels[i] + ' curve output'" aria-valuemin="0" aria-valuemax="255" :aria-valuenow="value" :aria-disabled="disabled"
        @pointerdown.prevent="down($event, i)" @keydown="key($event, i)" />
    </svg>
    <div class="tone-curve__footer"><span>Input → output · drag vertically</span><button type="button" :disabled="disabled" @click="emit('update:modelValue', [...IDENTITY_CURVE])">Reset curve</button></div>
  </div>
</template>

<style scoped>
svg { display: block; width: 100%; max-height: 180px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius); touch-action: none; overflow: visible; }
path { fill: none; stroke: var(--border); stroke-width: 1; } .identity { stroke-dasharray: 4 4; }
polyline { fill: none; stroke: var(--accent); stroke-width: 2; }
circle { fill: var(--bg-panel); stroke: var(--accent); stroke-width: 2; cursor: ns-resize; }
circle:focus { fill: var(--accent); outline: none; stroke-width: 4; }
.tone-curve__footer { display: flex; justify-content: space-between; margin-top: 8px; gap: 8px; font-size: 10px; color: var(--text-subtle); }
button { color: var(--accent-text); border: none; background: none; padding: 0; }
</style>
