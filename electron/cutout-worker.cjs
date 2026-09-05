// One inference per process; the parent kills it after success, cancellation,
// timeout or failure. This returns large native activation allocations to the OS.
const ort = require('onnxruntime-node')
const { availableParallelism } = require('node:os')
ort.env.logLevel = 'error'
process.parentPort.once('message', async ({ data: { model, image } }) => {
  let session, input, outputs
  try {
    process.parentPort.postMessage({ phase: 'loading' })
    session = await ort.InferenceSession.create(new Uint8Array(model), {
      executionProviders: ['cpu'], graphOptimizationLevel: 'all', executionMode: 'sequential',
      intraOpNumThreads: Math.max(1, Math.min(4, availableParallelism() - 1)), interOpNumThreads: 1,
      enableCpuMemArena: false, enableMemPattern: false,
    })
    process.parentPort.postMessage({ phase: 'inference' })
    input = new ort.Tensor('float32', image, [1, 3, 1024, 1024])
    outputs = await session.run({ input_image: input })
    const tensor = outputs.output_image
    if (!tensor || tensor.type !== 'float32' || tensor.dims.join(',') !== '1,1,1024,1024') throw new Error('Unexpected output')
    process.parentPort.postMessage({ output: new Float32Array(tensor.data) })
  } catch (error) {
    process.parentPort.postMessage({ error: /memory|bad_alloc|allocation/i.test(error.message) ? 'memory' : 'inference' })
  } finally {
    input?.dispose()
    if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose()
    await session?.release()
  }
})
