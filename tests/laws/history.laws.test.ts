import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import mongoose from 'mongoose'
import { patchEventEmitter, patchHistoryPlugin } from '../../src/index'
import { isMongooseLessThan8 } from '../../src/version'
import server from '../mongo/server'
import { type Cfg, createHarness, fieldsOf, idOf, type LawDoc, type Omit, oid, undrawn } from './history-harness'

// laws/history.bend models the plugin's contract over a document store: the history entries and
// events each mongoose call writes (create, save, insertMany, every update and delete method mongoose has,
// a document's deleteOne, updateMany, deleteMany and upserts by every update method), under every
// configuration, omit option and query switch. These tests run one sequence through every method and
// random call sequences on the plugin and the model alike: each call's history entries and events must be the
// model's, the stored documents must be the model's, and replaying a document's history must give the
// stored document without its omitted fields wherever the law applies (history on, no switches, _id
// kept; LAWS.bend: replay_matches_store, replay_matches_omitted_store).

const CONFIGS: Cfg[] = [
  { history: true, events: true },
  { history: true, events: false },
  { history: false, events: true },
  { history: false, events: false },
]
// Omitting three of four fields with _id leaves documents with no fields often enough to reach the
// rule that an update whose omitted document is empty records nothing.
const OMITS: Omit[] = [
  { keys: [], id: false },
  { keys: ['f1'], id: false },
  { keys: ['f1', 'f3'], id: false },
  { keys: ['f0', 'f1', 'f2'], id: true },
]

