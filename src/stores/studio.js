import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { canvasToBlob, slugify } from '../lib/exportImage.js'
import { claimAI } from '../plugins/ai-jobs.js'
import { decodePhoto } from '../lib/photoLoader.js'
import { resolveImageFile, saveBlob } from '../lib/desktop.js'
import { saveDraft, saveStudioDraft, listDrafts, loadDraft, sourceFingerprint, studioProjectBlob } from '../lib/drafts.js'
import { defaultParameters, normalizeParameters, dimensions, validateParameters, validateStrokes, interruptedDocument, artifactIds, STUDIO_OPERATIONS } from '../lib/studioDocument.js'
import { drawStrokes } from '../plugins/ai-remove/mask.js'
import { copyCanvas, workingMask, maskMatchesSource, prepareInpaint, prepareOutpaint, composeInpaint, alphaFromGrayscale } from '../plugins/sdxl-studio/pipeline.js'
import { useLibraryStore } from './library.js'
import { useUiStore } from './ui.js'

export const useStudioStore = defineStore('studio', () => {
  const document = ref(null), source = shallowRef(null), baseMask = shallowRef(null)
  const selected = ref(null), compare = ref(false), working = ref(false), pendingBackend = ref(false)
  const saveState = ref('saved'), error = ref(''), connection = ref(null), connecting = ref(false)
  const port = ref(8188), drawing = ref(false), operation = ref('inpaint')
  let artifacts = new Map(), timer, saving, initialized = false, mutating = false, saveRevision = -1, openVersion = 0
  const busy = computed(() => working.value || pendingBackend.value)
  const hasSource = computed(() => Boolean(source.value))
  const hasDocument = computed(() => Boolean(document.value))
  const hasInput = computed(() => operation.value === 'text-to-image' ? hasDocument.value : hasSource.value)
  const validationRequired = computed(() => {
    const model = document.value?.parameters?.model
    return Boolean(connection.value?.modelAvailable && model && !(connection.value.validatedPairs || []).some(pair => pair?.model === model && pair?.operation === operation.value))
  })
  const canUndo = computed(() => operation.value === 'inpaint' && !busy.value && !drawing.value && Boolean(document.value?.strokes.length))
  const canRedo = computed(() => operation.value === 'inpaint' && !busy.value && !drawing.value && Boolean(document.value?.redo.length))
  const dirty = computed(() => Boolean(document.value && document.value.revision !== saveRevision) || ['pending', 'saving', 'error'].includes(saveState.value) || drawing.value)
  const selectedResult = computed(() => document.value?.results.find(result => result.id === selected.value) || null)
  const currentJob = computed(() => document.value?.jobs.at(-1) || null)
  function initialParameters() {
    const parameters = defaultParameters()
    if (connection.value?.modelAvailable && !connection.value.models.includes(parameters.model)) parameters.model = connection.value.defaultModel
    return parameters
  }
  function touch() {
    if (!document.value || mutating) return
    document.value.revision++; saveState.value = 'pending'; clearTimeout(timer)
    timer = setTimeout(() => { void flush().catch(() => {}) }, 650)
  }
  watch(() => document.value?.parameters, touch, { deep: true, flush: 'sync' })
  async function artifact(canvas) {
    const blob = await canvasToBlob(canvas, 'png'), hash = await sourceFingerprint(blob)
    artifacts.set(hash, blob); return hash
  }
  function mask(extra = null) {
    if (!source.value) return null
    const canvas = workingMask(source.value)
    drawStrokes(canvas, [...document.value.strokes, ...(extra ? [extra] : [])], baseMask.value)
    return canvas
  }
  async function newTextDocument() {
    if (busy.value || drawing.value) throw new Error('Wait for the Studio operation to finish.')
    working.value = true
    try {
      await flush()
      const next = { id: crypto.randomUUID(), version: 1, revision: 0, operation: 'text-to-image', name: 'SDXL creation', width: 1024, height: 1024,
        source: null, mask: null, sourceOrigin: { kind: 'generated' }, coordinates: 'generated-output', parameters: initialParameters(), strokes: [], redo: [], results: [], jobs: [] }
      await saveStudioDraft(next, new Map())
      mutating = true; document.value = next; mutating = false
      artifacts = new Map(); source.value = null; baseMask.value = null; selected.value = null; operation.value = 'text-to-image'
      saveRevision = 0; saveState.value = 'saved'; error.value = ''; initialized = true
      window.dispatchEvent(new Event('imejii:saved-work'))
    } finally { working.value = false; mutating = false }
  }
  async function setOperation(next) {
    if (!STUDIO_OPERATIONS.includes(next)) return
    if (busy.value || drawing.value) throw new Error('Wait for the Studio operation to finish.')
    operation.value = next
    if (!document.value && next === 'text-to-image') { await newTextDocument(); return }
    if (document.value && document.value.operation !== next) { document.value.operation = next; selected.value = null; touch() }
  }
  function addStroke(stroke) {
    if (busy.value || !document.value) return
    const next = [...document.value.strokes, stroke]
    validateStrokes(next); document.value.strokes = next; document.value.redo = []; selected.value = null; touch()
  }
  function undo() { if (canUndo.value) { document.value.redo.push(document.value.strokes.pop()); selected.value = null; touch() } }
  function redo() { if (canRedo.value) { document.value.strokes.push(document.value.redo.pop()); selected.value = null; touch() } }
  // Reset remains undoable and also works for masks received from Subject Studio.
  function clearMask() { addStroke({ clear: true, erase: true, size: 1, points: [[0, 0]] }) }
  async function flush() {
    clearTimeout(timer)
    if (saving) { await saving; if (document.value?.revision !== saveRevision) return flush(); return }
    if (!document.value || document.value.revision === saveRevision) return
    const state = JSON.parse(JSON.stringify(document.value)), blobs = new Map(artifacts)
    saveState.value = 'saving'
    saving = Promise.resolve().then(() => saveStudioDraft(state, blobs)).then(() => {
      if (document.value?.id === state.id) { saveRevision = state.revision; saveState.value = document.value.revision === saveRevision ? 'saved' : 'pending' }
      window.dispatchEvent(new Event('imejii:saved-work'))
    }).catch(problem => { saveState.value = 'error'; error.value = 'Session could not be saved: ' + problem.message; throw problem }).finally(() => { saving = null })
    await saving
    if (document.value?.revision !== saveRevision) await flush()
  }
  async function newSource(canvas, name, initialMask = null, origin = { kind: 'file' }) {
    if (busy.value || drawing.value) throw new Error('Wait for the Studio operation to finish.')
    dimensions(canvas.width, canvas.height)
    if (initialMask && !maskMatchesSource(canvas, initialMask)) throw new Error('Mask does not match the source image.')
    working.value = true
    try {
      await flush()
      const nextSource = copyCanvas(canvas), nextMask = workingMask(canvas, initialMask), nextArtifacts = new Map()
      const sourceBlob = await canvasToBlob(nextSource, 'png'), maskBlob = await canvasToBlob(nextMask, 'png')
      const sourceHash = await sourceFingerprint(sourceBlob), maskHash = await sourceFingerprint(maskBlob)
      nextArtifacts.set(sourceHash, sourceBlob); nextArtifacts.set(maskHash, maskBlob)
      const sourceOperation = operation.value === 'outpaint' ? 'outpaint' : 'inpaint'
      const next = { id: crypto.randomUUID(), version: 1, revision: 0, operation: sourceOperation, name: String(name || 'Untitled').slice(0, 255), width: canvas.width, height: canvas.height,
        source: sourceHash, mask: maskHash, sourceOrigin: JSON.parse(JSON.stringify(origin)), coordinates: 'rendered-source', parameters: initialParameters(), strokes: [], redo: [], results: [], jobs: [] }
      // The replacement becomes visible only after its entire session is durable.
      await saveStudioDraft(next, nextArtifacts)
      mutating = true; document.value = next; mutating = false
      artifacts = nextArtifacts; source.value = nextSource; baseMask.value = nextMask; selected.value = null
      operation.value = sourceOperation
      saveRevision = 0; saveState.value = 'saved'; error.value = ''; initialized = true
      window.dispatchEvent(new Event('imejii:saved-work'))
    } finally { working.value = false; mutating = false }
  }
  async function openFile(file) {
    if (busy.value || drawing.value) throw new Error('Wait for the current Studio operation.')
    const version = ++openVersion
    file = await resolveImageFile(file)
    if (!file || file.size > 128 * 1024 ** 2) throw new Error('Image is too large.')
    const canvas = await decodePhoto(file), hash = await sourceFingerprint(file)
    if (version !== openVersion) return
    await newSource(canvas, file.name, null, { kind: 'file', name: file.name, sha256: hash })
  }
  async function importMask(file) {
    if (!source.value || busy.value || drawing.value) throw new Error('Open a source image and finish the current operation first.')
    const id = document.value.id
    const decoded = await decodePhoto(file)
    if (document.value.id !== id) throw new Error('The source changed while importing the mask. Try again.')
    if (decoded.width !== source.value.width || decoded.height !== source.value.height) throw new Error('Mask must match the source image dimensions exactly.')
    // A new durable session keeps the previous selection available in Saved work.
    await newSource(source.value, document.value.name, alphaFromGrayscale(decoded), { ...document.value.sourceOrigin, maskOrigin: 'opaque-grayscale-png' })
  }
  async function restore(entry) {
    if (busy.value || drawing.value) throw new Error('Wait for the current Studio operation.')
    working.value = true
    try {
      await flush()
      const state = interruptedDocument(entry.state)
      const image = state.source ? await decodePhoto(new File([entry.artifacts.get(state.source)], 'source.png', { type: 'image/png' })) : null
      const initial = state.mask ? await decodePhoto(new File([entry.artifacts.get(state.mask)], 'mask.png', { type: 'image/png' })) : null
      if (image) {
        dimensions(image.width, image.height)
        if (image.width !== state.width || image.height !== state.height || initial.width > 2048 || initial.height > 2048 || !maskMatchesSource(image, initial)) throw new Error('Saved Studio geometry is damaged.')
      }
      for (const result of state.results) {
        const c = await decodePhoto(new File([entry.artifacts.get(result.artifact)], 'result.png', { type: 'image/png' }))
        const width = result.provenance.outputWidth || state.width, height = result.provenance.outputHeight || state.height
        if (c.width !== width || c.height !== height) throw new Error('Saved variant dimensions do not match.')
      }
      mutating = true; document.value = state; mutating = false
      source.value = image; baseMask.value = initial; artifacts = new Map(entry.artifacts); selected.value = state.results.at(-1)?.id || null
      operation.value = state.operation
      saveRevision = -1; initialized = true; touch(); await flush()
    } finally { working.value = false; mutating = false }
  }
  async function initialize() {
    if (initialized || source.value) return
    initialized = true
    const latest = (await listDrafts()).find(entry => entry.kind === 'studio')
    if (latest) {
      const entry = await loadDraft(latest.id)
      if (!source.value && !busy.value) await restore(entry)
    }
  }
  async function connect() {
    if (!window.desktopApi?.aiStudioConnect) throw new Error('Local SDXL requires the Imejii desktop app.')
    if (busy.value || connecting.value) return
    connecting.value = true; connection.value = null
    try {
      connection.value = await window.desktopApi.aiStudioConnect({ host: '127.0.0.1', port: Number(port.value) })
      if (document.value && connection.value.modelAvailable && !connection.value.models.includes(document.value.parameters.model)) document.value.parameters.model = connection.value.defaultModel
    }
    finally { connecting.value = false }
  }
  async function deactivate() {
    if (busy.value || drawing.value || connecting.value) throw new Error('Wait for the current Studio operation before disabling it.')
    await flush(); await window.desktopApi?.aiStudioDisconnect?.(); connection.value = null
  }
  async function run(validate = false) {
    if (busy.value || drawing.value || !hasInput.value) return
    if (!connection.value?.modelAvailable) throw new Error('Connect a local ComfyUI with an SDXL .safetensors checkpoint first.')
    const doc = document.value
    if (doc.results.length >= 8) throw new Error('Eight variants reached. Remove an unwanted variant first.')
    const selectedOperation = operation.value
    // The current masked-latent workflow replaces selected pixels with the VAE's
    // neutral fill. Partial denoising would preserve that fill as a gray patch.
    if (doc.parameters.denoise !== 1) doc.parameters.denoise = 1
    const p = normalizeParameters(JSON.parse(JSON.stringify(doc.parameters)))
    validateParameters(p)
    if (!p.prompt.trim()) throw new Error(selectedOperation === 'text-to-image' ? 'Describe the image to generate.' : selectedOperation === 'outpaint' ? 'Describe what should continue beyond the image.' : 'Describe what should appear in the selected area.')
    const releaseAI = claimAI('SDXL ' + selectedOperation)
    working.value = true; error.value = ''; selected.value = null
    const revision = doc.revision
    const id = crypto.randomUUID()
    const job = { id, documentId: doc.id, revision, sourceSha256: doc.source, parameters: p, state: 'preparing', message: 'Preparing source and selection…', createdAt: new Date().toISOString() }
    job.operation = selectedOperation
    doc.jobs = [...doc.jobs.slice(-19), job]; touch()
    let release
    try {
      let inputSource = null, inputMask = null, prepared = null, maskSha256 = null
      if (selectedOperation === 'inpaint') {
        inputSource = copyCanvas(source.value); inputMask = mask(); prepared = await prepareInpaint(inputSource, inputMask)
      } else if (selectedOperation === 'outpaint') {
        prepared = await prepareOutpaint(copyCanvas(source.value), p.outpaint); inputSource = prepared.source; inputMask = prepared.selection
      }
      if (inputMask) {
        const maskBlob = await canvasToBlob(inputMask, 'png'); maskSha256 = await sourceFingerprint(maskBlob)
        artifacts.set(maskSha256, maskBlob); job.maskSha256 = maskSha256; job.geometry = prepared.geometry
      }
      job.message = selectedOperation === 'text-to-image' ? 'Preparing the SDXL canvas…' : selectedOperation === 'outpaint' ? 'Preparing the expanded canvas…' : 'Preparing source and selection…'
      touch()
      await flush()
      if (job.state === 'canceled') return
      release = window.desktopApi.onAiStudioProgress(progress => {
        if (progress.id !== id || progress.documentId !== doc.id || progress.revision !== revision || job.state === 'canceled') return
        job.state = progress.state; job.message = progress.message; touch()
      })
      pendingBackend.value = true
      const result = await window.desktopApi.aiStudioRun({ id, documentId: doc.id, revision, operation: selectedOperation, parameters: p,
        ...(prepared ? { image: prepared.image, mask: prepared.mask } : {}), validate })
      if (job.state === 'canceled' || result.canceled || document.value.id !== doc.id) return
      const generated = await decodePhoto(new File([result.bytes], 'generated.png', { type: 'image/png' }))
      if (job.state === 'canceled' || document.value.id !== doc.id) return
      const canvas = selectedOperation === 'text-to-image' ? copyCanvas(generated) : composeInpaint(inputSource, inputMask, generated, prepared.geometry)
      const hash = await artifact(canvas)
      if (job.state === 'canceled' || document.value.id !== doc.id) return
      const provenance = { operation: selectedOperation, version: '0.4.0', documentId: doc.id, revision, jobId: id, sourceSha256: doc.source || null, sourceName: doc.source ? doc.name : null, maskSha256,
        outputWidth: canvas.width, outputHeight: canvas.height, geometry: prepared?.geometry || null, outpaint: prepared?.settings || null, placement: prepared?.placement || null,
        parameters: p, provider: result.provider, providerVersion: result.providerVersion, model: result.model, modelSha256: result.modelSha256,
        workflow: result.workflow, workflowSha256: result.workflowSha256, backendJobId: result.backendJobId, elapsedMs: result.elapsedMs, createdAt: new Date().toISOString() }
      doc.results.push({ id, artifact: hash, accepted: false, provenance }); selected.value = id
      job.state = 'succeeded'; job.message = 'Variant ready. Review it before opening it in Images.'
      const pair = { model: p.model, operation: selectedOperation }
      const validatedPairs = result.validatedPairs || [...(connection.value.validatedPairs || []), pair]
      connection.value = { ...connection.value, validationRequired: false, validatedPairs }
    } catch (problem) {
      if (job.state !== 'canceled') { job.state = 'failed'; job.message = problem.message; error.value = problem.message }
    } finally {
      release?.(); releaseAI(); pendingBackend.value = false; working.value = false
      const used = new Set(artifactIds(doc)); for (const hash of artifacts.keys()) if (!used.has(hash)) artifacts.delete(hash)
      touch(); await flush()
    }
  }
  async function cancel() {
    const job = currentJob.value
    if (!job || !busy.value) return
    job.state = 'canceled'; job.message = 'Result acceptance canceled. ComfyUI may continue; waiting for its job to finish before another AI operation.'; touch()
    if (pendingBackend.value) await window.desktopApi.aiStudioCancel(job.id)
  }
  async function resultCanvas() {
    const result = selectedResult.value
    return result ? decodePhoto(new File([artifacts.get(result.artifact)], 'variant.png', { type: 'image/png' })) : null
  }
  function resultURL(result) { return URL.createObjectURL(artifacts.get(result.artifact)) }
  async function exportResult() {
    const result = selectedResult.value
    if (!result) throw new Error('Select a generated variant first. Use Save project to save a mask session.')
    const canvas = await resultCanvas()
    const operation = result.provenance.operation
    const blob = await canvasToBlob(canvas, 'png', 1, {}, { aiModified: operation })
    return saveBlob(blob, slugify(document.value.name) + '-' + operation + '.png')
  }
  async function acceptResult() {
    const result = selectedResult.value
    if (!result || busy.value) return
    working.value = true
    try {
      const library = useLibraryStore(), id = 'photo:' + result.id
      if (result.accepted) {
        const existing = library.items.find(item => item.draftId === id)
        if (existing) { await library.select(existing.id); useUiStore().setMode('images'); return }
        const saved = await loadDraft(id)
        if (!await library.restoreDraft(saved)) throw new Error('Saved variant could not be opened.')
        useUiStore().setMode('images'); return
      }
      const canvas = await resultCanvas()
      const operation = result.provenance.operation
      const blob = await canvasToBlob(canvas, 'png', 1, {}, { aiModified: operation })
      const file = new File([blob], slugify(document.value.name) + '-' + operation + '.png', { type: 'image/png' })
      library.assertCanAddPluginFile(file)
      const state = { edits: library.freshPhotoEdits(), extensions: { 'sdxl-studio': result.provenance } }
      await saveDraft(file, 'photo', state, id)
      if (!await library.restoreDraft({ id, file, state })) throw new Error('Variant saved but could not be opened.')
      result.accepted = true; touch(); await flush(); useUiStore().setMode('images')
    } finally { working.value = false }
  }
  function removeResult(id) {
    if (busy.value) return
    document.value.results = document.value.results.filter(result => result.id !== id)
    const used = new Set(artifactIds(document.value)); for (const hash of artifacts.keys()) if (!used.has(hash)) artifacts.delete(hash)
    if (selected.value === id) selected.value = null
    touch()
  }
  async function exportProject() {
    if (!document.value) return
    return saveBlob(await studioProjectBlob(JSON.parse(JSON.stringify(document.value)), new Map(artifacts)), slugify(document.value.name) + '-studio.imejii')
  }
  return { document, source, baseMask, selected, selectedResult, compare, busy, pendingBackend, drawing, saveState, dirty, error, connection, connecting, port, currentJob, operation,
    hasSource, hasDocument, hasInput, validationRequired, canUndo, canRedo, mask, addStroke, undo, redo, clearMask, flush, newTextDocument, setOperation, newSource, openFile, importMask, restore, initialize, connect, deactivate, run, cancel,
    resultCanvas, resultURL, exportResult, acceptResult, removeResult, exportProject }
})
