import { ref } from 'vue'
import { defineStore } from 'pinia'

/** Gemeinsamer Zustand aller Arbeitsbereiche: aktiver Modus und Hinweise. */
export const useUiStore = defineStore('ui', () => {
  // Jeder Start beginnt im Betrachter - die App ist zuerst ein Bildbetrachter,
  // die Bearbeitung holt man sich ueber "Edit" bzw. "Logo Creator" dazu.
  const mode = ref('view') // view | images | logo
  const notice = ref(null) // { type: 'info' | 'error' | 'success', message }

  let noticeTimer = null

  function setMode(next) {
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

  return { mode, notice, setMode, setNotice, dismissNotice }
})
