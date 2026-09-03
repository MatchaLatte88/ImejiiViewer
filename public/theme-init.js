try {
  const stored = localStorage.getItem('imejii:theme') || localStorage.getItem('logo-creator:theme')
  document.documentElement.dataset.theme = ['dark', 'light'].includes(stored)
    ? stored : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
} catch { document.documentElement.dataset.theme = 'dark' }
