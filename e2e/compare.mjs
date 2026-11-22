import { readFileSync } from 'node:fs'

const ENTRY_KEYS = new Set(['scenario', 'mongoose', 'paths', 'reason'])
const MAX_PATHS = 8
const MAX_VALUE = 300

const isObject = (value) => value !== null && typeof value === 'object'

const show = (value) => {
  if (value === undefined) return '<missing>'
  const text = JSON.stringify(value)
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}...` : text
}

// Every path at which two JSON values differ, including a change of key order, as { path, detail }.
export const differences = (baseline, candidate, path = '$', out = []) => {
  if (JSON.stringify(baseline) === JSON.stringify(candidate)) return out
  if (!isObject(baseline) || !isObject(candidate) || Array.isArray(baseline) !== Array.isArray(candidate)) {
    out.push({ path, detail: `baseline ${show(baseline)}, candidate ${show(candidate)}` })
    return out
  }
  const before = out.length
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(candidate)])) {
    differences(baseline[key], candidate[key], Array.isArray(baseline) ? `${path}[${key}]` : `${path}.${key}`, out)
  }
  if (out.length === before) out.push({ path, detail: `key order, baseline ${show(Object.keys(baseline))}, candidate ${show(Object.keys(candidate))}` })
  return out
}

const describe = (list) => list.slice(0, MAX_PATHS).map(({ path, detail }) => `${path}: ${detail}`)

// The first paths at which two JSON values differ, for display.
export const diffPaths = (baseline, candidate) => describe(differences(baseline, candidate))

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map(escapeRegExp).join('[^/]+')}$`)

// A difference path pattern: `*` matches within one key or index, `**` matches any rest of the path.
export const pathToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split(/(\*\*|\*)/)
      .map((part) => {
        if (part === '**') return '.*'
        if (part === '*') return '[^.\\[\\]]+'
        return escapeRegExp(part)
      })
      .join('')}$`,
  )

export const loadAllowlist = (file) => {
  const { entries } = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(entries)) throw new Error(`${file}: "entries" must be an array`)
  return entries.map((entry, index) => {
    const where = `${file}: entries[${index}]`
    const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key))
    if (unknown.length > 0) throw new Error(`${where}: unknown keys ${unknown.join(', ')}`)
    if (typeof entry.scenario !== 'string' || entry.scenario === '') throw new Error(`${where}: "scenario" must name the scenarios it covers`)
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') throw new Error(`${where}: "reason" must say why the change is intended`)
    if (entry.mongoose !== undefined && !Number.isInteger(entry.mongoose)) throw new Error(`${where}: "mongoose" must be a major version number`)
    if (!Array.isArray(entry.paths) || entry.paths.length === 0 || entry.paths.some((path) => typeof path !== 'string' || !path.startsWith('$'))) {
      throw new Error(`${where}: "paths" must list the difference paths it allows, each starting with $`)
    }
    return { ...entry, pattern: globToRegExp(entry.scenario), pathPatterns: entry.paths.map(pathToRegExp) }
  })
}

// Scenario ids whose records differ between two runs of the same build (CJS and ESM).
export const differingIds = (left, right) => {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...ids].filter((id) => JSON.stringify(left[id]) !== JSON.stringify(right[id]))
}

// A scenario's difference is allowed only when every path at which it differs matches a path of an entry
// that names the scenario; the paths no entry allows are the failure.
export const compareBuilds = (baseline, candidate, allowlist, mongooseVersion) => {
  const major = Number.parseInt(mongooseVersion, 10)
  const applicable = allowlist.filter((entry) => entry.mongoose === undefined || entry.mongoose === major)
  const used = new Set()
  const failures = []
  const allowed = []
  for (const id of differingIds(baseline, candidate)) {
    const entries = applicable.filter((entry) => entry.pattern.test(id))
    const found = differences(baseline[id], candidate[id])
    const reasons = new Set()
    const unlisted = found.filter(({ path }) => {
      const entry = entries.find((candidateEntry) => candidateEntry.pathPatterns.some((pattern) => pattern.test(path)))
      if (!entry) return true
      used.add(entry)
      reasons.add(entry.reason)
      return false
    })
    if (found.length > 0 && unlisted.length === 0) allowed.push({ id, paths: describe(found), reason: [...reasons].join('; ') })
    else failures.push({ id, paths: describe(found.length > 0 ? unlisted : [{ path: '$', detail: 'differs' }]) })
  }
  const unused = applicable.filter((entry) => !used.has(entry)).map(({ scenario, reason }) => ({ scenario, reason }))
  return { failures, allowed, unused }
}

const EXACT_VERSION = /^\d+\.\d+\.\d+$/

// Every `{ name, version }` that is not the exact version requested of `dependency`. A range or
// tag cannot be compared, so it yields none.
export const versionMismatches = (dependency, requested, found) => {
  if (!EXACT_VERSION.test(requested)) return []
  return found.filter(({ version }) => version !== requested).map(({ name, version }) => `${name} has ${dependency} ${version}, not the requested ${requested}`)
}
