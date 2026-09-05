import * as ort from 'onnxruntime-web/wasm'
import wasmURL from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import mjsURL from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'

ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = { wasm: wasmURL, mjs: mjsURL }
let session = null
self.onmessage = async ({ data }) => {
  const { id, model, image, mask } = data
  try {
    if (!session) {
      self.postMessage({ id, phase: 'Loading local model…' })
      session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    }
    self.postMessage({ id, phase: 'Reconstructing background…' })
    const inputs = { image: new ort.Tensor('float32', image, [1, 3, 512, 512]), mask: new ort.Tensor('float32', mask, [1, 1, 512, 512]) }
    const outputs = await session.run(inputs)
    const output = new Float32Array(outputs.output.data)
    for (const tensor of Object.values(inputs)) tensor.dispose()
    for (const tensor of Object.values(outputs)) tensor.dispose()
    self.postMessage({ id, output }, [output.buffer])
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }) }
}
