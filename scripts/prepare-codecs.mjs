import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The LGPL decoder stays a separate, replaceable asset. Extract the already-built
// CSP-safe worker literal without evaluating any package code or weakening CSP.
const source = await fs.readFile(path.join(root, 'node_modules/heic-to/dist/csp/heic-to.js'), 'utf8')
const candidates = []
for (let i = 0; i < source.length; i++) {
  if (source[i] !== '"' && source[i] !== "'") continue
  const quote = source[i], start = i++
  for (; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (source[i] === quote) break
  }
  if (i - start < 100000) continue
  const value = source.slice(start + 1, i).replace(/\\(?:x([\da-fA-F]{2})|u([\da-fA-F]{4})|([^]))/g, (_match, hex, unicode, character) => {
    if (hex || unicode) return String.fromCharCode(parseInt(hex || unicode, 16))
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[character] ?? character
  })
  if (value.includes('HeifDecoder') && value.includes('onmessage=')) candidates.push(value)
}
if (candidates.length !== 1) throw new Error('HEIC package layout changed; review the decoder build before proceeding.')
const target = path.join(root, 'src/generated')
await fs.mkdir(target, { recursive: true })
await fs.writeFile(path.join(target, 'heic-worker.js'), '// heic-to 1.5.2 / libheif 1.22.2 / libde265 — LGPL-3.0; see THIRD_PARTY_NOTICES.\n' + candidates[0])
console.log('Prepared standalone CSP-safe HEIC decoder.')
