import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { plugins } from '../plugins/registry.js'

export const usePluginStore = defineStore('plugins', () => {
  const enabled = ref([])
  try {
    const stored = JSON.parse(localStorage.getItem('imejii-plugins-v1') || '[]')
    if (Array.isArray(stored)) enabled.value = [...new Set(stored.filter(id => plugins.some(entry => entry.manifest.id === id)))]
  } catch { /* Preferences can be session-only. */ }
  const studioEnabled = computed(() => enabled.value.includes('sdxl-studio'))
  function toggle(id) {
    if (!plugins.some(entry => entry.manifest.id === id)) throw new Error('Unknown plugin.')
    enabled.value = enabled.value.includes(id) ? enabled.value.filter(value => value !== id) : [...enabled.value, id]
    try { localStorage.setItem('imejii-plugins-v1', JSON.stringify(enabled.value)) } catch { /* session-only */ }
  }
  return { enabled, studioEnabled, toggle }
})
