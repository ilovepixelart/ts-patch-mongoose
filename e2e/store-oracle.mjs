import { readFileSync } from 'node:fs'
import { diffPaths, globToRegExp, pathToRegExp } from './compare.mjs'

// Checks of one build against MongoDB rather than against the baseline, so a defect the baseline
// shares fails here. Each oracle judges a scenario record by what the store held before and after it:
//
//   updated-doc  the last updated event of a stored document carries that document as mongoose reads it
//   recorded     every document whose stored state changed is named by an event or a history entry
//   replay       the history patches, applied to a document as it was, give the document as it is
//   created-doc  a created event's doc is the document as stored (before mongoose fills in defaults on
//                read), unless the scenario changed it later
//   deleted-doc  a deleted event's document is no longer stored
//   rolled-back  a transaction async local storage rolled back leaves the store and history as they were
//
// A change at a path the profile's omit option may cover is not judged: the oracles over-approximate
// omit (any key named by an omit entry's last segment), so they never fail on an omitted path and the
// laws hold omit itself. A scenario whose onError calls reported a lost record is not judged by
// recorded or replay. Manually rolled back transactions keep their history (README, Transactions), so
// only updated-doc skips them as well.

export const ORACLES = ['updated-doc', 'recorded', 'replay', 'created-doc', 'deleted-doc', 'rolled-back']
const ROLLED_BACK = new Set(['aborted', 'als-aborted'])
const ENTRY_KEYS = new Set(['oracle', 'scenario', 'mongoose', 'paths', 'reason'])

const isObject = (value) => value !== null && typeof value === 'object'
// A BigInt as plain() prints it (5n); the driver reads the stored Long as a number.
const BIGINT = /^-?\d+n$/

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  )
}

// A document's id in any of the forms a record holds it: a JSON string, or ObjectId(...) from a document.
const idOf = (value) => (typeof value === 'string' ? value.replace(/^ObjectId\((.*)\)$/, '$1') : JSON.stringify(value))

// Every leaf of a JSON value by path, with the keys on the way to it; an empty object or array is a leaf.
const leaves = (value, path = '$', keys = [], out = new Map()) => {
  if (Array.isArray(value) && value.length > 0) {
    for (const [index, item] of value.entries()) leaves(item, `${path}[${index}]`, keys, out)
  } else if (isObject(value) && !Array.isArray(value) && Object.keys(value).length > 0) for (const key of Object.keys(value)) leaves(value[key], `${path}.${key}`, [...keys, key], out)
  else out.set(path, { keys, value: JSON.stringify(typeof value === 'string' && BIGINT.test(value) ? Number(value.slice(0, -1)) : value) })
  return out
}

const omitNames = (omit) => {
  const list = typeof omit === 'string' ? [omit] : omit
  return new Set(Array.isArray(omit) || typeof omit === 'string' ? list.map((key) => key.split('.').pop()) : [])
}

// The leaves of a document no omit entry may cover, as path => value. Omitting every key of an object
// leaves it empty, so with omit set an empty object is not judged either.
const visible = (doc, omitted) => {
  const out = new Map()
  if (doc === undefined) return out
  for (const [path, { keys, value }] of leaves(doc)) {
    if (keys.some((key) => omitted.has(key)) || (omitted.size > 0 && value === '{}')) continue
    out.set(path, value)
  }
  return out
}

const changedPaths = (before, after) => {
  const paths = []
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) !== after.get(path)) paths.push(`${path}: before ${before.get(path) ?? '<missing>'}, after ${after.get(path) ?? '<missing>'}`)
  }
  return paths
}

const byId = (docs = []) => new Map(docs.map((doc) => [idOf(doc._id), doc]))
const eventDoc = (event, key) => event.payload?.[key]?.value
const modeOf = (id) => id.split('/')[2]

const updatedDoc = (id, record) => {
  if (ROLLED_BACK.has(modeOf(id)) || !Array.isArray(record.read)) return []
  const last = new Map()
  for (const event of record.events ?? []) {
    const doc = event.name.endsWith(':updated') ? eventDoc(event, 'doc') : undefined
    if (isObject(doc)) last.set(idOf(doc._id), doc)
  }
  const stored = byId(record.read)
  const found = []
  for (const [docId, doc] of last) {
    const read = stored.get(docId)
    if (read && JSON.stringify(canonical(read)) !== JSON.stringify(canonical(doc))) found.push({ doc: docId, paths: diffPaths(canonical(read), canonical(doc)) })
  }
  return found
}

const unjudged = (id, record) => ROLLED_BACK.has(modeOf(id)) || record.silent || (record.onError ?? []).length > 0

