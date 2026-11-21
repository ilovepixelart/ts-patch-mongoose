import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import fc from 'fast-check'
import mongoose from 'mongoose'
import model from '../../laws/generated/entry.mjs'
import { patchHistoryPlugin } from '../../src/index'
import server from '../mongo/server'

import type { BendMaybe } from './bend'

// laws/entry.bend models what a history entry carries beside its document: its names, and user,
// reason and metadata from the getters (LAWS.bend: failed_getter_is_undefined, null_getter_is_stored,
// name_option_wins). These tests run each recording operation on the plugin with random getter
// outcomes and hold every entry it writes to the model; they also check which document each getter
// is given, and that no getter runs when no entry is written.

type Outcome = { $: 'Value'; v: number } | { $: 'Null' } | { $: 'Undefined' } | { $: 'Failed' }
type Field = { $: 'FValue'; v: number } | { $: 'FNull' }
const field = model.field as (o: Outcome) => BendMaybe<Field>
const name = model.name as (option: BendMaybe<number>, model: number) => number

type Doc = { f0?: number; f1?: number }
type EntryDoc = { _id: mongoose.Types.ObjectId } & Doc
const oid = (id: number) => new mongoose.Types.ObjectId(id.toString(16).padStart(24, '0'))
const fieldsOf = (doc: Record<string, unknown> | null | undefined): Doc => Object.fromEntries(Object.entries(doc ?? {}).filter(([k, v]) => ['f0', 'f1'].includes(k) && v !== undefined))

// What each getter returns for an outcome, synchronously or as a promise, and what that stores.
type Getter = 'user' | 'reason' | 'metadata'
const GETTERS: Getter[] = ['user', 'reason', 'metadata']
const returned = (getter: Getter, v: number) => (getter === 'reason' ? `r${v}` : getter === 'user' ? { id: v } : { m: v })
const stored = (getter: Getter, f: BendMaybe<Field>) => {
  if (f.$ === 'None') return undefined
  return f.value.$ === 'FNull' ? null : returned(getter, f.value.v)
}
type Behaviour = { outcome: Outcome; async: boolean }
const run = (getter: Getter, { outcome, async }: Behaviour) => {
  const result = () => {
    if (outcome.$ === 'Failed') throw new Error(`${getter} failed`)
    if (outcome.$ === 'Value') return returned(getter, outcome.v)
    return outcome.$ === 'Null' ? null : undefined
  }
  return async ? Promise.resolve().then(result) : result()
}

const outcomeArb: fc.Arbitrary<Outcome> = fc.oneof(
  fc.nat({ max: 9 }).map((v) => ({ $: 'Value' as const, v })),
  fc.constant({ $: 'Null' as const }),
  fc.constant({ $: 'Undefined' as const }),
  fc.constant({ $: 'Failed' as const }),
)
const behaviourArb = fc.record({ outcome: outcomeArb, async: fc.boolean() })
const behavioursArb = fc.record({ user: behaviourArb, reason: behaviourArb, metadata: behaviourArb })
const docArb = fc.record({ f0: fc.nat({ max: 3 }), f1: fc.nat({ max: 3 }) }, { requiredKeys: [] })

