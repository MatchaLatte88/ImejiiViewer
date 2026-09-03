/**
 * Startet den Vite-Dev-Server und danach Electron.
 * Bewusst ohne zusaetzliche Pakete (concurrently/wait-on) - es genuegt,
 * auf den offenen Port zu warten.
 */
import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT || 5173)
const URL = `http://localhost:${PORT}`
const TIMEOUT_MS = 30000

const isWindows = process.platform === 'win32'

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: isWindows, // npm/electron sind unter Windows Batch-Wrapper
    ...options,
  })
}

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL, { method: 'GET' })
      if (response.ok || response.status < 500) return true
    } catch {
      // Server laeuft noch nicht - gleich erneut versuchen.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

const vite = run('npm', ['run', 'dev', '--', '--host', HOST, '--port', String(PORT), '--strictPort'])

let electron = null
let shuttingDown = false

/**
 * Beendet einen Kindprozess samt seiner eigenen Kinder. Unter Windows haengt
 * wegen shell: true ein cmd.exe davor - ein einfaches kill() wuerde nur den
 * Wrapper treffen und Vite liesse den Port belegt zurueck.
 */
function killTree(child) {
  if (!child || child.killed) return
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill()
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  killTree(electron)
  killTree(vite)
  process.exit(code)
}

vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.error('\nVite wurde beendet (Code ' + code + ').')
    shutdown(code ?? 0)
  }
})

const ready = await waitForServer()
if (!ready) {
  console.error('Der Dev-Server auf ' + URL + ' war nicht erreichbar.')
  shutdown(1)
}

console.log('\nDev-Server laeuft auf ' + URL + ' - Electron wird gestartet ...\n')

// Das electron-Paket exportiert den Pfad zur Binary. Fehlt sie (Installation
// ohne Postinstall-Schritt), springt npx ein.
let command = 'npx'
let args = ['electron', '.']
try {
  const { default: binary } = await import('electron')
  if (typeof binary === 'string' && binary) {
    command = binary
    args = ['.']
  }
} catch {
  // Fallback bleibt npx.
}

if (process.env.ELECTRON_DEBUG_PORT) {
  args.push('--remote-debugging-port=' + process.env.ELECTRON_DEBUG_PORT)
}

electron = run(command, args, {
  env: { ...process.env, VITE_DEV_SERVER_URL: URL },
  shell: command === 'npx' && isWindows,
})

electron.on('exit', (code) => shutdown(code ?? 0))

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
