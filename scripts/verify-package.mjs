import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackage } from '@electron/asar'
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(root, process.env.IMEJII_PACKAGE_DIR || 'release/win-unpacked')
const executable = path.join(output, 'Imejii.exe')
const archive = path.join(output, 'resources/app.asar')
const entries = listPackage(archive).map(name => name.replaceAll('\\', '/'))
assert.ok(entries.includes('/electron/main.cjs') && entries.includes('/electron/preload.cjs') && entries.includes('/dist/index.html'))
const nativeEntry = name => /^\/node_modules\/(?:onnxruntime-node|onnxruntime-common)(?:\/|$)/.test(name) || name === '/node_modules'
assert.ok(entries.every(name => /^\/(?:dist|electron|shared|package\.json)(?:\/|$)/.test(name) || nativeEntry(name)), 'Unexpected non-production file in ASAR')
assert.ok(entries.includes('/node_modules/onnxruntime-node/dist/index.js') && entries.includes('/node_modules/onnxruntime-common/dist/cjs/index.js'), 'Native cutout runtime JS missing')
assert.ok(!entries.some(name => /\.(?:map|ts)$/.test(name) && nativeEntry(name)), 'Development runtime files must not be shipped')
assert.ok(entries.includes('/shared/ai-models.json'), 'Pinned AI model catalog missing')
assert.ok(entries.some(name => /ort-wasm-simd-threaded-.*\.wasm$/.test(name)), 'Offline AI runtime missing')
assert.ok(entries.some(name => /\/dist\/assets\/studio\.worker-.*\.js$/.test(name)), 'Subject Studio composition worker missing')
assert.ok(entries.includes('/electron/sdxl.cjs') && entries.some(name => /\/dist\/assets\/StudioWorkspace-.*\.js$/.test(name)), 'SDXL broker/workspace missing')
assert.ok(!entries.some(name => /\.(?:safetensors|gguf|ckpt)$/.test(name)), 'SDXL weights must not be bundled implicitly')
assert.ok(!entries.some(name => name.endsWith('.onnx')), 'Model weights must not be bundled implicitly')
const fuses = await getCurrentFuseWire(executable)
const expected = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: false,
}
for (const [name, enabled] of Object.entries(expected)) assert.equal(fuses[FuseV1Options[name]], enabled ? 49 : 48, name)
await fs.access(path.join(output, 'resources/THIRD_PARTY_NOTICES.txt'))
await fs.access(path.join(output, 'LICENSE.electron.txt'))
await fs.access(path.join(output, 'LICENSES.chromium.html'))
async function hash(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
const nativeRoot = 'node_modules/onnxruntime-node/bin/napi-v6/win32/x64/'
const nativeHashes = {
  'onnxruntime_binding.node': 'b99d6e63a8f84580e3321fbe7c7604ea3fdd584bb1d27b4c3e324ee8f6b187aa',
  'onnxruntime.dll': '5e289b5494cc338d62806f2d24c24aa7cc09a00bbab0404d9169487a45e0053a',
}
for (const [file, expectedHash] of Object.entries(nativeHashes)) {
  assert.ok(entries.includes('/' + nativeRoot + file), 'Native CPU binary missing: ' + file)
  assert.equal(await hash(path.join(archive + '.unpacked', nativeRoot, file)), expectedHash, 'Native binary integrity: ' + file)
}
assert.ok(!entries.some(name => nativeEntry(name) && /\.(?:node|dll)$/.test(name) && !Object.keys(nativeHashes).some(file => name === '/' + nativeRoot + file)), 'Unexpected native/GPU binary')
const result = { status: 'PASS', entries, fuses: expected, sha256: { exe: await hash(executable), asar: await hash(archive) } }
console.log(JSON.stringify(result, null, 2))
if (process.env.IMEJII_TEST_REPORT) await fs.writeFile(process.env.IMEJII_TEST_REPORT, JSON.stringify(result, null, 2))
if (process.env.IMEJII_REPORT_DIR) await fs.writeFile(path.join(process.env.IMEJII_REPORT_DIR, 'package-results-fixed.json'), JSON.stringify(result, null, 2))
