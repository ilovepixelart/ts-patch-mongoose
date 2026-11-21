import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import fc from 'fast-check'
import mongoose from 'mongoose'
import { applyUpdate } from '../src/assign-update'
import server from './mongo/server'

// applyUpdate predicts what an update does to a document; MongoDB itself is the oracle. Each case
// inserts a document, applies one single-field update through the driver (no mongoose casting) and
// compares the stored document with the prediction. Types match each operator, since MongoDB rejects
// the rest; the two known divergences are pinned separately below.

const numberArb = fc.integer({ min: -1000, max: 1000 })
const docArb = fc.record(
  {
    n: numberArb,
    s: fc.string({ maxLength: 4 }),
    arr: fc.array(numberArb, { maxLength: 5 }),
    o: fc.record({ x: numberArb, y: fc.string({ maxLength: 3 }) }, { requiredKeys: [] }),
  },
  { requiredKeys: [] },
)

type Doc = Record<string, unknown>
type Update = Record<string, Record<string, unknown>>

const valueArb = fc.oneof(numberArb, fc.string({ maxLength: 4 }), fc.array(numberArb, { maxLength: 3 }), fc.record({ k: numberArb }))
const numericPathArb = fc.constantFrom('n', 'o.x', 'o.z', 'fresh')
const one = (operator: string, path: string, argument: unknown): Update => ({ [operator]: { [path]: argument } })
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

const updateArb = (doc: Doc): fc.Arbitrary<Update> => {
  const arr = (doc.arr as number[] | undefined) ?? []
  const member = arr.length > 0 ? fc.oneof(fc.constantFrom(...arr), numberArb) : numberArb
  return fc.oneof(
    fc.tuple(fc.constantFrom('n', 's', 'arr', 'o', 'o.x', 'o.z', 'fresh', 'fresh.k'), valueArb).map(([path, value]) => one('$set', path, value)),
    fc.constantFrom('n', 's', 'arr', 'o', 'o.x', 'o.z', 'fresh').map((path) => one('$unset', path, '')),
    fc.tuple(fc.constantFrom('$inc', '$mul', '$min', '$max'), numericPathArb, numberArb).map(([operator, path, value]) => one(operator, path, value)),
    fc.tuple(fc.constantFrom('n', 's', 'o.x'), fc.constantFrom('m', 't', 'o.w', 'r.q')).map(([from, to]) => one('$rename', from, to)),
    fc.tuple(fc.constantFrom('$push', '$addToSet'), fc.constantFrom('arr', 'fresh'), fc.oneof(member, fc.record({ $each: fc.array(member, { maxLength: 3 }) }))).map(([operator, path, value]) => one(operator, path, value)),
    member.map((value) => one('$pull', 'arr', value)),
    fc.array(member, { maxLength: 3 }).map((values) => one('$pullAll', 'arr', values)),
    fc.constantFrom(1, -1).map((direction) => one('$pop', 'arr', direction)),
  )
}

describe('applyUpdate agrees with MongoDB', () => {
  const instance = server('assign-update-mongodb')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  const stored = async (doc: Doc, update: Update): Promise<Doc> => {
    const collection = mongoose.connection.collection('docs')
    const _id = new mongoose.Types.ObjectId()
    await collection.insertOne({ _id, ...doc })
    await collection.updateOne({ _id }, update)
    const { _id: _ignored, ...rest } = (await collection.findOne({ _id })) as Doc
    return rest
  }

  it('predicts the stored document for every single-field update operator', async () => {
    await fc.assert(
      fc.asyncProperty(
        docArb.chain((doc) => fc.tuple(fc.constant(doc as Doc), updateArb(doc))),
        async ([doc, update]) => {
          // Clones: applyUpdate writes nested changes through to its input, and fast-check reuses values while shrinking.
          const fromDb = await stored(structuredClone(doc), update)
          // Compared as JSON, the form the plugin diffs (getJsonOmit): -0 from 0 * -1 is 0 there, as in MongoDB's integers.
          expect(json(applyUpdate(structuredClone(doc), update))).toEqual(json(fromDb))
        },
      ),
      { numRuns: 200 },
    )
    // Three database round trips per case.
  }, 60_000)

  // Characterization: these pin where applyUpdate and MongoDB differ today, so a fix shows up here.
  it('characterization: $min with a candidate of another type keeps the value, where MongoDB compares by BSON type order', async () => {
    expect(applyUpdate({ a: 'x' }, { $min: { a: 3 } })).toEqual({ a: 'x' })
    expect(await stored({ a: 'x' }, { $min: { a: 3 } })).toEqual({ a: 3 })
  })

  it('characterization: $set through a missing parent with a numeric segment creates an array, where MongoDB creates an object', async () => {
    expect(applyUpdate({}, { $set: { 'b.1': 2 } })).toEqual({ b: [undefined, 2] })
    expect(await stored({}, { $set: { 'b.1': 2 } })).toEqual({ b: { 1: 2 } })
  })
})
