<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { isDesktop, confirmDiscard } from '../lib/desktop.js'
import { createPhotoHost, pluginActivity } from './host.js'
import AppButton from '../components/ui/AppButton.vue'

const props = defineProps({ manifest: { type: Object, required: true }, license: { type: String, required: true } })
const host = createPhotoHost(props.manifest), model = props.manifest.model
const state = ref('checking'), received = ref(0), error = ref(''), busy = ref(false), busyWith = ref(null)
const source = shallowRef(null), size = Math.round(model.bytes / 1e6) + ' MB'
let disposed = false, releaseProgress = null, refreshTimer = null
const downloading = computed(() => ['downloading', 'verifying', 'checking-download'].includes(state.value))
const percent = computed(() => Math.min(100, Math.floor(received.value / model.bytes * 100)))
const blocked = computed(() => busy.value || Boolean(busyWith.value) || pluginActivity.active)
async function refresh() {
  if (!isDesktop) { state.value = 'unavailable'; return }
  try {
    const result = await window.desktopApi.aiModelStatus(model.id)
    if (!disposed) { state.value = result.state; busyWith.value = result.busyWith || null }
  } catch (err) { if (!disposed) { error.value = err.message; state.value = 'missing' } }
}
async function install() {
  if (blocked.value || downloading.value) return
  error.value = ''; state.value = 'checking-download'; received.value = 0
  try { await window.desktopApi.aiModelInstall(model.id); if (!disposed) state.value = 'ready' }
  catch (err) { if (!disposed) { error.value = err.message; await refresh() } }
}
async function remove() {
  if (blocked.value || downloading.value) return
  busy.value = true; error.value = ''
  try {
    if (!await confirmDiscard(`Remove the downloaded ${model.name} model (${size})? Your photos and saved results are kept.`)) return
    await window.desktopApi.aiModelRemove(model.id); if (!disposed) state.value = 'missing'
  } catch (err) { if (!disposed) error.value = err.message }
  finally { busy.value = false }
}
async function start() {
  if (blocked.value || state.value !== 'ready') return
  busy.value = true; error.value = ''
  try { const captured = await host.capture(); if (!disposed) source.value = captured }
  catch (err) { if (!disposed) error.value = err.message }
  finally { busy.value = false }
}
function close() { source.value = null; host.release() }
function cancelDownload() { void window.desktopApi.aiModelCancel(model.id).catch(err => { error.value = err.message }) }
onMounted(() => {
  if (isDesktop) releaseProgress = window.desktopApi.onAiModelProgress(event => {
    if (disposed) return
    if (event.id !== model.id) {
      busyWith.value = ['ready', 'error'].includes(event.state) ? null : event.id
      return
    }
    state.value = event.state === 'checking' ? 'checking-download' : event.state
    received.value = event.received || 0
    if (event.state === 'error') {
      error.value = event.error
      clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 100)
    }
  })
  void refresh()
})
onBeforeUnmount(() => {
  disposed = true; releaseProgress?.(); clearTimeout(refreshTimer)
  if (downloading.value) void window.desktopApi.aiModelCancel(model.id).catch(() => {})
  host.release()
})
</script>

<template>
  <div class="local-model-panel">
    <div class="model-heading"><span class="status-dot" :class="{ ready: state === 'ready' }" /><strong>{{ model.name }}</strong><span>LOCAL</span></div>
    <p v-if="manifest.requirements && state !== 'unavailable'" class="note">{{ manifest.requirements }}</p>
    <p v-if="state === 'unavailable'">Local AI processing is available in the desktop app. Saved results still open here without the plugin.</p>
    <template v-else-if="state === 'ready'">
      <p>Model verified · ready offline.<br>No photo uploads, account or API key.</p>
      <AppButton variant="primary" :icon="manifest.icon" :disabled="blocked" @click="start">{{ busy ? 'Preparing photo…' : manifest.action }}</AppButton>
      <p class="note">{{ manifest.guidance }} Full-resolution result; photos up to 24 MP.</p>
      <button type="button" class="text-button" :disabled="blocked" @click="remove">Remove downloaded model · {{ size }}</button>
    </template>
    <template v-else-if="downloading">
      <p role="status">{{ state === 'downloading' ? `Downloading model · ${percent}%` : 'Checking model integrity…' }}</p>
      <progress :value="received" :max="model.bytes" aria-label="Model download" />
      <AppButton variant="ghost" @click="cancelDownload">Cancel download</AppButton>
    </template>
    <p v-else-if="state === 'checking'" role="status">Checking local model…</p>
    <template v-else>
      <p v-if="state === 'corrupt'">The cached model failed verification. Download a fresh copy to repair it.</p>
      <p>One-time download from Hugging Face: <strong>{{ size }}</strong>. Model license: {{ model.license }}. Photos never leave this device.</p>
      <AppButton variant="primary" icon="download" :disabled="blocked" @click="install">Download model · {{ size }}</AppButton>
      <p class="note">The download contacts Hugging Face and its CDN. Afterwards, processing works offline. CPU processing can take tens of seconds or longer.</p>
    </template>
    <p v-if="busyWith" role="status">Another model operation is in progress. Please wait.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <details><summary>Model details &amp; license</summary><p>{{ manifest.attribution }} Runtime: {{ manifest.runtime || 'ONNX Runtime Web 1.29.0 (MIT)' }}.</p><p class="mono">Revision: {{ model.revision }}<br>SHA-256: {{ model.sha256 }}</p><p class="mono">{{ model.modelCard }}</p><pre class="license">{{ license }}</pre></details>
    <slot v-if="source" name="workspace" :source="source" :host="host" :close="close" />
  </div>
</template>

<style scoped>
.local-model-panel { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border); }
.model-heading { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.model-heading > span:last-child { margin-left: auto; font-size: 9px; letter-spacing: .1em; color: var(--text-subtle); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-subtle); }
.status-dot.ready { background: var(--success); }
p { color: var(--text-muted); font-size: 12px; line-height: 1.65; margin: 12px 0; }
.note, details { color: var(--text-subtle); font-size: 11px; }
.text-button { border: 0; background: transparent; color: var(--text-muted); font-size: 11px; padding: 8px 0; text-align: left; }
.text-button:hover { color: var(--text); }
progress { width: 100%; accent-color: var(--accent); margin-bottom: 12px; }
.error { color: var(--danger); overflow-wrap: anywhere; }
details { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px; }
summary { cursor: pointer; }
.mono { font-family: var(--font-mono); font-size: 9px; overflow-wrap: anywhere; }
.license { font-size: 9px; white-space: pre-wrap; max-height: 250px; overflow: auto; background: var(--bg-input); padding: 8px; }
button:disabled { opacity: .4; cursor: not-allowed; }
</style>
