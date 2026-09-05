// Original bytes and edit recipes are stored separately; repeated autosaves never
// re-encode a photo or rewrite its original. No paths or native grants are persisted.
import { validateStudioDocument, artifactIds, STUDIO_LIMIT, ARTIFACT_LIMIT, HASH } from './studioDocument.js'
const DB_NAME = 'imejii-workbench'
const MAX_BYTES = 2 * 1024 ** 3
let database
let queue = Promise.resolve()
const fingerprints = new WeakMap()
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      for (const name of ['sources', 'drafts', 'artifacts']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' })
    }
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null }; resolve(request.result) }
    request.onerror = () => { database = null; reject(request.error) }
    request.onblocked = () => { database = null; reject(new Error('Close other Imejii windows to access saved edits.')) }
  })
  return database
}
function requestValue(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
}
function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Saving was interrupted.'))
  })
}
export async function sourceFingerprint(file) {
  if (!fingerprints.has(file)) fingerprints.set(file, (async () => {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
  })())
  return fingerprints.get(file)
}
export async function listDrafts() {
  const db = await open()
  return (await requestValue(db.transaction('drafts').objectStore('drafts').getAll())).sort((a, b) => b.updated - a.updated)
}
export function saveDraft(file, kind, state, draftId = null) {
  const snapshot = JSON.parse(JSON.stringify(state))
  const work = queue.then(async () => {
    if (!(file instanceof Blob) || !file.size || file.size > 128 * 1024 ** 2) throw new Error('Original cannot be saved: invalid file size.')
    if (!['photo', 'logo'].includes(kind) || JSON.stringify(snapshot).length > 2 * 1024 ** 2) throw new Error('Edit recipe exceeds the local-save limit.')
    const hash = await sourceFingerprint(file), id = draftId || kind + ':' + hash
    if (typeof id !== 'string' || !id.startsWith(kind + ':') || !/^[a-z0-9:-]{1,100}$/i.test(id)) throw new Error('Invalid saved-work identifier.')
    const db = await open()
    const [drafts, sources, artifacts] = await Promise.all([
      listDrafts(), requestValue(db.transaction('sources').objectStore('sources').getAll()),
      requestValue(db.transaction('artifacts').objectStore('artifacts').getAll()),
    ])
    const exists = sources.some(source => source.id === hash)
    if (!drafts.some(draft => draft.id === id) && drafts.length >= 100) throw new Error('100 saved edits reached. Remove older saved work before saving more.')
    if (!exists && sources.reduce((sum, source) => sum + source.file.size, 0) + artifacts.reduce((sum, artifact) => sum + artifact.blob.size, 0) + file.size > MAX_BYTES) throw new Error('Saved originals and Studio artifacts exceed 2 GiB. Remove older saved work before saving more.')
    const transaction = db.transaction(['sources', 'drafts'], 'readwrite', { durability: 'strict' })
    const done = completed(transaction)
    if (!exists) transaction.objectStore('sources').put({ id: hash, file: new File([file], file.name || 'image', { type: file.type, lastModified: file.lastModified }) })
    transaction.objectStore('drafts').put({ id, hash, kind, version: 1, name: file.name || 'image', updated: Date.now(), state: snapshot })
    await done
    return id
  })
  queue = work.catch(() => {})
  return work
}
export async function loadDraft(id) {
  const db = await open()
  const draft = await requestValue(db.transaction('drafts').objectStore('drafts').get(id))
  if (draft?.kind === 'studio') {
    validateStudioDocument(draft.state)
    const artifacts = new Map()
    for (const hash of artifactIds(draft.state)) {
      const entry = await requestValue(db.transaction('artifacts').objectStore('artifacts').get(hash))
      if (!(entry?.blob instanceof Blob) || await sourceFingerprint(entry.blob) !== hash) throw new Error('A Studio artifact is missing or damaged.')
      artifacts.set(hash, entry.blob)
    }
    return { ...draft, artifacts }
  }
  if (!draft || draft.version !== 1 || !['photo', 'logo'].includes(draft.kind)) throw new Error('Saved work is missing or from an unsupported version.')
  const source = await requestValue(db.transaction('sources').objectStore('sources').get(draft.hash))
  if (!(source?.file instanceof Blob) || await sourceFingerprint(source.file) !== draft.hash) throw new Error('The saved original is missing or damaged.')
  return { ...draft, file: new File([source.file], draft.name, { type: source.file.type, lastModified: source.file.lastModified }) }
}
export function deleteDraft(id) {
  const work = queue.then(async () => {
    const db = await open(), transaction = db.transaction(['sources', 'drafts', 'artifacts'], 'readwrite', { durability: 'strict' })
    const done = completed(transaction), drafts = transaction.objectStore('drafts'), sources = transaction.objectStore('sources')
    const lookup = drafts.get(id)
    lookup.onsuccess = () => {
      const draft = lookup.result
      if (!draft) return
      drafts.delete(id)
      const siblings = drafts.getAll()
      siblings.onsuccess = () => {
        if (draft.hash && !siblings.result.some(item => item.hash === draft.hash)) sources.delete(draft.hash)
        const used = new Set(siblings.result.filter(item => item.kind === 'studio').flatMap(item => artifactIds(item.state)))
        if (draft.kind === 'studio') for (const hash of artifactIds(draft.state)) if (!used.has(hash)) transaction.objectStore('artifacts').delete(hash)
      }
    }
    await done
  })
  queue = work.catch(() => {})
  return work
}

