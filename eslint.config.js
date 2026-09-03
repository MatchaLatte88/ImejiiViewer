import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', 'dist/**', 'release/**', 'audit/**', 'build/**'] },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,cjs,vue}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
    },
  },
  { files: ['tests/**'], languageOptions: { globals: {
    auditWrites: 'writable', auditFinished: 'writable', auditConfirm: 'writable',
    auditFailSave: 'writable', auditSaveCalls: 'writable',
  } } },
  // These two validators intentionally match forbidden control characters.
  { files: ['electron/file-access.cjs', 'src/lib/exportNames.js'], rules: { 'no-control-regex': 'off' } },
]
