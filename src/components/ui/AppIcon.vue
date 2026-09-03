<script setup>
import { computed } from 'vue'

/**
 * Schlanke Icon-Sammlung (24x24, Strichzeichnung) - vermeidet eine externe
 * Icon-Abhaengigkeit und haelt das Bundle klein.
 */
const PATHS = {
  upload: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5 5 5M14.5 12.5 17 10l3 3M9 9.5h.01',
  undo: 'M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-3',
  redo: 'm15 14 5-5-5-5M20 9h-9a7 7 0 0 0 0 14h3',
  reset: 'M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  eyedropper: 'm14.5 4.5 5 5M17 3.5 20.5 7 18 9.5l-1-1-7.8 7.8-3.4.9.9-3.4L14.5 6l-1-1z',
  wand: 'M5 19 16 8M18 3v4M16 5h4M6 5v2M5 6h2M18 15v2M17 16h2',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1',
  copy: 'M9 9h10v10a2 2 0 0 1-2 2H9zM15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  fit: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm9 6 6 6-6 6',
  check: 'm5 12.5 4.5 4.5L19 7',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 14l9 5 9-5',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4v6M8 14v6',
  sparkles: 'm7 3 1.4 3.6L12 8l-3.6 1.4L7 13l-1.4-3.6L2 8l3.6-1.4zM17 11l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 3v6h7V3M8 15h8',
  folder: 'M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  alert: 'M12 4 2 20h20L12 4zM12 10v5M12 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 8h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  square: 'M4 4h16v16H4z',
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  flipH: 'M12 3v18M8 7 4 12l4 5zM16 7l4 5-4 5z',
  flipV: 'M3 12h18M7 8l5-4 5 4zM7 16l5 4 5-4z',
  rotate: 'M20 11a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-1.5 1-2 2-2H18a3 3 0 0 0 3-3c0-6-4-11.5-9-11.5zM7.5 12.5h.01M9.5 8.5h.01M14.5 7.5h.01M17 11h.01',
}

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 },
})

const path = computed(() => PATHS[props.name] || '')
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="path" />
  </svg>
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
}
</style>
