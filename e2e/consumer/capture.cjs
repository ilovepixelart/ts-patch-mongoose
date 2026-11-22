'use strict'

// Turns what a scenario observed into plain JSON. Only values that differ between two runs of
// the same code are normalized: ObjectIds generated at runtime become #1, #2, ... in order of
// first appearance; times within a day of this run become '<Date>' for a Date, '<DateString>' for
// the ISO string JSON makes of one (in patches) and '<Now>' for epoch milliseconds (Date.now() in
// a patch); BSON Timestamps become '<Timestamp>'. A Date and its string stay distinguishable, and
// fixed values (ids with timestamp 0, dates the fixtures set) are kept verbatim.

const STARTED = Date.now()
const DAY = 24 * 60 * 60 * 1000

const isObjectId = (value) => value?._bsontype === 'ObjectId' || value?._bsontype === 'ObjectID'
const isNow = (value) => Number.isInteger(value) && Math.abs(value - STARTED) < DAY
const isDocument = (value) => typeof value?.$__ === 'object' && typeof value.toObject === 'function'
// Exactly the strings Date#toJSON produces: they parse back to a Date that serializes to the same string.
const isSerializedDate = (value) => {
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

const dateShape = (date) => {
  const time = date.getTime()
  if (Number.isNaN(time)) return 'Date(invalid)'
  return isNow(time) ? '<Date>' : `Date(${date.toISOString()})`
}

// An object that only inherits from RegExp (a broken clone) has no source to print.
const regExpShape = (re) => {
  try {
    return `RegExp(${RegExp.prototype.toString.call(re)})`
  } catch {
    return 'RegExp(invalid)'
  }
}

const plain = (value) => {
  if (value === undefined) return '<undefined>'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'string' && isSerializedDate(value) && isNow(Date.parse(value))) return '<DateString>'
  if (isNow(value)) return '<Now>'
  if (value === null || typeof value !== 'object') return value
  if (isObjectId(value)) return `ObjectId(${value.toHexString()})`
  if (value._bsontype === 'Timestamp') return '<Timestamp>'
  if (value instanceof Date) return dateShape(value)
  if (value instanceof RegExp) return regExpShape(value)
  if (isDocument(value)) return plain(value.toObject())
  if (Array.isArray(value)) return Array.from(value, plain)
  if (value instanceof Map) return Object.fromEntries(Array.from(value, ([key, item]) => [key, plain(item)]))
  const out = {}
  for (const key of Object.keys(value)) out[key] = plain(value[key])
  return out
}

const kindOf = (value) => {
  if (value === null) return 'null'
  if (isDocument(value)) return 'document'
  if (Array.isArray(value)) return 'array'
  if (isObjectId(value)) return 'ObjectId'
  return typeof value
}

// The value together with what it is: a hydrated document and its plain object serialize alike.
const shape = (value) => ({ kind: kindOf(value), value: plain(value) })

const payloadShape = (payload) => {
  const out = {}
  for (const key of Object.keys(payload ?? {})) out[key] = shape(payload[key])
  return out
}

const errorShape = (error) => ({ name: error?.constructor?.name ?? typeof error, codeName: error?.codeName, message: String(error?.message ?? error) })

const COUNT_KEYS = ['acknowledged', 'matchedCount', 'modifiedCount', 'upsertedCount', 'deletedCount', 'insertedCount']

// Write results that are class instances (BulkWriteResult) carry driver internals; keep their counts.
const resultShape = (result) => {
  if (result === null || typeof result !== 'object' || isDocument(result) || Array.isArray(result)) return shape(result)
  if (Object.getPrototypeOf(result) === Object.prototype) return shape(result)
  return { kind: 'result', value: Object.fromEntries(COUNT_KEYS.filter((key) => key in result).map((key) => [key, result[key]])) }
}

const FIXED_ID = /^0{8}/

const aliasObjectIds = (record) => {
  const names = new Map()
  const text = JSON.stringify(record).replace(/\b[0-9a-f]{24}\b/g, (hex) => {
    if (FIXED_ID.test(hex)) return hex
    if (!names.has(hex)) names.set(hex, `#${names.size + 1}`)
    return names.get(hex)
  })
  return JSON.parse(text)
}

const createRecorder = () => {
  const seen = { events: [], getterCalls: [], preDelete: [], onError: [] }
  return {
    seen,
    clear: () => {
      for (const list of Object.values(seen)) list.length = 0
    },
    event: (name, payload) => seen.events.push({ name, payload: payloadShape(payload) }),
    getter: (getter, doc) => seen.getterCalls.push({ getter, arg: shape(doc) }),
    preDelete: (docs) => seen.preDelete.push(shape(docs)),
    onError: (error) => seen.onError.push(errorShape(error)),
  }
}

module.exports = { aliasObjectIds, createRecorder, errorShape, isObjectId, plain, resultShape, shape }