// Each operation starts from documents 1 and 2 and records entries for the documents it names, which
// are also what the getters must be given, in any order.
type Operation = { kind: 'save' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany'; doc: Doc }
const operationArb: fc.Arbitrary<Operation> = fc.record({ kind: fc.constantFrom('save', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'), doc: docArb })
const START: Record<number, Doc> = { 1: { f0: 0, f1: 0 }, 2: { f0: 1, f1: 1 } }
// The documents an operation records, as the getters see them: created and deleted documents, and
// each updated document after the update, when the update changes it.
const updated = (starts: Doc[], doc: Doc) => starts.filter((start) => Object.entries(doc).some(([k, v]) => start[k as keyof Doc] !== v)).map((start) => ({ ...start, ...doc }))
const recordedDocs = ({ kind, doc }: Operation): Doc[] => {
  switch (kind) {
    case 'save':
      return [doc]
    case 'insertMany':
      return [doc, doc]
    case 'updateOne':
      return updated([START[1]], doc)
    case 'updateMany':
      return updated([START[1], START[2]], doc)
    case 'deleteOne':
      return [START[1]]
    case 'deleteMany':
      return [START[1], START[2]]
  }
}

// Names: 0 is the model's own, 1 the option's.
const NAMES = { modelName: ['EntryDoc', 'CustomModel'], collectionName: ['entrydocs', 'customs'] }

describe('history entries keep the laws of laws/entry.bend', () => {
  const instance = server('laws-entry')
  let behaviours: Record<Getter, Behaviour>
  const given: Record<Getter, Doc[]> = { user: [], reason: [], metadata: [] }
  // Whether each getter call was given a mongoose document rather than a plain object.
  const hydrated: boolean[] = []
  const getters = Object.fromEntries(
    GETTERS.map((getter) => [
      `get${getter[0].toUpperCase()}${getter.slice(1)}`,
      (doc: EntryDoc & { toObject?: () => EntryDoc }) => {
        hydrated.push(typeof doc.toObject === 'function')
        given[getter].push(fieldsOf(doc.toObject ? doc.toObject() : doc))
        return run(getter, behaviours[getter])
      },
    ]),
  )
  const make = (modelName: string, options: Record<string, unknown>) => {
    const schema = new mongoose.Schema<EntryDoc>({ f0: Number, f1: Number })
    schema.plugin(patchHistoryPlugin, { omit: ['__v'], ...getters, ...options })
    return mongoose.model<EntryDoc>(modelName, schema)
  }
  const models = [
    { option: false, M: make('EntryDoc', {}) },
    { option: true, M: make('EntryDocNamed', { modelName: 'CustomModel', collectionName: 'customs' }) },
  ]
  const Disabled = make('EntryDocDisabled', { patchHistoryDisabled: true })
  const history = () => mongoose.connection.collection('history')

  const reset = async (M: mongoose.Model<EntryDoc>) => {
    await M.collection.deleteMany({})
    await M.collection.insertMany([
      { _id: oid(1), ...START[1] },
      { _id: oid(2), ...START[2] },
    ])
    await history().deleteMany({})
    for (const getter of GETTERS) given[getter].length = 0
    hydrated.length = 0
  }
  const perform = async (M: mongoose.Model<EntryDoc>, { kind, doc }: Operation, options: Record<string, unknown> = {}) => {
    switch (kind) {
      case 'save':
        return M.create({ _id: oid(3), ...doc })
      case 'insertMany':
        return M.insertMany([
          { _id: oid(3), ...doc },
          { _id: oid(4), ...doc },
        ])
      case 'updateOne':
        return M.updateOne({ _id: oid(1) }, { $set: doc })
          .setOptions(options)
          .exec()
      case 'updateMany':
        return M.updateMany({}, { $set: doc }).setOptions(options).exec()
      case 'deleteOne':
        return M.deleteOne({ _id: oid(1) })
          .setOptions(options)
          .exec()
      case 'deleteMany':
        return M.deleteMany({}).setOptions(options).exec()
    }
  }
  const sorted = (docs: Doc[]) => docs.map((d) => JSON.stringify(Object.entries(d).sort())).sort()

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  it('stores the names and getter fields the model gives, and gives each getter the recorded documents', async () => {
    let runs = 0
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...models), operationArb, behavioursArb, async ({ option, M }, operation, generated) => {
        runs++
        behaviours = generated
        await reset(M)
        await perform(M, operation)

        const expectedDocs = recordedDocs(operation)
        const entries = await history().find({}).toArray()
        expect(entries).toHaveLength(expectedDocs.length)
        const nameOption = option ? { $: 'Some' as const, value: 1 } : { $: 'None' as const }
        for (const entry of entries) {
          expect(entry.modelName).toBe(NAMES.modelName[name(nameOption, 0)])
          expect(entry.collectionName).toBe(NAMES.collectionName[name(nameOption, 0)])
          for (const getter of GETTERS) {
            const expected = stored(getter, field(generated[getter].outcome))
            expect(Object.hasOwn(entry, getter)).toBe(expected !== undefined)
            if (expected !== undefined) expect(entry[getter]).toEqual(expected)
          }
        }
        for (const getter of GETTERS) expect(sorted(given[getter])).toEqual(sorted(expectedDocs))
        // Characterization: insertMany gives the getters mongoose documents; every other operation plain objects.
        expect(new Set(hydrated)).toEqual(new Set(hydrated.length > 0 ? [operation.kind === 'insertMany'] : []))
      }),
      { numRuns: 300 },
    )
    expect(runs).toBe(300)
  }, 120_000)

  it('calls no getter when patch history is disabled or ignored', async () => {
    await fc.assert(
      fc.asyncProperty(operationArb, behavioursArb, fc.boolean(), async (operation, generated, disabled) => {
        behaviours = generated
        const M = disabled ? Disabled : models[0].M
        await reset(M)
        await perform(M, operation, { ignorePatchHistory: true })
        // save and insertMany take no query options: they ignore nothing, so only the disabled plugin applies.
        const ignored = disabled || !['save', 'insertMany'].includes(operation.kind)
        if (!ignored) return
        expect(await history().countDocuments({})).toBe(0)
        for (const getter of GETTERS) expect(given[getter]).toEqual([])
      }),
      { numRuns: 100 },
    )
  }, 60_000)

  // Characterization: an empty modelName option is kept (??) and the history schema requires a name, so
  // no entry is written. Creates and deletes write through bulkWrite, which skips an invalid document
  // without an error, so onError hears nothing; an update writes through create, whose validation error
  // reaches onError.
  it('characterization: an empty modelName option loses creation entries silently and reports update entries to onError', async () => {
    const errors: unknown[] = []
    const Empty = make('EntryDocEmptyName', { modelName: '', onError: (error: unknown) => errors.push(error) })
    behaviours = { user: { outcome: { $: 'Undefined' }, async: false }, reason: { outcome: { $: 'Undefined' }, async: false }, metadata: { outcome: { $: 'Undefined' }, async: false } }
    await reset(Empty)
    await Empty.create({ _id: oid(3), f0: 1 })
    expect(await history().countDocuments({})).toBe(0)
    expect(errors).toEqual([])
    await Empty.updateOne({ _id: oid(3) }, { $set: { f0: 2 } })
    expect(await history().countDocuments({})).toBe(0)
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toMatch(/modelName/)
  })
})