// A bounded binary envelope, not ZIP: no decompression bombs or base64 overhead.
const PROJECT_MAGIC = new TextEncoder().encode('IMEJII01')
export async function projectBlob(file, kind, state) {
  const header = new TextEncoder().encode(JSON.stringify({ version: 1, kind, name: file.name, type: file.type,
    lastModified: file.lastModified, hash: await sourceFingerprint(file), state }))
  if (header.length > 2 * 1024 ** 2 || !file.size || file.size > 128 * 1024 ** 2) throw new Error('Project exceeds the size limit.')
  const prefix = new Uint8Array(12); prefix.set(PROJECT_MAGIC); new DataView(prefix.buffer).setUint32(8, header.length)
  return new Blob([prefix, header, file], { type: 'application/x-imejii-project' })
}
export async function readProject(blob) {
  if (await blob.slice(0, 8).text() === 'IMEJII02') return readStudioProject(blob)
  if (blob.size < 14 || blob.size > 130 * 1024 ** 2 + 12) throw new Error('Invalid project size.')
  const prefix = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  if (!PROJECT_MAGIC.every((byte, i) => byte === prefix[i])) throw new Error('Not an Imejii project.')
  const length = new DataView(prefix.buffer).getUint32(8)
  if (length > 2 * 1024 ** 2 || length + 12 >= blob.size) throw new Error('Invalid project header.')
  const header = JSON.parse(await blob.slice(12, 12 + length).text())
  if (header.version !== 1 || !['photo', 'logo'].includes(header.kind) || !header.state || typeof header.state !== 'object' || typeof header.name !== 'string' || header.name.length > 255) throw new Error('Unsupported or damaged project.')
  const file = new File([blob.slice(12 + length)], header.name, { type: typeof header.type === 'string' ? header.type : '', lastModified: Number.isFinite(header.lastModified) ? header.lastModified : 0 })
  if (file.size > 128 * 1024 ** 2 || await sourceFingerprint(file) !== header.hash) throw new Error('Project original is damaged (checksum mismatch).')
  return { ...header, id: header.kind + ':' + crypto.randomUUID(), file }
}

