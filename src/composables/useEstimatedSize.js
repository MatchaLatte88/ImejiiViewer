import { onBeforeUnmount, ref, watch } from 'vue'
import { canvasToBlob } from '../lib/exportImage.js'

/**
 * Geschaetzte Dateigroesse fuer Format/Qualitaet, verzoegert kodiert - ein
 * Schieberegler soll nicht bei jedem Pixel neu kodieren.
 * @param {() => HTMLCanvasElement | null} getCanvas
 * @param {() => string} getFormat
 * @param {() => number} getQuality 0..100
 * @param {Array<() => unknown>} watchSources zusaetzliche Ausloeser (z.B. renderVersion)
 */
export function useEstimatedSize(getCanvas, getFormat, getQuality, watchSources = []) {
  const bytes = ref(null)
  let timer = null
  let token = 0

  async function run() {
    const canvas = getCanvas()
    if (!canvas) {
      bytes.value = null
      return
    }
    const myToken = ++token
    try {
      const blob = await canvasToBlob(canvas, getFormat(), (getQuality() ?? 92) / 100)
      if (myToken === token) bytes.value = blob.size
    } catch {
      if (myToken === token) bytes.value = null
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, 250)
  }

  watch([getFormat, getQuality, ...watchSources], schedule, { immediate: true })
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })

  return { bytes }
}