const recorded = (id, record) => {
  if (unjudged(id, record)) return []
  const omitted = omitNames(record.omit)
  const named = new Set([...(record.events ?? []).flatMap((event) => [eventDoc(event, 'doc')?._id, eventDoc(event, 'oldDoc')?._id]), ...(record.history ?? []).map((entry) => entry.collectionId)].filter((value) => value !== undefined).map(idOf))
  const before = byId(record.jsonBefore)
  const after = byId(record.jsonAfter)
  const found = []
  for (const docId of new Set([...before.keys(), ...after.keys()])) {
    if (named.has(docId)) continue
    const existence = before.has(docId) === after.has(docId) ? [] : [`$: before ${before.has(docId) ? 'stored' : '<missing>'}, after ${after.has(docId) ? 'stored' : '<missing>'}`]
    const paths = existence.length > 0 ? existence : changedPaths(visible(before.get(docId), omitted), visible(after.get(docId), omitted))
    if (paths.length > 0) found.push({ doc: docId, paths })
  }
  return found
}

const unescapeToken = (token) => token.replaceAll('~1', '/').replaceAll('~0', '~')
const tokens = (pointer) => (pointer === '' ? [] : pointer.slice(1).split('/').map(unescapeToken))

const parentOf = (doc, pointer) => {
  const parts = tokens(pointer)
  const key = parts.pop()
  let parent = doc
  for (const part of parts) parent = parent?.[part]
  if (!isObject(parent)) throw new Error(`${pointer}: no parent`)
  return { parent, key }
}

const read = (doc, pointer) => tokens(pointer).reduce((node, part) => node?.[part], doc)

const remove = (doc, pointer) => {
  const { parent, key } = parentOf(doc, pointer)
  if (Array.isArray(parent)) parent.splice(Number(key), 1)
  else if (key in parent) delete parent[key]
  else throw new Error(`${pointer}: nothing to remove`)
}

const add = (doc, pointer, value) => {
  const { parent, key } = parentOf(doc, pointer)
  if (Array.isArray(parent)) parent.splice(key === '-' ? parent.length : Number(key), 0, value)
  else parent[key] = value
}

// RFC 6902, as the history replays: each op on a copy of the document, a failed test stops it.
const applyOp = (doc, op) => {
  const value = structuredClone(op.value)
  if (op.op === 'test' && JSON.stringify(canonical(read(doc, op.path))) !== JSON.stringify(canonical(op.value))) throw new Error(`test ${op.path} failed: ${JSON.stringify(read(doc, op.path))}`)
  if (op.op === 'remove' || op.op === 'replace' || op.op === 'move') remove(doc, op.op === 'move' ? op.from : op.path)
  if (op.op === 'add' || op.op === 'replace') add(doc, op.path, value)
  if (op.op === 'move' || op.op === 'copy') add(doc, op.path, structuredClone(read(doc, op.from)))
}

const replay = (id, record) => {
  if (unjudged(id, record) || !record.historyExpected) return []
  const omitted = omitNames(record.omit)
  const before = byId(record.jsonBefore)
  const after = byId(record.jsonAfter)
  const entries = new Map()
  for (const entry of record.history ?? []) {
    const docId = idOf(entry.collectionId)
    entries.set(docId, [...(entries.get(docId) ?? []), entry])
  }
  const found = []
  for (const [docId, list] of entries) {
    // A document created or deleted in the scenario has no stored state to replay from or to.
    if (!before.has(docId) || !after.has(docId) || list.some((entry) => !Array.isArray(entry.patch))) continue
    const sorted = [...list].sort((left, right) => left.version - right.version)
    const versions = sorted.map((entry) => entry.version)
    if (versions.some((version, index) => version !== index)) {
      found.push({ doc: docId, paths: [`$version: ${JSON.stringify(versions)}, expected 0 to ${versions.length - 1}`] })
      continue
    }
    const doc = structuredClone(before.get(docId))
    try {
      for (const entry of sorted) for (const op of entry.patch) applyOp(doc, op)
    } catch (error) {
      found.push({ doc: docId, paths: [`$patch: ${error.message}`] })
      continue
    }
    const paths = changedPaths(visible(doc, omitted), visible(after.get(docId), omitted)).map((path) => path.replace(': before ', ': replayed ').replace(', after ', ', stored '))
    if (paths.length > 0) found.push({ doc: docId, paths })
  }
  return found
}

const laterChanged = (events, index, docId) => events.slice(index + 1).some((event) => [eventDoc(event, 'doc')?._id, eventDoc(event, 'oldDoc')?._id].some((value) => value !== undefined && idOf(value) === docId))

