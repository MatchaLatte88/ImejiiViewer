<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor.js'
import { DEFAULT_EFFECTS } from '../../lib/effects.js'
import SliderControl from '../ui/SliderControl.vue'
import ColorField from '../ui/ColorField.vue'

const store = useEditorStore()
const effects = computed(() => store.settings.effects)

function resetEffects() {
  store.settings.effects = { ...DEFAULT_EFFECTS }
}
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Schaerfe &amp; Weichzeichnung</span>
        <button type="button" class="link-btn" @click="resetEffects">zuruecksetzen</button>
      </div>
      <div class="stack">
        <SliderControl
          v-model="effects.sharpen"
          label="Schaerfen"
          unit="%"
          :min="0"
          :max="100"
          hint="Hilft bei weichen Scans und JPEG-Vorlagen"
        />
        <SliderControl v-model="effects.blur" label="Weichzeichnen" unit="px" :min="0" :max="20" />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Farbreduktion</span></div>
      <SliderControl
        v-model="effects.posterize"
        label="Farbstufen"
        :min="0"
        :max="32"
        :reset-value="0"
        hint="0 = aus. Wenige Stufen erzeugen flache, druckfreundliche Flaechen."
      />
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Kontur</span></div>
      <div class="stack">
        <SliderControl
          v-model="effects.outlineWidth"
          label="Staerke"
          unit="px"
          :min="0"
          :max="40"
          :reset-value="0"
          hint="Legt eine Umrandung um die freigestellte Silhouette"
        />
        <ColorField v-model="effects.outlineColor" label="Konturfarbe" />
        <SliderControl
          v-model="effects.outlineOpacity"
          label="Deckkraft"
          unit="%"
          :min="0"
          :max="100"
          :reset-value="100"
          :disabled="effects.outlineWidth === 0"
        />
        <p v-if="effects.outlineWidth > 0" class="hint">
          Damit die Kontur nicht am Rand abgeschnitten wird, unter <b>Form</b> etwas Rand
          hinzufuegen.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.link-btn {
  border: none;
  background: none;
  padding: 0;
  font-size: 11px;
  color: var(--text-subtle);
  text-transform: none;
  letter-spacing: 0;
}

.link-btn:hover {
  color: var(--accent);
}

.hint b {
  color: var(--text-muted);
}
</style>
