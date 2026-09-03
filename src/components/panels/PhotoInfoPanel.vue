<script setup>
import { computed, onMounted, watch } from 'vue'
import { useLibraryStore } from '../../stores/library.js'
import { formatExif } from '../../lib/exif.js'
import { formatBytes } from '../../lib/download.js'
import HistogramChart from '../ui/HistogramChart.vue'
import AppButton from '../ui/AppButton.vue'

const store = useLibraryStore()

const item = computed(() => store.activeItem)
const exifRows = computed(() => formatExif(item.value?.exif))

const fileRows = computed(() => {
  const current = item.value
  if (!current) return []
  const output = store.outputSize
  const megapixels = (current.width * current.height) / 1e6
  return [
    { label: 'File', value: current.name },
    { label: 'Type', value: current.type || 'unknown' },
    { label: 'Size on disk', value: formatBytes(current.size) },
    { label: 'Dimensions', value: current.width + ' x ' + current.height + ' px' },
    { label: 'Megapixels', value: megapixels.toFixed(1) + ' MP' },
    {
      label: 'Aspect ratio',
      value: (current.width / current.height).toFixed(3) + ' : 1',
    },
    { label: 'Output', value: output ? output.width + ' x ' + output.height + ' px' : '-' },
    {
      label: 'Modified',
      value: new Date(current.lastModified).toLocaleString(),
    },
  ]
})

// Das Histogramm gehoert zum sichtbaren Ergebnis - beim Oeffnen des Panels und
// nach jeder Neuberechnung auffrischen.
watch(() => store.renderVersion, () => store.ensureHistogram())
onMounted(() => store.ensureHistogram())
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Histogram</span>
        <AppButton size="sm" variant="ghost" icon="reset" title="Refresh" @click="store.ensureHistogram()" />
      </div>
      <HistogramChart :data="store.histogram" />
      <p class="hint" style="margin-top: var(--space-2)">
        Luminance as area, the RGB channels as curves - shown for the edited result.
      </p>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>File</span></div>
      <dl v-if="item" class="facts">
        <template v-for="row in fileRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd :title="row.value">{{ row.value }}</dd>
        </template>
      </dl>
      <p v-else class="hint">No image selected.</p>
    </section>

    <section v-if="exifRows.length" class="panel-section">
      <div class="section-title"><span>Camera (EXIF)</span></div>
      <dl class="facts">
        <template v-for="row in exifRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
    </section>

    <section v-else-if="item" class="panel-section">
      <div class="section-title"><span>Camera (EXIF)</span></div>
      <p class="hint">This file contains no EXIF metadata.</p>
    </section>
  </div>
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 5px var(--space-3);
  margin: 0;
  font-size: 11px;
}

.facts dt {
  color: var(--text-subtle);
  white-space: nowrap;
}

.facts dd {
  margin: 0;
  color: var(--text);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
