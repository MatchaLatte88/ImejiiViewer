<script setup>
import { ACCEPTED_EXTENSIONS } from '../lib/imageLoader.js'
import AppIcon from './ui/AppIcon.vue'
import AppButton from './ui/AppButton.vue'

defineProps({
  isDragging: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
})

const emit = defineEmits(['open-file'])
</script>

<template>
  <div class="dropzone" :class="{ 'is-dragging': isDragging }">
    <div class="dropzone__card">
      <div class="dropzone__icon">
        <AppIcon name="image" :size="28" />
      </div>
      <h2>Drop an image here</h2>
      <p class="dropzone__lead">
        Turn any image into a transparent logo or a complete icon set -
        entirely in your browser, nothing is uploaded.
      </p>

      <div class="dropzone__actions">
        <AppButton icon="folder" variant="primary" :disabled="isLoading" @click="emit('open-file')">
          {{ isLoading ? 'Loading ...' : 'Choose file' }}
        </AppButton>
        <span class="dropzone__or">or press <b>Ctrl + V</b> to paste</span>
      </div>

      <ul class="dropzone__formats">
        <li v-for="ext in ACCEPTED_EXTENSIONS" :key="ext" class="mono">{{ ext }}</li>
      </ul>

      <div class="dropzone__steps">
        <div class="step">
          <span class="step__num">1</span>
          <div>
            <b>Pick the background</b>
            <p>Click the color that should become transparent with the eyedropper.</p>
          </div>
        </div>
        <div class="step">
          <span class="step__num">2</span>
          <div>
            <b>Fine-tune the colors</b>
            <p>Adjust brightness, contrast, saturation and edges.</p>
          </div>
        </div>
        <div class="step">
          <span class="step__num">3</span>
          <div>
            <b>Export the icon set</b>
            <p>PNG, WebP, JPG or a multi-size ICO, packed as a ZIP.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  flex: 1;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background: var(--canvas-bg);
  background-image: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0);
  background-size: 24px 24px;
  transition: background var(--transition);
}

.dropzone.is-dragging .dropzone__card {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: scale(1.01);
}

.dropzone__card {
  width: min(560px, 100%);
  padding: var(--space-6);
  text-align: center;
  background: var(--bg-elevated);
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow);
  transition:
    border-color var(--transition),
    background var(--transition),
    transform var(--transition);
}

.dropzone__icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  margin: 0 auto var(--space-4);
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.dropzone__card h2 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.dropzone__lead {
  max-width: 380px;
  margin: var(--space-2) auto 0;
  color: var(--text-muted);
  line-height: 1.55;
}

.dropzone__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin: var(--space-5) 0 var(--space-4);
  flex-wrap: wrap;
}

.dropzone__or {
  font-size: 12px;
  color: var(--text-subtle);
}

.dropzone__or b {
  color: var(--text-muted);
  font-weight: 600;
}

.dropzone__formats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  padding: 0;
  margin: 0 0 var(--space-5);
  list-style: none;
}

.dropzone__formats li {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-subtle);
}

.dropzone__steps {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-5);
  border-top: 1px solid var(--border);
  text-align: left;
}

.step {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

.step__num {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.step b {
  font-size: 12px;
  font-weight: 600;
}

.step p {
  font-size: 11px;
  color: var(--text-subtle);
  line-height: 1.45;
}
</style>
