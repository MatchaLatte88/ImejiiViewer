// Windows x64 is the initial target. This config never publishes automatically.
module.exports = {
  appId: 'io.imejii.viewer',
  productName: 'Imejii',
  directories: { output: 'release', buildResources: 'build' },
  files: [
    'dist/**/*', 'electron/**/*.cjs', 'shared/ai-models.json', 'package.json', '!node_modules/**',
    // Explicit native runtime inventory. Do not ship install tools, other CPU
    // architectures, optional GPU dependencies or arbitrary production modules.
    { from: 'node_modules/onnxruntime-node', to: 'node_modules/onnxruntime-node', filter: [
      'package.json', 'dist/*.js', 'bin/napi-v6/win32/x64/onnxruntime_binding.node', 'bin/napi-v6/win32/x64/onnxruntime.dll',
    ] },
    { from: 'node_modules/onnxruntime-common', to: 'node_modules/onnxruntime-common', filter: ['package.json', 'dist/cjs/*.js', 'dist/cjs/package.json'] },
  ],
  extraResources: [{ from: 'build/THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' }],
  asar: true,
  asarUnpack: ['node_modules/onnxruntime-node/bin/**/*'],
  npmRebuild: false,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: false,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
  },
  fileAssociations: [{
    ext: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico', 'heic', 'heif', 'tif', 'tiff'],
    name: 'Imejii.Image',
    description: 'View or edit with Imejii',
    role: 'Viewer',
  }],
  publish: null,
}
