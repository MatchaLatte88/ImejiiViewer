<script setup>
import { manifest } from './manifest.js'
import LocalModelPanel from '../LocalModelPanel.vue'
import RemovalWorkspace from './RemovalWorkspace.vue'
import license from '../../../licenses/LaMa-Apache-2.0.txt?raw'
</script>
<template>
  <LocalModelPanel :manifest="manifest" :license="license">
    <template #workspace="{ source, host, close }"><RemovalWorkspace :source="source" :host="host" @close="close" /></template>
  </LocalModelPanel>
</template>
