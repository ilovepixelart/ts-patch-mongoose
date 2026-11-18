'use strict'

// Turns what a scenario observed into plain JSON. Only values that differ between two runs of
// the same code are normalized: ObjectIds generated at runtime become #1, #2, ... in order of
// first appearance, Dates become '<Date>'. Fixed ids (timestamp 0) are kept verbatim.

const isObjectId = (value) => value?._bsontype === 'ObjectId' || value?._bsontype === 'ObjectID'
const isDocument = (value) => typeof value?.$__ === 'object' && typeof value.toObject === 'function'

const plain = (value) => {
  if (value === undefined) return '<undefined>'
  if (typeof value === 'bigint') return `${value}n`
  if (value === null || typeof value !== 'object') return value
  if (isObjectId(value)) return `ObjectId(${value.toHexString()})`
  if (value instanceof Date) return '<Date>'
  if (isDocument(value)) return plain(value.toObject())
  if (Array.isArray(value)) return Array.from(value, plain)
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
