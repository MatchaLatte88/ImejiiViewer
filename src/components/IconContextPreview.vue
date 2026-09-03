<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editor.js'
import { resizeCanvas } from '../lib/transform.js'

/**
 * Zeigt das Ergebnis dort, wo ein Icon tatsaechlich auftaucht - Browser-Tab
 * und App-Dock - statt nur als nackte Pixelgroesse wie in IconPreview.
 */
const TAB_ICON_SIZE = 14
const ADDRESS_ICON_SIZE = 12
const APP_ICON_SIZE = 48

const store = useEditorStore()

const tabIconEl = ref(null)
const addressIconEl = ref(null)
const appIconEl = ref(null)

function drawInto(canvas, size) {
  const source = store.previewCanvas
  if (!canvas) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = size * dpr
  canvas.height = size * dpr
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!source) return
  ctx.drawImage(resizeCanvas(source, canvas.width, canvas.height), 0, 0)
}

function draw() {
  drawInto(tabIconEl.value, TAB_ICON_SIZE)
  drawInto(addressIconEl.value, ADDRESS_ICON_SIZE)
  drawInto(appIconEl.value, APP_ICON_SIZE)
}

watch(() => store.renderVersion, () => nextTick(draw))
onMounted(draw)
</script>

<template>
  <div class="context">
    <figure class="mock mock--browser">
      <div class="browser">
        <div class="browser__tabs">
          <div class="tab tab--active">
            <canvas ref="tabIconEl" class="tab__icon" :style="{ width: TAB_ICON_SIZE + 'px', height: TAB_ICON_SIZE + 'px' }" />
            <span class="tab__title" />
            <span class="tab__close">&times;</span>
          </div>
          <div class="tab tab--ghost" />
          <div class="tab tab--ghost" />
        </div>
        <div class="browser__bar">
          <span class="browser__dot" />
          <span class="browser__dot" />
          <span class="browser__dot" />
          <div class="browser__field">
            <canvas
              ref="addressIconEl"
              class="tab__icon"
              :style="{ width: ADDRESS_ICON_SIZE + 'px', height: ADDRESS_ICON_SIZE + 'px' }"
            />
            <span>yoursite.com</span>
          </div>
        </div>
      </div>
      <figcaption>Browser tab</figcaption>
    </figure>

    <figure class="mock mock--dock">
      <div class="dock-scene">
        <div class="dock">
          <span class="dock__tile dock__tile--ghost" />
          <span class="dock__tile dock__tile--ghost" />
          <span class="dock__tile dock__tile--app">
            <canvas
              ref="appIconEl"
              :style="{ width: APP_ICON_SIZE + 'px', height: APP_ICON_SIZE + 'px' }"
            />
          </span>
          <span class="dock__tile dock__tile--ghost" />
          <span class="dock__tile dock__tile--ghost" />
        </div>
      </div>
      <figcaption>App icon</figcaption>
    </figure>
  </div>
</template>

<style scoped>
.context {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.mock {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mock figcaption {
  font-size: 11px;
  color: var(--text-subtle);
}

/* --- Browser-Tab --- */
.browser {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-input);
  overflow: hidden;
}

.browser__tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 6px 6px 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px 6px 0 0;
  min-width: 0;
}

.tab--active {
  flex: 1;
  max-width: 120px;
  background: var(--bg-elevated);
}

.tab--ghost {
  width: 36px;
  background: rgb(0 0 0 / 0.04);
}

.tab__icon {
  flex: none;
  border-radius: 2px;
}

.tab__title {
  flex: 1;
  min-width: 12px;
  height: 6px;
  border-radius: 3px;
  background: var(--border-strong);
  opacity: 0.7;
}

.tab__close {
  flex: none;
  font-size: 11px;
  line-height: 1;
  color: var(--text-subtle);
}

.browser__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
}

.browser__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border-strong);
}

.browser__field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 18px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--bg-input);
  font-size: 10px;
  color: var(--text-subtle);
}

.browser__field span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Dock --- */
.dock-scene {
  display: grid;
  place-items: center;
  height: 92px;
  border-radius: var(--radius);
  background: radial-gradient(circle at 50% 0%, var(--bg-hover), var(--canvas-bg));
  border: 1px solid var(--border);
}

.dock {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.dock__tile {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 22%;
  overflow: hidden;
  flex: none;
}

.dock__tile--ghost {
  background: linear-gradient(160deg, var(--bg-hover), var(--bg-active));
}

.dock__tile--app {
  width: 48px;
  height: 48px;
  transform: translateY(-6px);
  box-shadow: var(--shadow);
}
</style>
