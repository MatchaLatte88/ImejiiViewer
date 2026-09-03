import { onBeforeUnmount, onMounted } from 'vue'
import { useLibraryStore } from '../stores/library.js'
import { isDesktop } from '../lib/desktop.js'

function isTypingTarget(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
}

/**
 * Tastaturbedienung fuer Betrachter und Bildmodus.
 * @param {import('vue').Ref} viewerRef Referenz auf den PhotoViewer
 * @param {{ editing?: boolean }} options editing schaltet die Bearbeitung frei
 *   (Rueckgaengig, Zuschneiden, Drehen, Vergleich mit dem Original)
 */
export function usePhotoShortcuts(viewerRef, { editing = false } = {}) {
  const store = useLibraryStore()

  function onKeyDown(event) {
    // Auf dem Desktop laufen Strg-Kuerzel ueber das Anwendungsmenue.
    const meta = event.ctrlKey || event.metaKey
    if (isTypingTarget(event.target)) return

    if (editing && !isDesktop && meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) store.redo()
      else store.undo()
      return
    }

    if (isTypingTarget(event.target)) return
    if (meta || event.altKey || store.isDecoding) return

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        store.step(1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        store.step(-1)
        break
      case 'Escape':
        if (editing && store.cropMode) store.cancelCrop()
        break
      case 'Delete':
        if (store.activeId !== null) store.remove(store.activeId)
        break
      case '+':
        viewerRef.value?.zoomBy(1.25)
        break
      case '-':
        viewerRef.value?.zoomBy(1 / 1.25)
        break
      case '0':
        viewerRef.value?.resetView()
        break
      default:
        break
    }

    const key = event.key.toLowerCase()
    if (key === 'f') viewerRef.value?.toggleFullscreen()
    else if (key === 's' && store.canStep) viewerRef.value?.toggleSlideshow()
    else if (!editing) return
    else if (key === 'c' && store.activeItem) store.cropMode = !store.cropMode
    else if (key === 'r' && store.activeItem) store.rotateBy(event.shiftKey ? -90 : 90)
    else if (event.code === 'Space' && store.activeItem && !event.repeat) {
      event.preventDefault()
      store.showOriginal = true
    }
  }

  function onKeyUp(event) {
    if (editing && event.code === 'Space') store.showOriginal = false
  }

  const onBlur = () => { store.showOriginal = false }
  onMounted(() => {
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
  })

  onBeforeUnmount(() => {
    onBlur()
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  })
}
