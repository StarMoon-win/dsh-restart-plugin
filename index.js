/**
 * Host half of dsh-restart.
 *
 * The DeepSeek Harness desktop shell owns the Electron main process, and no
 * IPC channel lets a plugin ask it to relaunch: the only Host-facing control
 * messages are `quit-inspection` and `update-tasks`, and `app.relaunch()` has
 * no entry point reachable from a plugin. The shell also turns a window close
 * into "hide to tray", so there is no graceful external quit either.
 *
 * This module therefore answers the sidebar button on its own: a package-local
 * route writes one request file, starts `helper.mjs` with the same Electron
 * executable in Node mode, detached from the application's process tree, and
 * replies immediately. The helper waits for that reply to leave, stops the
 * application tree, and starts the executable again.
 *
 * The routes are package-private in practice (the Client half calls them from
 * the same origin) and still fenced: POST only, loopback peer only, no proxy
 * forwarding headers, and Origin must match Host when both are present.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Client-facing endpoints; keep in sync with client.js. */
const STATUS_PATH = '/dsh-restart/status'
const RESTART_PATH = '/dsh-restart/restart'
/** Time the helper waits so the click's HTTP answer leaves the Host first. */
const RESTART_DELAY_MS = 1200
/** One restart at a time; the guard clears itself if the helper never starts. */
const RESTART_GUARD_MS = 20000

const HELPER_FILE = fileURLToPath(new URL('./helper.mjs', import.meta.url))

let scheduling = false
let guardTimer

/**
 * The executable and image name of the desktop application this Host runs in.
 * Plain `dsh web` hosts (a Node executable, or a terminal launch) have no
 * application to restart and are reported as unsupported.
 *
 * @returns {{ exe: string, image: string } | undefined}
 */
function desktopTarget() {
  if (process.platform !== 'win32') return undefined
  if (process.env.ELECTRON_RUN_AS_NODE !== '1') return undefined
  const exe = process.execPath
  if (typeof exe !== 'string' || exe === '' || !existsSync(exe)) return undefined
  const image = basename(exe).replace(/\.exe$/iu, '')
  if (image === '' || image.toLowerCase() === 'node') return undefined
  return { exe, image }
}

/** Loopback peers only: a remote browser cannot reach the restart door. */
function isLoopback(request) {
  const address = request.socket?.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** A loopback authority as a browser and this Host spell it. */
function loopbackAuthority(host) {
  if (typeof host !== 'string' || host === '') return false
  try {
    const parsed = new URL(`http://${host}`)
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === '::1'
  } catch {
    return false
  }
}

/**
 * Same-origin, or the headerless shape of the desktop document proxy.
 *
 * The desktop forwards page requests to the internal Host with `Host` and
 * `Origin` stripped, so their absence is the trusted desktop shape; a browser
 * cannot produce it because every browser request carries `Host`. When `Host`
 * is present it must name this machine (`localhost` / loopback, which also
 * refuses DNS rebinding), and an `Origin` that is present must match it — the
 * shape of a same-origin POST. A same-origin GET carries `Host` and usually no
 * `Origin`, which is why the origin is optional once the authority is loopback.
 */
function isTrusted(request) {
  if (!isLoopback(request)) return false
  const headers = request.headers
  if (headers.forwarded !== undefined || headers['x-forwarded-for'] !== undefined || headers['x-real-ip'] !== undefined) return false
  const origin = headers.origin
  const host = headers.host
  if (origin === undefined && host === undefined) return true
  if (host === undefined || !loopbackAuthority(host)) return false
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function releaseGuard() {
  if (guardTimer !== undefined) {
    clearTimeout(guardTimer)
    guardTimer = undefined
  }
  scheduling = false
}

/**
 * Write the helper request and start the detached relauncher.
 *
 * @param {{ exe: string, image: string }} target - application executable facts.
 * @returns {Promise<{ ok: true, logPath: string } | { ok: false, error: string }>}
 */
async function scheduleRestart(target) {
  if (scheduling) return { ok: false, error: 'restart-already-scheduled' }
  scheduling = true
  guardTimer = setTimeout(releaseGuard, RESTART_GUARD_MS)
  guardTimer.unref?.()

  const directory = join(tmpdir(), 'dsh-restart')
  const logPath = join(directory, 'restart.log')
  const requestPath = join(directory, 'request.json')
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(requestPath, JSON.stringify({
      exe: target.exe,
      image: target.image,
      logPath,
      delayMs: RESTART_DELAY_MS,
      requestedAt: new Date().toISOString(),
    }), 'utf8')
  } catch (error) {
    releaseGuard()
    return { ok: false, error: 'request-write-failed' }
  }

  const child = spawn(process.execPath, [HELPER_FILE, requestPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
    child.unref()
    return { ok: true, logPath }
  } catch (error) {
    child.kill?.()
    releaseGuard()
    return { ok: false, error: 'helper-spawn-failed' }
  }
}

/**
 * `GET /dsh-restart/status` — whether this Host can restart its application.
 *
 * @param {import('node:http').IncomingMessage} request - the probe.
 * @param {import('node:http').ServerResponse} response - JSON answer.
 */
function statusHandler(request, response) {
  request.resume()
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
    return
  }
  if (!isTrusted(request)) {
    sendJson(response, 403, { ok: false, error: 'forbidden' })
    return
  }
  const target = desktopTarget()
  sendJson(response, 200, {
    supported: target !== undefined,
    platform: process.platform,
  })
}

/**
 * `POST /dsh-restart/restart` — stop the application and open it again.
 *
 * @param {import('node:http').IncomingMessage} request - the click.
 * @param {import('node:http').ServerResponse} response - JSON answer, sent
 *   before the application exits.
 */
async function restartHandler(request, response) {
  request.resume()
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
    return
  }
  if (!isTrusted(request)) {
    sendJson(response, 403, { ok: false, error: 'forbidden' })
    return
  }
  const target = desktopTarget()
  if (target === undefined) {
    sendJson(response, 409, { ok: false, error: 'unsupported-host' })
    return
  }
  const result = await scheduleRestart(target)
  if (!result.ok) {
    sendJson(response, result.error === 'restart-already-scheduled' ? 409 : 500, result)
    return
  }
  sendJson(response, 202, { ok: true, scheduled: true, logPath: result.logPath })
}

/**
 * Mount the restart routes on the Web carrier.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposeStatus = webCtx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: statusHandler,
      })
      const disposeRestart = webCtx.webServer.register({
        kind: 'exact',
        path: RESTART_PATH,
        handler: restartHandler,
      })
      return () => {
        disposeRestart()
        disposeStatus()
      }
    }, 'dsh-restart: routes')
  })
}