describe('the plugin keeps the laws of laws/history.bend', () => {
  const instance = server('laws-history')
  const { seen, pluginOptions, history, checkSequences } = createHarness()
  // Every configuration of history, events and omit, plus history writes rejected with history on.
  const settings = [...CONFIGS.flatMap((cfg) => OMITS.map((omit) => ({ cfg, omit, rejected: false }))), ...CONFIGS.filter((cfg) => cfg.history).map((cfg) => ({ cfg, omit: OMITS[0], rejected: true }))]
  const models = settings.map(({ cfg, omit, rejected }, i) => {
    const name = `LawDoc${i}`
    const schema = new mongoose.Schema<LawDoc>({ f0: Number, f1: Number, f2: Number, f3: Number })
    schema.plugin(patchHistoryPlugin, pluginOptions(name, cfg, omit))
    const label = `history ${cfg.history ? 'on' : 'off'}${rejected ? ' with every write rejected' : ''}, events ${cfg.events ? 'on' : 'off'}, omit [${[...omit.keys, ...(omit.id ? ['_id'] : [])].join(', ')}]`
    return { cfg, omit, rejected, name, label, M: mongoose.model<LawDoc>(name, schema) }
  })

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  // Every configuration gets its own run budget, so a rule that only one of them reaches is not left to the draw.
  // A plain loop: it.each cuts $label at 40 characters, which made two configurations share a name.
  for (const target of models) {
    it(`${target.label}: each call writes the history and events the model writes, the store is the model store, and history replays to it`, async () => {
      await checkSequences(target, 60)
    }, 120_000)
  }

  // The reach check is met by the fixed coverage sequence alone; this holds the random draws to every arm.
  for (const omit of OMITS) {
    it(`omit [${omit.keys.join(', ')}${omit.id ? ', _id' : ''}]: the random sequences draw every call kind, method and query switch`, () => {
      expect(undrawn(omit, 300)).toEqual([])
    })
  }

  // Characterization: the updated event's doc keeps each $unset field as a key whose value is undefined.
  it('characterization: the updated event lists unset fields as undefined keys', async () => {
    const { M } = models[0]
    await M.collection.deleteMany({})
    seen.length = 0
    await M.create({ _id: oid(1), f0: 0, f1: 1 })
    await M.updateOne({ _id: oid(1) }, { $unset: { f1: 1 } })
    const updated = seen.find((e) => e.kind === 'EUpdated')
    expect(Object.hasOwn(updated?.payload.doc ?? {}, 'f1')).toBe(true)
    expect(updated?.payload.doc?.f1).toBeUndefined()
  })

  it('a replaceOne that drops a field records its removal', async () => {
    const { M } = models[0]
    await M.collection.deleteMany({})
    await history().deleteMany({})
    await M.create({ _id: oid(1), f0: 0, f1: 1 })
    await M.replaceOne({ _id: oid(1) }, { f1: 2 })
    const stored = await M.collection.findOne({ _id: oid(1) })
    const update = await history().findOne({ op: 'replaceOne' })
    expect([stored?.f0, stored?.f1]).toEqual([undefined, 2])
    expect(update?.patch).toEqual([
      { op: 'test', path: '/f1', value: 1 },
      { op: 'replace', path: '/f1', value: 2 },
      { op: 'test', path: '/f0', value: 0 },
      { op: 'remove', path: '/f0' },
    ])
  })

  // Characterization: with _id omitted, an update from a document whose fields are all omitted records
  // nothing, so the field it adds is in no history entry and replaying the history misses it.
  it('characterization: with _id omitted, an update from a document with only omitted fields records nothing', async () => {
    const found = models.find(({ cfg, omit }) => cfg.history && cfg.events && omit.id)
    if (!found) throw new Error('no configuration omits _id with history and events on')
    const { M, name } = found
    await M.collection.deleteMany({})
    await history().deleteMany({})
    seen.length = 0
    await M.create({ _id: oid(1), f0: 0 })
    await M.updateOne({ _id: oid(1) }, { $set: { f3: 3 } })
    const stored = await M.collection.findOne({ _id: oid(1) })
    const entries = await history().find({ modelName: name }).toArray()
    expect([stored?.f0, stored?.f3]).toEqual([0, 3])
    // The create entry's document is empty, so none is stored.
    expect(entries.map((h) => [h.op, h.doc])).toEqual([['create', undefined]])
    expect(seen.map((e) => e.kind)).toEqual(['ECreated'])
  })

  it('an inserting upsert records the inserted document, not an existing one with the same values', async () => {
    const { M, name } = models[0]
    await M.collection.deleteMany({})
    await history().deleteMany({})
    seen.length = 0
    await M.create({ _id: oid(2), f0: 0, f3: 1 })
    await M.updateOne({ _id: oid(1) }, { $set: { f3: 1 } }, { upsert: true })
    const inserted = await M.collection.findOne({ _id: oid(1) })
    const entries = await history().find({ modelName: name }).sort({ _id: 1 }).toArray()
    expect(fieldsOf(inserted)).toEqual({ f3: 1 })
    expect(entries.map((h) => [h.op, idOf(h.collectionId), fieldsOf(h.doc)])).toEqual([
      ['create', 2, { f0: 0, f3: 1 }],
      ['updateOne', 1, { f3: 1 }],
    ])
    expect(seen.map((e) => [e.kind, fieldsOf(e.payload.doc)])).toEqual([
      ['ECreated', { f0: 0, f3: 1 }],
      ['ECreated', { f3: 1 }],
    ])
  })

  for (const returned of ['before', 'after'] as const) {
    it(`a findOneAndUpdate upsert returning the document ${returned} the write records the inserted document`, async () => {
      const { M, name } = models[0]
      await M.collection.deleteMany({})
      await history().deleteMany({})
      await M.create({ _id: oid(2), f0: 0, f3: 1 })
      await M.findOneAndUpdate({ _id: oid(1) }, { $set: { f3: 1 } }, { upsert: true, new: returned === 'after' })
      const entries = await history().find({ modelName: name }).sort({ _id: 1 }).toArray()
      expect(entries.map((h) => [h.op, idOf(h.collectionId), fieldsOf(h.doc)])).toEqual([
        ['create', 2, { f0: 0, f3: 1 }],
        ['findOneAndUpdate', 1, { f3: 1 }],
      ])
    })
  }

  // Another writer inserting the same document between the plugin's count and the write (a later pre
  // hook stands in for it) turns the upsert into an update of that document: it inserted nothing.
  for (const method of ['updateOne', 'findOneAndUpdate'] as const) {
    it(`an upsert by ${method} that matches a document inserted after the plugin counted records no creation`, async () => {
      const schema = new mongoose.Schema<LawDoc>({ f0: Number, f3: Number })
      schema.plugin(patchHistoryPlugin, { omit: ['__v'] })
      schema.pre(method, async function () {
        await this.model.collection.insertOne({ _id: oid(1), f0: 0 })
      })
      const Raced = mongoose.model<LawDoc>(`LawDocRaced${method}`, schema)
      await Raced.collection.deleteMany({})
      await history().deleteMany({})
      const raw = isMongooseLessThan8 ? { rawResult: true } : { includeResultMetadata: true }
      if (method === 'updateOne') await Raced.updateOne({ _id: oid(1) }, { $set: { f3: 3 } }, { upsert: true })
      else await Raced.findOneAndUpdate({ _id: oid(1) }, { $set: { f3: 3 } }, { upsert: true, ...raw })
      expect((await Raced.collection.find({}).toArray()).map(fieldsOf)).toEqual([{ f0: 0, f3: 3 }])
      expect(await history().countDocuments({ modelName: `LawDocRaced${method}` })).toBe(0)
    })
  }

  // With an empty filter and update, only the result can say which document the upsert inserted.
  for (const [label, options] of [
    ['the document after the write', { new: true }],
    ['the raw result', isMongooseLessThan8 ? { rawResult: true } : { includeResultMetadata: true }],
  ] as const) {
    it(`a findOneAndUpdate upsert with an empty filter and update records the inserted document from ${label}`, async () => {
      const { M, name } = models[0]
      await M.collection.deleteMany({})
      await history().deleteMany({})
      await M.findOneAndUpdate({}, {}, { upsert: true, ...options })
      const stored = await M.collection.find({}).toArray()
      const entries = await history().find({ modelName: name }).toArray()
      expect(entries.map((h) => [h.op, String(h.collectionId)])).toEqual([['findOneAndUpdate', String(stored[0]?._id)]])
    })
  }

  it('an inserting upsert with an empty filter and update records the inserted document', async () => {
    const { M, name } = models[0]
    await M.collection.deleteMany({})
    await history().deleteMany({})
    seen.length = 0
    await M.updateOne({}, {}, { upsert: true })
    const stored = await M.collection.find({}).toArray()
    expect(stored.map(fieldsOf)).toEqual([{}])
    const entries = await history().find({ modelName: name }).toArray()
    expect(entries.map((h) => [h.op, String(h.collectionId)])).toEqual([['updateOne', String(stored[0]?._id)]])
    expect(seen.map((e) => e.kind)).toEqual(['ECreated'])
  })

  it('a create that fails on a duplicate _id records nothing', async () => {
    const { M, name } = models[0]
    await M.collection.deleteMany({})
    await history().deleteMany({})
    seen.length = 0
    await M.create({ _id: oid(1), f0: 0 })
    await expect(M.create({ _id: oid(1), f0: 3 })).rejects.toThrow(/E11000/)
    const stored = await M.collection.find({}).toArray()
    const entries = await history().find({ modelName: name }).sort({ _id: 1 }).toArray()
    expect(stored.map((d) => [idOf(d._id), fieldsOf(d)])).toEqual([[1, { f0: 0 }]])
    expect(entries.map((h) => [h.op, idOf(h.collectionId), fieldsOf(h.doc)])).toEqual([['create', 1, { f0: 0 }]])
    expect(seen.map((e) => [e.kind, fieldsOf(e.payload.doc)])).toEqual([['ECreated', { f0: 0 }]])
  })

  it('a save of an existing document that fails on a unique index records nothing', async () => {
    const schema = new mongoose.Schema<LawDoc>({ f0: { type: Number, unique: true }, f1: Number })
    schema.plugin(patchHistoryPlugin, { omit: ['__v'], eventUpdated: 'law-unique-updated' })
    const Unique = mongoose.model<LawDoc>('LawDocUnique', schema)
    await Unique.init()
    await history().deleteMany({})
    const updated: unknown[] = []
    const listener = (event: unknown) => updated.push(event)
    patchEventEmitter.on('law-unique-updated', listener)
    try {
      await Unique.create({ _id: oid(1), f0: 1 })
      const doc = await Unique.create({ _id: oid(2), f0: 2 })
      doc.f0 = 1
      await expect(doc.save()).rejects.toThrow(/E11000/)
    } finally {
      patchEventEmitter.off('law-unique-updated', listener)
    }
    const entries = await history().find({ modelName: 'LawDocUnique' }).toArray()
    expect(entries.map((h) => [h.op, idOf(h.collectionId)]).sort()).toEqual([
      ['create', 1],
      ['create', 2],
    ])
    expect(updated).toEqual([])
  })

  // Characterization: an ordered insertMany that stops at a duplicate _id stores the documents before
  // it, but the error skips post('insertMany'), so none of them is in history or in an event. The law
  // tests leave out inserts of a live id; with the defect fixed, drop both.
  it('characterization: an ordered insertMany that stops at a duplicate _id records none of the documents it stored', async () => {
    const { M, name } = models[0]
    await M.collection.deleteMany({})
    await history().deleteMany({})
    seen.length = 0
    await M.create({ _id: oid(2), f0: 2 })
    await expect(
      M.insertMany([
        { _id: oid(1), f0: 1 },
        { _id: oid(2), f0: 9 },
        { _id: oid(3), f0: 3 },
      ]),
    ).rejects.toThrow(/E11000/)
    const stored = await M.collection.find({}).toArray()
    const entries = await history().find({ modelName: name }).toArray()
    expect(stored.map((d) => idOf(d._id)).sort()).toEqual([1, 2])
    expect(entries.map((h) => [h.op, idOf(h.collectionId)])).toEqual([['create', 2]])
    expect(seen.map((e) => e.kind)).toEqual(['ECreated'])
  })

  it('with an array path, an inserting upsert that sets nothing records the inserted document', async () => {
    const schema = new mongoose.Schema<LawDoc & { items: number[] }>({ f0: Number, items: [Number] })
    schema.plugin(patchHistoryPlugin, { omit: ['__v'] })
    const WithArray = mongoose.model('LawDocWithArray', schema)
    await WithArray.collection.deleteMany({})
    await history().deleteMany({})
    await WithArray.updateOne({ _id: oid(2) }, { $set: {} }, { upsert: true })
    await WithArray.updateOne({ _id: oid(1) }, { $set: {} }, { upsert: true })
    const entries = await history().find({ modelName: 'LawDocWithArray' }).sort({ _id: 1 }).toArray()
    expect(entries.map((h) => [h.op, idOf(h.collectionId)])).toEqual([
      ['updateOne', 2],
      ['updateOne', 1],
    ])
  })
})
