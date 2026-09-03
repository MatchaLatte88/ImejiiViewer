import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackage } from '@electron/asar'
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'release/win-unpacked')
const executable = path.join(output, 'Imejii.exe')
const archive = path.join(output, 'resources/app.asar')
const entries = listPackage(archive).map(name => name.replaceAll('\\', '/'))
assert.ok(entries.includes('/electron/main.cjs') && entries.includes('/electron/preload.cjs') && entries.includes('/dist/index.html'))
assert.ok(entries.every(name => /^\/(?:dist|electron|package\.json)(?:\/|$)/.test(name)), 'Unexpected non-production file in ASAR')
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
const result = { status: 'PASS', entries, fuses: expected, sha256: { exe: await hash(executable), asar: await hash(archive) } }
console.log(JSON.stringify(result, null, 2))
if (process.env.IMEJII_REPORT_DIR) await fs.writeFile(path.join(process.env.IMEJII_REPORT_DIR, 'package-results-fixed.json'), JSON.stringify(result, null, 2))
