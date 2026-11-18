import { readFileSync } from 'node:fs'

const ENTRY_KEYS = new Set(['scenario', 'mongoose', 'reason'])
const MAX_PATHS = 8
const MAX_VALUE = 300

const isObject = (value) => value !== null && typeof value === 'object'

const show = (value) => {
  if (value === undefined) return '<missing>'
  const text = JSON.stringify(value)
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}...` : text
}

// The first paths at which two JSON values differ, including a change of key order.
export const diffPaths = (baseline, candidate, path = '$', out = []) => {
  if (out.length >= MAX_PATHS || JSON.stringify(baseline) === JSON.stringify(candidate)) return out
  if (!isObject(baseline) || !isObject(candidate) || Array.isArray(baseline) !== Array.isArray(candidate)) {
    out.push(`${path}: baseline ${show(baseline)}, candidate ${show(candidate)}`)
    return out
  }
  const before = out.length
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(candidate)])) {
    diffPaths(baseline[key], candidate[key], Array.isArray(baseline) ? `${path}[${key}]` : `${path}.${key}`, out)
  }
  if (out.length === before) out.push(`${path}: key order, baseline ${show(Object.keys(baseline))}, candidate ${show(Object.keys(candidate))}`)
  return out
}

const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}$`,
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
    return { ...entry, pattern: globToRegExp(entry.scenario) }
  })
}

// Scenario ids whose records differ between two runs of the same build (CJS and ESM).
export const differingIds = (left, right) => {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...ids].filter((id) => JSON.stringify(left[id]) !== JSON.stringify(right[id]))
}

export const compareBuilds = (baseline, candidate, allowlist, mongooseVersion) => {
  const major = Number.parseInt(mongooseVersion, 10)
  const applicable = allowlist.filter((entry) => entry.mongoose === undefined || entry.mongoose === major)
  const used = new Set()
  const failures = []
  const allowed = []
  for (const id of differingIds(baseline, candidate)) {
    const entry = applicable.find((candidateEntry) => candidateEntry.pattern.test(id))
    const detail = { id, paths: diffPaths(baseline[id], candidate[id]) }
    if (entry) {
      used.add(entry)
      allowed.push({ ...detail, reason: entry.reason })
    } else {
      failures.push(detail)
    }
  }
  const unused = applicable.filter((entry) => !used.has(entry)).map(({ scenario, reason }) => ({ scenario, reason }))
  return { failures, allowed, unused }
}
