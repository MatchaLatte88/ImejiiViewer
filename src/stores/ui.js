import { ref } from 'vue'
import { defineStore } from 'pinia'
import { usePluginStore } from './plugins.js'

/** Gemeinsamer Zustand aller Arbeitsbereiche: aktiver Modus und Hinweise. */
export const useUiStore = defineStore('ui', () => {
  // Jeder Start beginnt im Betrachter - die App ist zuerst ein Bildbetrachter,
  // die Bearbeitung holt man sich ueber "Edit" bzw. "Logo Creator" dazu.
  const mode = ref('view') // view | images | logo | ai-studio
  const notice = ref(null) // { type: 'info' | 'error' | 'success', message }

  // Beide Seitenpanele lassen sich einklappen - dann gehoert die Flaeche dem Bild.
  const panels = ref({ tools: true, export: true })

  let noticeTimer = null

  function togglePanel(key) {
    panels.value[key] = !panels.value[key]
  }

  function setMode(next) {
    if (!['view', 'images', 'logo', 'ai-studio'].includes(next)) return
    if (next === 'ai-studio' && !usePluginStore().studioEnabled) {
      setNotice('info', 'Enable AI Studio in Images → Plugins first.'); return
    }
    mode.value = next
  }

  function setNotice(type, message, timeout = 4000) {
    notice.value = { type, message }
    if (noticeTimer) clearTimeout(noticeTimer)
    if (timeout) {
      noticeTimer = setTimeout(() => {
        notice.value = null
        noticeTimer = null
      }, timeout)
    }
  }

  function dismissNotice() {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    notice.value = null
  }

  return { mode, notice, panels, setMode, togglePanel, setNotice, dismissNotice }
})
