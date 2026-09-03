import { ref, watch } from 'vue'

const STORAGE_KEY = 'imejii:theme'

function initialTheme() {
  const current = document.documentElement.dataset.theme
  return current === 'light' || current === 'dark' ? current : 'dark'
}

/** Globaler Theme-Zustand - das Startthema setzt bereits das Inline-Skript in index.html. */
const theme = ref(initialTheme())

watch(theme, (value) => {
  document.documentElement.dataset.theme = value
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Privater Modus o. Ae. - Theme bleibt dann nur fuer diese Sitzung aktiv.
  }
})

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  return { theme, toggleTheme }
}