const createdDoc = (id, record) => {
  if (ROLLED_BACK.has(modeOf(id)) || !Array.isArray(record.state)) return []
  const omitted = omitNames(record.omit)
  const stored = byId(record.state)
  const events = record.events ?? []
  const found = []
  events.forEach((event, index) => {
    const doc = event.name.endsWith(':created') ? eventDoc(event, 'doc') : undefined
    if (!isObject(doc) || doc._id === undefined) return
    const docId = idOf(doc._id)
    if (laterChanged(events, index, docId)) return
    const paths = stored.has(docId) ? changedPaths(visible(stored.get(docId), omitted), visible(doc, omitted)).map((path) => path.replace(': before ', ': stored ').replace(', after ', ', event ')) : ['$: not stored']
    if (paths.length > 0) found.push({ doc: docId, paths })
  })
  return found
}

const deletedDoc = (id, record) => {
  if (ROLLED_BACK.has(modeOf(id)) || !Array.isArray(record.jsonAfter)) return []
  const after = byId(record.jsonAfter)
  return (record.events ?? []).flatMap((event) => {
    const doc = event.name.endsWith(':deleted') ? eventDoc(event, 'oldDoc') : undefined
    return isObject(doc) && after.has(idOf(doc._id)) ? [{ doc: idOf(doc._id), paths: ['$: still stored'] }] : []
  })
}

const rolledBack = (id, record) => {
  if (modeOf(id) !== 'als-aborted' || !Array.isArray(record.before)) return []
  const paths = [...(JSON.stringify(record.before) === JSON.stringify(record.state) ? [] : diffPaths(record.before, record.state).map((path) => `$state${path.slice(1)}`)), ...((record.history ?? []).length > 0 ? [`$history: ${record.history.length} entries`] : [])]
  return paths.length > 0 ? [{ doc: '*', paths }] : []
}

const CHECKS = { 'updated-doc': updatedDoc, recorded, replay, 'created-doc': createdDoc, 'deleted-doc': deletedDoc, 'rolled-back': rolledBack }

// Every violation of every oracle, as { oracle, id, doc, paths }. Records without the store before
// the scenario (skipped scenarios and the history/* checks) are judged by none.
export const storeViolations = (scenarios) => {
  const found = []
  for (const [id, record] of Object.entries(scenarios)) {
    if (!isObject(record) || !Array.isArray(record.events) || !Array.isArray(record.jsonBefore)) continue
    for (const oracle of ORACLES) for (const violation of CHECKS[oracle](id, record)) found.push({ oracle, id, ...violation })
  }
  return found
}

// Known defects: violations a later change fixes, each named by oracle, scenario (`*` matches one path
// segment), optionally a mongoose major version (6) or version prefix ("6.13"), the paths it excuses (`*` matches one key or index,
// `**` any rest) and the reason. An entry that matches no violation fails, so a fix must remove it.
export const loadKnownDefects = (file) => {
  const { entries } = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(entries)) throw new Error(`${file}: "entries" must be an array`)
  return entries.map((entry, index) => {
    const where = `${file}: entries[${index}]`
    const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key))
    if (unknown.length > 0) throw new Error(`${where}: unknown keys ${unknown.join(', ')}`)
    if (!ORACLES.includes(entry.oracle)) throw new Error(`${where}: "oracle" must be one of ${ORACLES.join(', ')}`)
    if (typeof entry.scenario !== 'string' || entry.scenario === '') throw new Error(`${where}: "scenario" must name the scenarios it covers`)
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') throw new Error(`${where}: "reason" must name the defect`)
    if (entry.mongoose !== undefined && !Number.isInteger(entry.mongoose) && !/^\d+(\.\d+)*$/.test(String(entry.mongoose))) throw new Error(`${where}: "mongoose" must be a major version number or a version prefix such as "6.13"`)
    if (!Array.isArray(entry.paths) || entry.paths.length === 0 || entry.paths.some((path) => typeof path !== 'string' || !path.startsWith('$'))) {
      throw new Error(`${where}: "paths" must list the violation paths it excuses, each starting with $`)
    }
    return { ...entry, pattern: globToRegExp(entry.scenario), pathPatterns: entry.paths.map(pathToRegExp) }
  })
}

const pathOf = (line) => line.slice(0, line.indexOf(':'))
const excuses = (entry, violation) => entry.oracle === violation.oracle && entry.pattern.test(violation.id) && violation.paths.every((line) => entry.pathPatterns.some((pattern) => pattern.test(pathOf(line))))

// The violations no known defect excuses, and the known defects that excuse no violation.
export const checkStore = (scenarios, known, mongooseVersion) => {
  const appliesTo = (mongoose) => mongoose === undefined || `${mongooseVersion}.`.startsWith(`${mongoose}.`)
  const applicable = known.filter((entry) => appliesTo(entry.mongoose))
  const used = new Set()
  const failures = []
  for (const violation of storeViolations(scenarios)) {
    const entry = applicable.find((candidate) => excuses(candidate, violation))
    if (entry) used.add(entry)
    else failures.push(violation)
  }
  const unused = applicable.filter((entry) => !used.has(entry)).map(({ oracle, scenario, reason }) => ({ oracle, scenario, reason }))
  return { failures, unused }
}
