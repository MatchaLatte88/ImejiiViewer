<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor.js'
import { DEFAULT_TRANSFORM } from '../../lib/transform.js'
import SliderControl from '../ui/SliderControl.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'
import AppButton from '../ui/AppButton.vue'

const store = useEditorStore()
const transform = computed(() => store.settings.transform)

const hasBackground = computed({
  get: () => transform.value.background !== null,
  set: (value) => {
    transform.value.background = value ? '#ffffff' : null
  },
})

function rotateBy(degrees) {
  const next = transform.value.rotate + degrees
  transform.value.rotate = ((((next + 180) % 360) + 360) % 360) - 180
}

function resetTransform() {
  store.settings.transform = { ...DEFAULT_TRANSFORM }
}
</script>

<template>
  <div class="panel">
    <section class="panel-section">
      <div class="section-title">
        <span>Orientation</span>
        <button type="button" class="link-btn" @click="resetTransform">reset</button>
      </div>
      <div class="stack">
        <div class="btn-row">
          <AppButton icon="rotate" size="sm" title="Rotate 90 degrees counter-clockwise" @click="rotateBy(-90)">
            -90
          </AppButton>
          <AppButton icon="rotate" size="sm" title="Rotate 90 degrees clockwise" @click="rotateBy(90)">
            +90
          </AppButton>
          <AppButton
            icon="flipH"
            size="sm"
            title="Flip horizontally"
            :active="transform.flipH"
            @click="transform.flipH = !transform.flipH"
          />
          <AppButton
            icon="flipV"
            size="sm"
            title="Flip vertically"
            :active="transform.flipV"
            @click="transform.flipV = !transform.flipV"
          />
        </div>
        <SliderControl
          v-model="transform.rotate"
          label="Free rotation"
          unit="deg"
          :min="-180"
          :max="180"
          :step="0.5"
          :reset-value="0"
        />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Canvas</span></div>
      <div class="stack">
        <ToggleSwitch
          v-model="transform.trim"
          label="Trim transparent edges"
          hint="Crops to the subject - the basis for edge-to-edge icons"
        />
        <ToggleSwitch
          v-model="transform.square"
          label="Square canvas"
          hint="Required by most app and favicon formats"
        />
        <SliderControl
          v-model="transform.padding"
          label="Padding"
          unit="%"
          :min="0"
          :max="40"
          :step="0.5"
          :reset-value="0"
          hint="Safe margin around the subject"
        />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Shape</span></div>
      <div class="stack">
        <SliderControl
          v-model="transform.cornerRadius"
          label="Corner radius"
          unit="%"
          :min="0"
          :max="50"
          :step="0.5"
          :reset-value="0"
          hint="50% turns a square canvas into a circle"
        />
        <div class="btn-row">
          <AppButton size="sm" icon="square" @click="transform.cornerRadius = 0">Square</AppButton>
          <AppButton size="sm" icon="grid" @click="transform.cornerRadius = 22">Rounded</AppButton>
          <AppButton
            size="sm"
            icon="circle"
            @click="
              () => {
                transform.square = true
                transform.cornerRadius = 50
              }
            "
          >
            Circle
          </AppButton>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-title"><span>Background</span></div>
      <div class="stack">
        <ToggleSwitch
          v-model="hasBackground"
          label="Fill background color"
          hint="For formats without transparency, e.g. iOS icons or JPG"
        />
        <div v-if="hasBackground" class="bg-row">
          <input
            type="color"
            class="bg-row__picker"
            :value="transform.background"
            @input="transform.background = $event.target.value"
          />
          <div class="bg-row__presets">
            <button
              v-for="color in ['#ffffff', '#000000', '#0d0f14', '#f5b70a', '#f5f5f5']"
              :key="color"
              type="button"
              class="bg-row__preset"
              :style="{ background: color }"
              :title="color"
              @click="transform.background = color"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.btn-row {
  display: flex;
  gap: var(--space-2);
}

.btn-row > * {
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
  color: var(--accent-text);
}

.bg-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.bg-row__picker {
  width: 40px;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  cursor: pointer;
}

.bg-row__presets {
  display: flex;
  gap: 6px;
}

.bg-row__preset {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  padding: 0;
}

.bg-row__preset:hover {
  transform: scale(1.1);
}
</style>
