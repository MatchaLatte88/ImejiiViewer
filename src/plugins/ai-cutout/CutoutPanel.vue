<script setup>
import { onBeforeUnmount, shallowRef } from 'vue'
import { manifest } from './manifest.js'
import LocalModelPanel from '../LocalModelPanel.vue'
import CutoutWorkspace from './CutoutWorkspace.vue'
import RemovalWorkspace from '../ai-remove/RemovalWorkspace.vue'
import license from '../../../licenses/BiRefNet-MIT.txt?raw'
const transfer = shallowRef(null)
function releaseTransfer() { transfer.value?.host.release(); transfer.value = null }
function finish(close) { releaseTransfer(); close() }
onBeforeUnmount(releaseTransfer)
</script>
<template>
  <LocalModelPanel :manifest="manifest" :license="license">
    <template #workspace="{ source, host, close }">
      <RemovalWorkspace v-if="transfer" :source="transfer.source" :host="transfer.host" @close="finish(close)" />
      <CutoutWorkspace v-else :source="source" :host="host" @close="close" @handoff="transfer = $event" />
    </template>
  </LocalModelPanel>
</template>
