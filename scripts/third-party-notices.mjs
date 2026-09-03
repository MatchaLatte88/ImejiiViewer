import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
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
  if (!licenses.length) {
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
  for (const dependency of Object.keys(metadata.dependencies || {})) await visit(dependency, dir)
}
for (const dependency of Object.keys(pkg.dependencies)) await visit(dependency, root)
await fs.mkdir(path.join(root, 'build'), { recursive: true })
await fs.writeFile(path.join(root, 'build/THIRD_PARTY_NOTICES.txt'),
  'Imejii third-party notices\nGenerated from the installed, lockfile-pinned production dependencies.\nElectron and Chromium licenses are included separately with the runtime.\n\n' + notices.sort().join('\n\n' + '='.repeat(72) + '\n\n'))
console.log('Collected licenses for ' + notices.length + ' production packages.')
