import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import mongoose from 'mongoose'
import { patchHistoryPlugin } from '../../src/index'
import server from '../mongo/server'
import { type Cfg, createHarness, fieldsOf, idOf, type LawDoc, type Omit, oid } from './history-harness'

// laws/history.bend models the plugin's contract over a document store: the history entries and
// events each mongoose call writes (save, updateOne, deleteOne, insertMany, updateMany, deleteMany and
// upserts), under every configuration, omit option and query switch. These tests run random call
// sequences on the plugin and the model alike: each call's history entries and events must be the
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
  it.each(models)(
    '$label: each call writes the history and events the model writes, the store is the model store, and history replays to it',
    async (target) => {
      await checkSequences(target, 60)
    },
    120_000,
  )

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

  // Characterization: replaceOne history misses the fields a replacement drops, so replaying it does not give the stored document.
  it('characterization: a replaceOne that drops a field records no removal of it', async () => {
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

  // Characterization: an upsert that inserts finds the inserted document again by the values it sets,
  // newest _id first, so an existing document with those values and a higher _id is recorded instead.
  // The law test leaves these upserts out (misattributed); with the defect fixed, drop both.
  it('characterization: an inserting upsert records an existing document that has the same values and a higher _id', async () => {
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
      ['updateOne', 2, { f0: 0, f3: 1 }],
    ])
    expect(seen.map((e) => [e.kind, fieldsOf(e.payload.doc)])).toEqual([
      ['ECreated', { f0: 0, f3: 1 }],
      ['ECreated', { f0: 0, f3: 1 }],
    ])
  })

  // Characterization: the lookup above includes the schema's defaults, so with an array path (default [])
  // even an upsert that sets no value finds the newest document whose array is empty.
  it('characterization: with an array path, an inserting upsert that sets nothing records the newest document', async () => {
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
      ['updateOne', 2],
    ])
  })
})
