<script setup>
import ToggleSwitch from './ToggleSwitch.vue'
defineProps({ options: { type: Object, required: true }, disabled: Boolean })
const emit = defineEmits(['update:options'])
function update(options, key, value) { emit('update:options', { ...options, [key]: value }) }
</script>

<template>
  <section class="panel-section">
    <div class="section-title"><span>Color &amp; metadata</span></div>
    <fieldset :disabled="disabled" class="stack">
      <p class="hint">sRGB · 8-bit. Raster exports include a matching ICC profile. Input profiles are converted; colors outside sRGB may clip.</p>
      <ToggleSwitch :model-value="options.keepCamera" label="Keep camera information" hint="Capture date, camera, lens and exposure" @update:model-value="update(options, 'keepCamera', $event)" />
      <ToggleSwitch :model-value="options.keepGps" label="Include GPS location" hint="Off by default for privacy" @update:model-value="update(options, 'keepGps', $event)" />
      <label>Creator<input :value="options.artist" maxlength="255" placeholder="Use source creator, if retained" @input="update(options, 'artist', $event.target.value)"></label>
      <label>Copyright<input :value="options.copyright" maxlength="255" placeholder="Use source copyright, if retained" @input="update(options, 'copyright', $event.target.value)"></label>
      <p class="hint">Only the listed EXIF fields are retained. XMP, IPTC, MakerNotes and source thumbnails are omitted. EXIF text uses ASCII; other characters become “?”. Clipboard apps may strip metadata.</p>
    </fieldset>
  </section>
</template>

<style scoped>
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }
input { min-width: 0; width: 100%; height: 30px; padding: 0 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); }
</style>
