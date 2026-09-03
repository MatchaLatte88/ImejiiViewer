globalThis.auditWrites = []
globalThis.auditFinished = 0
globalThis.auditConfirm = true
globalThis.auditFailSave = false
globalThis.auditSaveCalls = 0
globalThis.desktopApi = {
  isDesktop: true,
  selectFolder: async () => ({ canceled: false, token: 'export-test', path: 'test-output' }),
  writeInto: async payload => { auditWrites.push(payload); return { path: payload.name } },
  finishFileSet: async () => { auditFinished++; return { count: auditWrites.length, path: 'test-output' } },
  confirmDiscard: async () => auditConfirm,
  saveFile: async () => { auditSaveCalls++; if (auditFailSave) throw new Error('Simulated write failure'); return { canceled: true } },
  listFolder: async () => ({ key: 'folder-test', entries: [{ id: 'fixture-a', name: 'a.png' }, { id: 'fixture-b', name: 'b.png' }] }),
  readImages: async () => ({ files: [globalThis.auditFolderFile], error: null }),
  openImages: async () => ({ files: [{ id: 'valid-file', name: 'valid.png', type: 'image/png', size: 100, lastModified: 42 }], error: 'one failed' }),
}
await import('./renderer-checks.js')
globalThis.imejiiTestReady = true
