#!/usr/bin/env node
/**
 * Static checks for the bundle manifest and its non-JavaScript resources.
 *
 * The same checks run in CI. Nothing here activates the plugin: it only reads
 * the files a DSH profile would resolve through the package `exports` map.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const ok = (message) => console.log(`ok    ${message}`)
const fail = (message) => {
  failures.push(message)
  console.log(`FAIL  ${message}`)
}

function absolute(relative) {
  return join(root, relative)
}

function readJson(relative) {
  const file = absolute(relative)
  if (!existsSync(file)) {
    fail(`${relative} is missing`)
    return undefined
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`)
    return undefined
  }
}

function requireFile(relative) {
  const file = absolute(relative)
  if (!existsSync(file)) {
    fail(`${relative} is missing`)
    return undefined
  }
  return file
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty string`)
    return false
  }
  return true
}

const manifest = readJson('package.json')
if (manifest === undefined) {
  process.exit(1)
}

requireText(manifest.name, 'package.json: name')
requireText(manifest.version, 'package.json: version')
requireText(manifest.description, 'package.json: description')
if (manifest.license !== 'MIT') fail('package.json: license should be MIT')
if (manifest.type !== 'module') fail('package.json: type must be "module"')

if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) {
  fail('package.json: keywords should list discovery terms')
} else if (!manifest.keywords.includes('deepseek-harness')) {
  fail('package.json: keywords should include "deepseek-harness"')
} else {
  ok('package.json: keywords carry the DeepSeek Harness tag')
}

const bundle = manifest.dsh?.bundle
if (typeof bundle?.patch !== 'string') {
  fail('package.json: dsh.bundle.patch is required')
} else {
  const patchFile = requireFile(bundle.patch.replace(/^\.\//u, ''))
  if (patchFile !== undefined) {
    const patch = readFileSync(patchFile, 'utf8')
    if (!patch.includes(`id: ${manifest.name}`)) fail(`${bundle.patch} does not insert the ${manifest.name} row`)
    else ok(`${bundle.patch} inserts the ${manifest.name} row`)
  }
}

const client = manifest.dsh?.client
if (client?.platform !== 'web') fail('package.json: dsh.client.platform must be "web"')
else ok('package.json: dsh.client.platform is web')
if (!Array.isArray(client?.inject) || client.inject.length === 0) {
  fail('package.json: dsh.client.inject should order the Client activation')
}

const runtime = ['index.js', 'client.js', 'helper.mjs']
for (const file of runtime) if (requireFile(file) !== undefined) ok(`${file} exists`)

for (const [key, target] of Object.entries(manifest.exports ?? {})) {
  if (typeof target !== 'string' || target.includes('*')) continue
  requireFile(target.replace(/^\.\//u, ''))
}

if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  fail('package.json: files must list the runtime files')
} else {
  const declared = manifest.files.flatMap((entry) =>
    entry.includes('*')
      ? (entry.startsWith('locale/') ? ['locale/en.json', 'locale/zh.json'] : [])
      : [entry],
  )
  for (const file of declared) if (requireFile(file) !== undefined) ok(`files[]: ${file} exists`)
}

for (const locale of ['en', 'zh']) {
  const relative = `locale/${locale}.json`
  const dictionary = readJson(relative)
  if (dictionary === undefined) continue
  requireText(dictionary.meta?.title, `${relative}: meta.title`)
  requireText(dictionary.meta?.description, `${relative}: meta.description`)
  if (typeof dictionary.meta?.title === 'string') ok(`${relative}: "${dictionary.meta.title}"`)
}

const iconFile = requireFile('icon.svg')
if (iconFile !== undefined) {
  const icon = readFileSync(iconFile, 'utf8')
  if (!icon.trimStart().startsWith('<svg')) fail('icon.svg is not an SVG document')
  else if (statSync(iconFile).size > 256 * 1024) fail('icon.svg exceeds the 256 KiB plugin icon limit')
  else ok(`icon.svg is a valid, in-budget SVG (${statSync(iconFile).size} bytes)`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
