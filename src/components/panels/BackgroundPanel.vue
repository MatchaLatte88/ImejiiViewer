<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor.js'
import { DEFAULT_KEYING } from '../../lib/pipeline.js'
import { contrastColor, hexToRgb, rgbToHex } from '../../lib/color.js'
import SliderControl from '../ui/SliderControl.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ColorField from '../ui/ColorField.vue'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'

const store = useEditorStore()
const keying = computed(() => store.settings.keying)
const hasKeys = computed(() => keying.value.keys.length > 0)

const modeOptions = [
  { value: false, label: 'Ueberall', title: 'Alle passenden Pixel im Bild entfernen' },
  { value: true, label: 'Zusammenhaengend', title: 'Nur die verbundene Flaeche vom Rand bzw. Klickpunkt aus' },
]

function startPicker(mode) {
  store.eyedropperMode = store.eyedropperMode === mode ? null : mode
}

function resetKeying() {
  store.settings.keying = { ...DEFAULT_KEYING, keys: [], seeds: [] }
}

function addManualColor() {
  store.addKeyColor('#ffffff')
}

/** Farbe an Ort und Stelle ersetzen, damit die Reihenfolge erhalten bleibt. */
function updateKeyColor(index, hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return
  keying.value.keys.splice(index, 1, { hex: rgbToHex(rgb.r, rgb.g, rgb.b), ...rgb })
}
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Hintergrund entfernen</span>
        <button v-if="hasKeys" type="button" class="link-btn" @click="resetKeying">
          zuruecksetzen
        </button>
      </div>

      <div class="stack">
        <AppButton icon="wand" block @click="store.autoDetectBackground()">
          Hintergrund automatisch erkennen
        </AppButton>

        <div class="picker-row">
          <AppButton
            icon="eyedropper"
            block
            :active="store.eyedropperMode === 'add'"
            title="Farbe im Bild aufnehmen und zur Liste hinzufuegen"
            @click="startPicker('add')"
          >
            Farbe aufnehmen
          </AppButton>
          <AppButton
            icon="plus"
            title="Farbe manuell hinzufuegen"
            @click="addManualColor"
          />
        </div>

        <p v-if="store.eyedropperMode" class="hint hint--accent">
          Die Vorschau zeigt jetzt das Original. Klicke die Hintergrundfarbe an.
        </p>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title">
        <span>Transparente Farben ({{ keying.keys.length }})</span>
        <button v-if="hasKeys" type="button" class="link-btn" @click="store.clearKeyColors()">
          alle entfernen
        </button>
      </div>

      <p v-if="!hasKeys" class="hint">
        Noch keine Farbe gewaehlt. Nimm mit der Pipette die Hintergrundfarbe auf - alle
        aehnlichen Pixel werden dann transparent.
      </p>

      <ul v-else class="keys">
        <li v-for="(key, index) in keying.keys" :key="key.hex + index" class="keys__item">
          <span
            class="keys__swatch"
            :style="{ background: key.hex, color: contrastColor(key.r, key.g, key.b) }"
          >
            <AppIcon name="check" :size="12" />
          </span>
          <ColorField
            :model-value="key.hex"
            class="keys__field"
            @update:model-value="(value) => updateKeyColor(index, value)"
          />
          <AppButton
            icon="trash"
            variant="danger"
            size="sm"
            title="Farbe entfernen"
            @click="store.removeKeyColor(index)"
          />
        </li>
      </ul>
    </section>

    <section class="panel-section" :class="{ 'is-muted': !hasKeys }">
      <div class="section-title"><span>Auswahl</span></div>
      <div class="stack">
        <SegmentedControl v-model="keying.contiguous" :options="modeOptions" :disabled="!hasKeys" />
        <p v-if="keying.contiguous" class="hint">
          Es wird nur die Flaeche entfernt, die mit dem Bildrand bzw. dem angeklickten Punkt
          verbunden ist. Gleiche Farben innerhalb des Logos bleiben erhalten.
        </p>

        <SliderControl
          v-model="keying.tolerance"
          label="Toleranz"
          unit="%"
          :min="0"
          :max="100"
          :step="0.5"
          :reset-value="DEFAULT_KEYING.tolerance"
          :disabled="!hasKeys"
          hint="Wie stark eine Farbe abweichen darf, um noch entfernt zu werden"
        />
        <SliderControl
          v-model="keying.softness"
          label="Weicher Uebergang"
          unit="%"
          :min="0"
          :max="50"
          :step="0.5"
          :reset-value="DEFAULT_KEYING.softness"
          :disabled="!hasKeys"
          hint="Breite des halbtransparenten Uebergangs"
        />
      </div>
    </section>

    <section class="panel-section" :class="{ 'is-muted': !hasKeys }">
      <div class="section-title"><span>Kanten</span></div>
      <div class="stack">
        <SliderControl
          v-model="keying.despill"
          label="Farbsaum entfernen"
          unit="%"
          :min="0"
          :max="100"
          :reset-value="DEFAULT_KEYING.despill"
          :disabled="!hasKeys"
          hint="Rechnet die Hintergrundfarbe aus halbtransparenten Randpixeln heraus"
        />
        <SliderControl
          v-model="keying.edgeContract"
          label="Maske schrumpfen"
          :min="-100"
          :max="100"
          :reset-value="0"
          :disabled="!hasKeys"
          hint="Positiv entfernt Restsaeume, negativ haelt mehr vom Motiv"
        />
        <SliderControl
          v-model="keying.feather"
          label="Weiche Kante"
          unit="px"
          :min="0"
          :max="10"
          :step="0.5"
          :reset-value="0"
          :disabled="!hasKeys"
        />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Ergebnis pruefen</span></div>
      <ToggleSwitch
        v-model="store.showOriginal"
        label="Original einblenden"
        hint="Zeigt das unbearbeitete Bild zum Vergleich"
      />
    </section>
  </div>
</template>

<style scoped>
.panel-section.is-muted {
  opacity: 0.55;
}

.picker-row {
  display: flex;
  gap: var(--space-2);
}

.picker-row > :first-child {
  flex: 1;
}

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

.hint--accent {
  color: var(--accent);
}

.keys {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.keys__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.keys__swatch {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
}

.keys__field {
  flex: 1;
  min-width: 0;
}
</style>
