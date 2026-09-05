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
const studioProvenance = computed(() => item.value?.extensions?.['sdxl-studio'])
const studioLabel = computed(() => ({ inpaint: 'AI-inpainted variant', outpaint: 'AI-outpainted variant', 'text-to-image': 'AI-generated image' })[studioProvenance.value?.operation] || 'AI Studio variant')
const studioHint = computed(() => studioProvenance.value?.operation === 'text-to-image' ? 'Locally generated with SDXL. The complete recipe remains in Saved work.'
  : studioProvenance.value?.operation === 'outpaint' ? 'Local SDXL outpainting. The original image remains embedded at its recorded placement.'
    : 'Local SDXL inpainting. Source and original transparency preserved. The full session remains in Saved work.')

const fileRows = computed(() => {
  const current = item.value
  if (!current) return []
  const output = store.outputSize
  const megapixels = (current.width * current.height) / 1e6
  return [
    { label: 'File', value: current.name },
    { label: 'Type', value: current.type || 'unknown' },
    { label: 'Working color', value: current.colorSpace || 'sRGB · 8-bit' },
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
    <section v-if="item?.extensions?.['sdxl-studio']" class="panel-section">
      <div class="section-title"><span>{{ studioLabel }}</span></div>
      <p class="hint">{{ studioHint }}</p>
      <dl class="facts">
        <template v-if="item.extensions['sdxl-studio'].sourceName"><dt>Source</dt><dd>{{ item.extensions['sdxl-studio'].sourceName }}</dd></template>
        <dt>Prompt</dt><dd>{{ item.extensions['sdxl-studio'].parameters?.prompt }}</dd>
        <dt>Negative</dt><dd>{{ item.extensions['sdxl-studio'].parameters?.negative || 'None' }}</dd>
        <dt>Seed</dt><dd>{{ item.extensions['sdxl-studio'].parameters?.seed }}</dd>
        <dt>Model</dt><dd>{{ item.extensions['sdxl-studio'].model }}</dd>
        <dt>Provider</dt><dd>{{ item.extensions['sdxl-studio'].provider }} {{ item.extensions['sdxl-studio'].providerVersion }}</dd>
        <dt>Workflow</dt><dd>{{ item.extensions['sdxl-studio'].workflow }}</dd>
      </dl>
    </section>
    <section v-if="item?.extensions?.['ai-remove']" class="panel-section">
      <div class="section-title"><span>AI-modified photo</span></div>
      <p class="hint">Object removal · LaMa · local processing. This photo is a rendered variant; the source was not overwritten.</p>
      <dl class="facts">
        <dt>Source</dt><dd>{{ item.extensions['ai-remove'].sourceName }}</dd>
        <dt>Plugin</dt><dd>AI Remove {{ item.extensions['ai-remove'].version }}</dd>
        <dt>Created</dt><dd>{{ item.extensions['ai-remove'].createdAt }}</dd>
      </dl>
    </section>
    <section v-if="item?.extensions?.['ai-cutout']" class="panel-section">
      <div class="section-title"><span>{{ item.extensions['ai-cutout'].operation === 'subject-composition' ? 'Subject Studio photo' : 'AI-cutout photo' }}</span></div>
      <p class="hint">BiRefNet Lite · local processing. Rendered variant; the source was not overwritten. Studio styles are baked into the photo. Export as PNG to keep any transparency.</p>
      <dl class="facts">
        <dt>Source</dt><dd>{{ item.extensions['ai-cutout'].sourceName }}</dd>
        <dt>Plugin</dt><dd>AI Cutout {{ item.extensions['ai-cutout'].version }}</dd>
        <dt>Created</dt><dd>{{ item.extensions['ai-cutout'].createdAt }}</dd>
      </dl>
    </section>
    <section v-if="item?.warnings?.length" class="panel-section">
      <p v-for="warning in item.warnings" :key="warning" class="hint">{{ warning }}</p>
    </section>
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
