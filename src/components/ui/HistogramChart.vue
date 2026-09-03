<script setup>
import { onMounted, ref, watch } from 'vue'

const props = defineProps({
  data: { type: Object, default: null }, // { r, g, b, l } je 256 Werte, 0..1
  height: { type: Number, default: 88 },
})

const canvasEl = ref(null)

function drawChannel(ctx, values, width, height, color, fill) {
  ctx.beginPath()
  ctx.moveTo(0, height)
  for (let i = 0; i < 256; i++) {
    // Wurzel-Skalierung: sonst verschluckt eine Spitze alle feinen Details.
    const value = Math.sqrt(values[i])
    ctx.lineTo((i / 255) * width, height - value * (height - 2))
  }
  ctx.lineTo(width, height)
  ctx.closePath()
  if (fill) {
    ctx.fillStyle = color
    ctx.fill()
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function draw() {
  const canvas = canvasEl.value
  if (!canvas) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = canvas.clientWidth || 280
  canvas.width = width * dpr
  canvas.height = props.height * dpr

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, props.height)
  if (!props.data) return

  drawChannel(ctx, props.data.l, width, props.height, 'rgba(140,140,150,0.35)', true)
  ctx.globalCompositeOperation = 'screen'
  drawChannel(ctx, props.data.r, width, props.height, 'rgba(239,68,68,0.9)', false)
  drawChannel(ctx, props.data.g, width, props.height, 'rgba(34,197,94,0.9)', false)
  drawChannel(ctx, props.data.b, width, props.height, 'rgba(59,130,246,0.9)', false)
  ctx.globalCompositeOperation = 'source-over'
}

watch(() => props.data, draw)
onMounted(draw)
</script>

<template>
  <div class="histogram" :style="{ height: height + 'px' }">
    <canvas ref="canvasEl" :style="{ height: height + 'px' }" />
    <span v-if="!data" class="histogram__empty">no data</span>
  </div>
</template>

<style scoped>
.histogram {
  position: relative;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  overflow: hidden;
}

.histogram canvas {
  display: block;
  width: 100%;
}

.histogram__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--text-subtle);
}
</style>
