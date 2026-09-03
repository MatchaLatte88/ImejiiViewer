<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { resizeCanvas } from '../lib/transform.js'

const props = defineProps({
  size: { type: Number, required: true },
})

const store = useEditorStore()
const canvasEl = ref(null)

function draw() {
  const target = canvasEl.value
  const source = store.previewCanvas
  if (!target) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  target.width = props.size * dpr
  target.height = props.size * dpr
  const ctx = target.getContext('2d')
  ctx.clearRect(0, 0, target.width, target.height)
  if (!source) return
  // Gleiches Downscale-Verfahren wie beim Export - die Vorschau luegt so nicht.
  ctx.drawImage(resizeCanvas(source, target.width, target.height), 0, 0)
}

watch(() => store.renderVersion, () => nextTick(draw))
watch(() => props.size, () => nextTick(draw))
onMounted(draw)
</script>

<template>
  <figure class="icon-preview">
    <span class="icon-preview__frame checkerboard" :style="{ width: size + 'px', height: size + 'px' }">
      <canvas ref="canvasEl" :style="{ width: size + 'px', height: size + 'px' }" />
    </span>
    <figcaption class="mono">{{ size }}</figcaption>
  </figure>
</template>

<style scoped>
.icon-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.icon-preview__frame {
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.icon-preview canvas {
  display: block;
}

.icon-preview figcaption {
  color: var(--text-subtle);
}
</style>