export function saveStudioDraft(document, artifactMap) {
  const state = JSON.parse(JSON.stringify(validateStudioDocument(document))), blobs = new Map(artifactMap)
  const work = queue.then(async () => {
    const ids = artifactIds(state)
    let bytes = 0
    for (const hash of ids) {
      const blob = blobs.get(hash)
      if (!(blob instanceof Blob) || !blob.size || blob.size > ARTIFACT_LIMIT || blob.type !== 'image/png' || await sourceFingerprint(blob) !== hash) throw new Error('Invalid Studio artifact.')
      bytes += blob.size
    }
    if (bytes > STUDIO_LIMIT) throw new Error('Studio session exceeds 384 MiB. Remove variants first.')
    const db = await open()
    const [drafts, artifacts, sources] = await Promise.all(['drafts', 'artifacts', 'sources'].map(name => requestValue(db.transaction(name).objectStore(name).getAll())))
    const id = 'studio:' + state.id, previous = drafts.find(entry => entry.id === id)
    if (!previous && drafts.length >= 100) throw new Error('100 saved edits reached. Remove older saved work first.')
    const used = new Set([...drafts.filter(entry => entry.kind === 'studio' && entry.id !== id).flatMap(entry => artifactIds(entry.state)), ...ids])
    const retained = artifacts.filter(entry => used.has(entry.id)), known = new Set(retained.map(entry => entry.id))
    const total = sources.reduce((n, entry) => n + entry.file.size, 0) + retained.reduce((n, entry) => n + entry.blob.size, 0) + ids.filter(hash => !known.has(hash)).reduce((n, hash) => n + blobs.get(hash).size, 0)
    if (total > MAX_BYTES) throw new Error('Saved work exceeds 2 GiB. Delete older saved copies first.')
    const tx = db.transaction(['drafts', 'artifacts'], 'readwrite', { durability: 'strict' }), done = completed(tx)
    for (const hash of ids) if (!known.has(hash)) tx.objectStore('artifacts').put({ id: hash, blob: blobs.get(hash) })
    if (previous) for (const hash of artifactIds(previous.state)) if (!used.has(hash)) tx.objectStore('artifacts').delete(hash)
    tx.objectStore('drafts').put({ id, kind: 'studio', version: 1, name: state.name, updated: Date.now(), state })
    await done
    return id
  })
  queue = work.catch(() => {})
  return work
}

export async function studioProjectBlob(document, artifacts) {
  const state = validateStudioDocument(document), ids = artifactIds(state), parts = []
  const entries = []
  for (const hash of ids) {
    const blob = artifacts.get(hash)
    if (!(blob instanceof Blob) || !blob.size || blob.size > ARTIFACT_LIMIT || await sourceFingerprint(blob) !== hash) throw new Error('Invalid project artifact.')
    entries.push({ hash, size: blob.size }); parts.push(blob)
  }
  if (parts.reduce((n, b) => n + b.size, 0) > STUDIO_LIMIT) throw new Error('Studio project exceeds 384 MiB.')
  const header = new TextEncoder().encode(JSON.stringify({ version: 2, kind: 'studio', state, entries }))
  if (header.length > 2 * 1024 ** 2) throw new Error('Studio project header is too large.')
  const prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode('IMEJII02')); new DataView(prefix.buffer).setUint32(8, header.length)
  return new Blob([prefix, header, ...parts], { type: 'application/x-imejii-project' })
}
async function readStudioProject(blob) {
  if (blob.size < 14 || blob.size > STUDIO_LIMIT + 2 * 1024 ** 2 + 12) throw new Error('Invalid Studio project size.')
  const length = new DataView(await blob.slice(8, 12).arrayBuffer()).getUint32(0)
  if (!length || length > 2 * 1024 ** 2 || 12 + length >= blob.size) throw new Error('Invalid Studio project header.')
  const header = JSON.parse(await blob.slice(12, 12 + length).text())
  if (header.version !== 2 || header.kind !== 'studio' || !Array.isArray(header.entries) || header.entries.length > 38) throw new Error('Invalid Studio project manifest.')
  const state = validateStudioDocument(header.state), ids = new Set(artifactIds(state)), artifacts = new Map()
  let offset = 12 + length
  for (const entry of header.entries) {
    if (!HASH.test(entry.hash || '') || artifacts.has(entry.hash) || !ids.has(entry.hash) || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > ARTIFACT_LIMIT || offset + entry.size > blob.size) throw new Error('Invalid Studio project artifact table.')
    const part = blob.slice(offset, offset + entry.size, 'image/png')
    if (await sourceFingerprint(part) !== entry.hash) throw new Error('Studio project checksum mismatch.')
    artifacts.set(entry.hash, part); offset += entry.size
  }
  if (offset !== blob.size || artifacts.size !== ids.size) throw new Error('Studio project artifacts are incomplete.')
  // Import is a new session, preserving the origin inside job/result provenance.
  state.id = crypto.randomUUID()
  for (const result of state.results) { result.id = crypto.randomUUID(); result.accepted = false }
  return { id: 'studio:' + state.id, kind: 'studio', version: 1, name: state.name, state, artifacts }
}
