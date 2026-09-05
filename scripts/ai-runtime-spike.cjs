const path = require('node:path')
const ort = require('onnxruntime-web')
const { createModelManager } = require('../electron/ai-models.cjs')
async function main() {
  const manager = createModelManager({ root: path.resolve(__dirname, '../build/ai-models') })
  ort.env.wasm.numThreads = 1
  console.time('model')
  const session = await ort.InferenceSession.create(await manager.read('lama-v1'), { executionProviders: ['wasm'] })
  console.timeEnd('model')
  console.log(session.inputNames, session.outputNames, session.inputMetadata, session.outputMetadata)
  const area = 512 * 512, input = new Float32Array(area * 3).fill(0.7), mask = new Float32Array(area)
  for (let y = 220; y < 292; y++) for (let x = 220; x < 292; x++) { mask[y * 512 + x] = 1; for (let c = 0; c < 3; c++) input[c * area + y * 512 + x] = 0 }
  console.time('inference')
  const result = await session.run({ image: new ort.Tensor('float32', input, [1, 3, 512, 512]), mask: new ort.Tensor('float32', mask, [1, 1, 512, 512]) })
  console.timeEnd('inference')
  console.log('output', result.output.dims, Array.from(result.output.data.slice(256 * 512 + 256, 256 * 512 + 260)))
  await session.release()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
