// Explicit opt-in: npm run test:ai:download. Never called by build/install/test.
const path = require('node:path')
const { createModelManager } = require('../electron/ai-models.cjs')
let last = ''
const manager = createModelManager({ root: path.resolve(__dirname, '../build/ai-models'), notify: event => {
  const line = event.state + (event.total ? ' ' + Math.floor(event.received / event.total * 100) + '%' : '')
  if (line !== last) { console.log(line); last = line }
} })
manager.install(process.argv[2] || 'lama-v1').catch(error => { console.error(error.message); process.exitCode = 1 })
