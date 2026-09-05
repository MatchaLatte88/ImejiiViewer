import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const seen = new Set(), notices = []
async function visit(name, from) {
  const require = createRequire(path.join(from, 'package.json'))
  let dir
  for (const base of require.resolve.paths(name + '/package.json') || []) {
    const candidate = path.join(base, name)
    try { await fs.access(path.join(candidate, 'package.json')); dir = candidate; break } catch { /* continue */ }
  }
  if (!dir) throw new Error('Missing production dependency: ' + name)
  const metadata = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
  const key = metadata.name + '@' + metadata.version
  if (seen.has(key)) return
  seen.add(key)
  const licenses = (await fs.readdir(dir)).filter(file => /^(licen[sc]e|copying|notice)(\.|$)/i.test(file))
  let text = key + '\nLicense: ' + metadata.license + '\n'
  const onnx = ['onnxruntime-web@1.29.0', 'onnxruntime-common@1.29.0', 'onnxruntime-node@1.29.0'].includes(key)
  if (onnx) text += '\n' + await fs.readFile(path.join(root, 'licenses/ONNXRuntime-1.29.0-MIT.txt'), 'utf8')
  if (!licenses.length && !onnx) {
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8').catch(() => '')
    const section = readme.match(/^#+ License\s*$[\s\S]*/im)?.[0]
    if (!section || !section.includes('Permission is hereby granted')) throw new Error('No complete license text found for ' + key + '. Review before distribution.')
    text += '\n' + section
  }
  for (const file of licenses) {
    const target = path.join(dir, file)
    if ((await fs.stat(target)).isFile()) text += '\n' + await fs.readFile(target, 'utf8')
  }
  notices.push(text)
  if (key === 'onnxruntime-web@1.29.0') {
    // We distribute the prebuilt WASM-only entry, not the WebGL/ONNX.js bundle
    // or node_modules. Its source map contains only ORT common/web code. The
    // WebGL-only guid-typescript/protobufjs/etc dependencies are not shipped.
    // Fail closed if any reviewed runtime asset changes; review this inventory
    // and the upstream notices before upgrading or importing another entry.
    const reviewed = {
      'ort.wasm.bundle.min.mjs': '7a3913dc5c7a9c3ad1144f5fbfecd402bc5013bcc886bc67664b18d8a15ab298',
      'ort-wasm-simd-threaded.mjs': '5a15f1fd086b3f6c2baf1f35105b8f502653b567e165cef80028870b39748747',
      'ort-wasm-simd-threaded.wasm': 'ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d',
    }
    for (const [file, expected] of Object.entries(reviewed)) {
      const actual = createHash('sha256').update(await fs.readFile(path.join(dir, 'dist', file))).digest('hex')
      if (actual !== expected) throw new Error('ONNX runtime changed; review third-party inventory before distribution.')
    }
    await visit('onnxruntime-common', dir)
  } else if (key === 'onnxruntime-node@1.29.0') {
    // Only CPU binaries + runtime JS are shipped. adm-zip/global-agent are
    // install-time download tools, absent from the production package.
    const reviewed = {
      'onnxruntime_binding.node': 'b99d6e63a8f84580e3321fbe7c7604ea3fdd584bb1d27b4c3e324ee8f6b187aa',
      'onnxruntime.dll': '5e289b5494cc338d62806f2d24c24aa7cc09a00bbab0404d9169487a45e0053a',
    }
    for (const [file, expected] of Object.entries(reviewed)) {
      if (createHash('sha256').update(await fs.readFile(path.join(dir, 'bin/napi-v6/win32/x64', file))).digest('hex') !== expected) throw new Error('Native ONNX runtime changed; review its inventory before distribution.')
    }
    await visit('onnxruntime-common', dir)
  } else for (const dependency of Object.keys(metadata.dependencies || {})) await visit(dependency, dir)
}
for (const dependency of Object.keys(pkg.dependencies)) await visit(dependency, root)
notices.push('ONNX Runtime 1.29.0 — upstream third-party notices\nhttps://github.com/microsoft/onnxruntime/tree/v1.29.0\nThe full upstream notice is included; some components are not used by the WebAssembly build.\n\n' + await fs.readFile(path.join(root, 'licenses/ONNXRuntime-1.29.0-ThirdPartyNotices.txt'), 'utf8'))
notices.push('Compact ICC Profiles — CC0-1.0\nhttps://github.com/saucecontrol/Compact-ICC-Profiles\nsRGB-v4.icc and DisplayP3-v4.icc; derived BT.709 profile in Imejii.\nhttps://creativecommons.org/publicdomain/zero/1.0/legalcode')
notices.push('Optional BiRefNet Lite background-removal model — MIT\nBiRefNet by Peng Zheng and contributors; ONNX conversion by ONNX Community.\nhttps://github.com/ZhengPeng7/BiRefNet\nhttps://huggingface.co/ZhengPeng7/BiRefNet_lite\nhttps://huggingface.co/onnx-community/BiRefNet_lite-ONNX\nModel weights are downloaded only on explicit request, not bundled.\nRevision de15b22ba131738a16dff04aab8bdf8dc32e3ac1 / onnx/model.onnx\nSHA-256 5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333\n\n' + await fs.readFile(path.join(root, 'licenses/BiRefNet-MIT.txt'), 'utf8'))
notices.push('Optional LaMa inpainting model — Apache-2.0\nLaMa by Roman Suvorov and contributors; ONNX conversion by Carve.Photos.\nhttps://github.com/advimman/lama\nhttps://github.com/Carve-Photos/lama\nhttps://huggingface.co/Carve/LaMa-ONNX\nModel weights are downloaded only on explicit request, not bundled.\nRevision c3c0c9e468934d62e79c329e35d82dd09ff8c444 / lama_fp32.onnx\nSHA-256 1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6\n\n' + await fs.readFile(path.join(root, 'licenses/LaMa-Apache-2.0.txt'), 'utf8'))
notices.push('HEIC codec notice\nheic-to 1.5.2 includes libheif 1.22.2 and libde265 (build instructions specify 1.0.16).\nhttps://github.com/hoppergee/heic-to\nhttps://github.com/strukturag/libheif\nhttps://github.com/strukturag/libde265\nSee docs/PHOTO-FEATURES.md for the required pre-distribution source/license/recombination review. This generated notice is not that review.')
await fs.mkdir(path.join(root, 'build'), { recursive: true })
await fs.writeFile(path.join(root, 'build/THIRD_PARTY_NOTICES.txt'),
  'Imejii third-party notices\nGenerated from the installed, lockfile-pinned production dependencies.\nElectron and Chromium licenses are included separately with the runtime.\n\n' + notices.sort().join('\n\n' + '='.repeat(72) + '\n\n'))
console.log('Collected licenses for ' + seen.size + ' production packages and ' + (notices.length - seen.size) + ' additional notices.')
