import { readFileSync } from 'node:fs'
import { diffPaths, globToRegExp } from './compare.mjs'

// A check of one build against MongoDB rather than against the baseline: after each scenario, the
// last updated event of every stored document must carry that document as mongoose reads it back
// (the omit option shapes history only, not events). A defect the baseline shares passes the
// comparison with it; it fails here. Rolled back transactions are skipped: their store is unchanged.

const ROLLED_BACK = new Set(['aborted', 'als-aborted'])
const ENTRY_KEYS = new Set(['scenario', 'mongoose', 'reason'])

const isObject = (value) => value !== null && typeof value === 'object'

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  )
}

// Every stored document whose last updated event in a scenario differs from it, as { id, doc, paths }.
export const storeViolations = (scenarios) => {
  const found = []
  for (const [id, record] of Object.entries(scenarios)) {
    const mode = id.split('/')[2]
    if (ROLLED_BACK.has(mode) || !Array.isArray(record?.read) || !Array.isArray(record.events)) continue
    const last = new Map()
    for (const event of record.events) {
      const doc = event.name.endsWith(':updated') ? event.payload?.doc?.value : undefined
      if (isObject(doc)) last.set(doc._id, doc)
    }
    for (const [docId, doc] of last) {
      const stored = record.read.find((entry) => entry._id === docId)
      if (!stored) continue
      if (JSON.stringify(canonical(stored)) !== JSON.stringify(canonical(doc))) found.push({ id, doc: docId, paths: diffPaths(canonical(stored), canonical(doc)) })
    }
  }
  return found
}

// Known defects: violations a later change fixes, each named by scenario (`*` matches one path
// segment), optionally a mongoose major version, and the reason. An entry that matches no violation
// fails, so a fix must remove it.
export const loadKnownDefects = (file) => {
  const { entries } = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(entries)) throw new Error(`${file}: "entries" must be an array`)
  return entries.map((entry, index) => {
    const where = `${file}: entries[${index}]`
    const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key))
    if (unknown.length > 0) throw new Error(`${where}: unknown keys ${unknown.join(', ')}`)
    if (typeof entry.scenario !== 'string' || entry.scenario === '') throw new Error(`${where}: "scenario" must name the scenarios it covers`)
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') throw new Error(`${where}: "reason" must name the defect`)
    if (entry.mongoose !== undefined && !Number.isInteger(entry.mongoose)) throw new Error(`${where}: "mongoose" must be a major version number`)
    return { ...entry, pattern: globToRegExp(entry.scenario) }
  })
}

// The violations no known defect names, and the known defects that name no violation.
export const checkStore = (scenarios, known, mongooseVersion) => {
  const major = Number.parseInt(mongooseVersion, 10)
  const applicable = known.filter((entry) => entry.mongoose === undefined || entry.mongoose === major)
  const used = new Set()
  const failures = []
  for (const violation of storeViolations(scenarios)) {
    const entry = applicable.find((candidate) => candidate.pattern.test(violation.id))
    if (entry) used.add(entry)
    else failures.push(violation)
  }
  const unused = applicable.filter((entry) => !used.has(entry)).map(({ scenario, reason }) => ({ scenario, reason }))
  return { failures, unused }
}
