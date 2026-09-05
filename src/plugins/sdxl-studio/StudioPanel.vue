<script setup>
import AppButton from '../../components/ui/AppButton.vue'
import { useUiStore } from '../../stores/ui.js'
const ui = useUiStore()
</script>
<template>
  <div class="studio-setup">
    <p>Inpainting has its own workspace. Connect a local ComfyUI instance there. Enabling this plugin downloads no runtime or model.</p>
    <AppButton icon="wand" variant="primary" @click="ui.setMode('ai-studio')">Open AI Studio</AppButton>
  </div>
</template>
<style scoped>
.studio-setup { margin-top: 14px; } p { font-size: 12px; color: var(--text-muted); line-height: 1.6; margin-bottom: 12px; }
</style>
