/**
 * Detached relauncher for dsh-restart.
 *
 * The Host writes a small request JSON and spawns this file with the Electron
 * executable in Node mode, detached from the application's process tree. This
 * process must outlive the application it replaces: it waits for the HTTP
 * answer to leave the Host, stops every process of the running desktop app
 * (plus everything those processes started), and starts the same executable
 * again.
 *
 * Only the request file comes from the caller; nothing here trusts its paths
 * beyond starting the executable the Host reported for itself.
 *
 * Usage: <electron executable> helper.mjs <request.json>
 */

import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const REQUEST_FILE = process.argv[2]
if (typeof REQUEST_FILE !== 'string' || REQUEST_FILE === '') {
  process.exit(2)
}

const request = JSON.parse(readFileSync(REQUEST_FILE, 'utf8'))
const exe = String(request.exe)
const image = String(request.image)
const logPath = String(request.logPath)
const delayMs = Math.max(0, Number(request.delayMs) || 1200)

/** Keep one restart log bounded: a failing launch must leave evidence, not grow forever. */
const LOG_LIMIT_BYTES = 256 * 1024

function log(line) {
  try {
    let size = 0
    try {
      size = statSync(logPath).size
    } catch {
      /* missing log: appendFileSync creates it */
    }
    if (size > LOG_LIMIT_BYTES) writeFileSync(logPath, '')
    appendFileSync(logPath, `${new Date().toISOString()} [helper ${process.pid}] ${line}\n`)
  } catch {
    /* a broken log must never break the restart */
  }
}

function powershellPath() {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Run one PowerShell program to completion; resolves with its captured output. */
function runPowerShell(script, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(powershellPath(), [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-Command',
        script,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ code: null, out: '', err: error instanceof Error ? error.message : String(error) })
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      out += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      err += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, out, err: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

const quote = (value) => `'${String(value).replace(/'/gu, "''")}'`

/**
 * One pass that stops the application tree.
 *
 * `-Force` termination is deliberate: the desktop shell intercepts a window
 * close into "hide to tray" and asks the Host for a quit confirmation, so no
 * graceful external quit exists. The helper is itself an image-name match, so
 * it keeps its own pid (and the pid of this PowerShell) out of the target set.
 */
function killScript() {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$name = ${quote(image)}`,
    `$keep = ${process.pid}`,
    '$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId, Name)',
    '$targets = New-Object "System.Collections.Generic.HashSet[int]"',
    'if ($all.Count -eq 0) {',
    `  $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $keep -and $_.Id -ne $PID })`,
    '  foreach ($p in $procs) { Stop-Process -Id $p.Id -Force }',
    '  Write-Output ("stopped=" + $procs.Count)',
    '  exit 0',
    '}',
    'foreach ($p in $all) {',
    '  $value = [int]$p.ProcessId',
    `  if ($p.Name -eq ($name + ".exe") -or $p.Name -eq $name) {`,
    '    if ($value -ne $keep -and $value -ne $PID) { [void]$targets.Add($value) }',
    '  }',
    '}',
    '$grew = $true',
    'while ($grew) {',
    '  $grew = $false',
    '  foreach ($p in $all) {',
    '    $value = [int]$p.ProcessId',
    '    if ($targets.Contains($value) -or $value -eq $keep -or $value -eq $PID) { continue }',
    '    if ($targets.Contains([int]$p.ParentProcessId)) { [void]$targets.Add($value); $grew = $true }',
    '  }',
    '}',
    'foreach ($target in $targets) { Stop-Process -Id $target -Force }',
    'Write-Output ("stopped=" + $targets.Count)',
    'Write-Output ("pids=" + (($targets | Sort-Object) -join ","))',
  ].join('\n')
}

/** Whether the application (not this helper) is running right now. */
async function applicationProcesses() {
  const result = await runPowerShell(
    `@(Get-Process -Name ${quote(image)} -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ${process.pid} }).Count`,
    10000,
  )
  return Number.parseInt(result.out.trim(), 10)
}

/** Environment of a fresh user launch: never Node mode, never a child Host marker. */
function launchEnvironment() {
  const env = { ...process.env }
  // Node mode must never reach the application: the same executable would
  // exit immediately instead of opening a window.
  delete env.ELECTRON_RUN_AS_NODE
  // The rest are per-boot/per-session markers of the Host we replace; keep
  // DSH_HOME, DSH_PROFILE, and DSH_PROFILE_DIR because they describe the
  // installation a fresh launch must reuse.
  for (const key of ['DSH_SESSION_ID', 'DSH_WEB_URL', 'DSH_SHELL']) delete env[key]
  return env
}

function launch() {
  const child = spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    env: launchEnvironment(),
  })
  child.on('error', (error) => log(`launch error: ${error.message}`))
  child.once('spawn', () => log(`launched pid=${child.pid}`))
  child.unref()
}

const main = async () => {
  log(`helper up; exe=${exe} image=${image} delayMs=${delayMs}`)
  await sleep(delayMs)
  log('stopping the running application')
  const stopped = await runPowerShell(killScript())
  log(`stop phase code=${String(stopped.code)} out=${stopped.out.trim()} err=${stopped.err.trim()}`)
  await sleep(300)
  launch()
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(4000)
    const running = await applicationProcesses()
    log(`verify attempt ${attempt + 1}: running=${String(running)}`)
    if (Number.isFinite(running) && running > 0) {
      log('done')
      return
    }
    log('application did not come up; retrying launch')
    launch()
  }
  log('FAILED: the application did not come back')
}

main().catch((error) => {
  log(`helper crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
})
