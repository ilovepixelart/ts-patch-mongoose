import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import fc from 'fast-check'
import mongoose from 'mongoose'
import model from '../../laws/generated/history.mjs'
import { patchEventEmitter, patchHistoryPlugin } from '../../src/index'
import server from '../mongo/server'
import { type BendList, fromList, toList } from './bend'

// laws/history.bend models the plugin's contract over a document store: the history entries and
// events each mongoose call writes (save, updateOne, deleteOne, insertMany, updateMany, deleteMany and
// upserts), under every configuration, omit option and query switch. These tests run random call
// sequences on the plugin and the model alike: each call's history entries and events must be the
// model's, the stored documents must be the model's, and replaying a document's history must give the
// stored document without its omitted fields wherever the law applies (history on, no switches, _id
// kept; CLAIMS.bend: replay_matches_store, replay_matches_omitted_store).

const FIELDS = ['f0', 'f1', 'f2', 'f3']
type Doc = Record<string, number>
type LawDoc = { _id: mongoose.Types.ObjectId; f0?: number; f1?: number; f2?: number; f3?: number }
type Flags = { hook: boolean; event: boolean; history: boolean }
type Item = { id: number; doc: Doc }
// One mongoose call each: save of a new document, updateOne, deleteOne, insertMany, updateMany,
// deleteMany, and updateOne with upsert.
type Call =
  | { kind: 'Create'; id: number; doc: Doc }
  | { kind: 'Update'; id: number; doc: Doc; flags: Flags }
  | { kind: 'Delete'; id: number; flags: Flags }
  | { kind: 'InsertMany'; items: Item[] }
  | { kind: 'UpdateMany'; ids: number[]; doc: Doc; flags: Flags }
  | { kind: 'DeleteMany'; ids: number[]; flags: Flags }
  | { kind: 'Upsert'; id: number; doc: Doc; flags: Flags }
type Cfg = { history: boolean; events: boolean }
// The omit option: fields left out, and whether _id is too.
type Omit = { keys: string[]; id: boolean }

type Entry = { k: number; v: number }
type ModelOp = { $: 'Put' | 'Del'; k: number; v?: number }
type ModelHist = { kind: { $: string }; id: number; version: number; doc: BendList<Entry>; patch: BendList<ModelOp> }
type ModelEv = { $: string; doc?: BendList<Entry>; old?: BendList<Entry>; patch?: BendList<ModelOp> }
type ModelState = { store: BendList<{ id: number; doc: BendList<Entry> }>; hist: BendList<ModelHist>; evs: BendList<ModelEv> }
const modelCall = model.call as (cfg: unknown, omit: unknown, st: ModelState, call: unknown) => ModelState
const empty = model.empty as () => ModelState

const oid = (id: number) => new mongoose.Types.ObjectId(id.toString(16).padStart(24, '0'))
const idOf = (value: unknown) => Number.parseInt((value as mongoose.Types.ObjectId).toHexString(), 16)
// A field set to undefined is a field the document does not have (the updated event's doc keeps
// $unset fields as undefined; pinned below).
const fieldsOf = (doc: Record<string, unknown> | null | undefined): Doc => Object.fromEntries(Object.entries(doc ?? {}).filter(([k, v]) => FIELDS.includes(k) && v !== undefined)) as Doc
const docKey = (doc: Doc) => JSON.stringify(Object.entries(doc).sort())
const toEntries = (doc: Doc) => toList(Object.entries(doc).map(([k, v]) => ({ $: 'E', k: FIELDS.indexOf(k), v })))
const entriesKey = (entries: BendList<Entry>) => docKey(Object.fromEntries(fromList(entries).map(({ k, v }) => [FIELDS[k], v])))
const modelOps = (ops: BendList<ModelOp>) =>
  fromList(ops)
    .map((op) => (op.$ === 'Del' ? `Del ${FIELDS[op.k]}` : `Put ${FIELDS[op.k]} ${op.v}`))
    .sort()
type JsonOp = { op: string; path: string; value?: number }
const realOps = (ops: JsonOp[] = []) =>
  ops
    .filter((op) => op.op !== 'test')
    .map((op) => (op.op === 'remove' ? `Del ${op.path.slice(1)}` : `Put ${op.path.slice(1)} ${op.value}`))
    .sort()
// A call's records as a multiset: the order among the documents one bulk call matches is the cursor's.
const bag = (records: unknown[]) => records.map((r) => JSON.stringify(r)).sort()

// History entries and events in one comparable form, from the model and from the plugin. A real
// entry's kind is what its call did to the document, known before the call runs.
type Kind = 'KCreate' | 'KUpdate' | 'KDelete'
const fromModelHist = (h: ModelHist) => ({ kind: h.kind.$, id: h.id, version: h.version, doc: h.kind.$ === 'KUpdate' ? '[]' : entriesKey(h.doc), patch: modelOps(h.patch) })
type RealHist = { op: string; collectionId: unknown; version: number; doc?: Record<string, unknown>; patch?: JsonOp[] }
const fromRealHist = (h: RealHist, kind: Kind) => ({ kind, id: idOf(h.collectionId), version: h.version, doc: kind === 'KUpdate' ? '[]' : docKey(fieldsOf(h.doc)), patch: realOps(h.patch) })
const fromModelEv = (e: ModelEv) => ({ kind: e.$, doc: e.doc && entriesKey(e.doc), old: e.old && entriesKey(e.old), patch: e.patch && modelOps(e.patch) })
type RealEv = { kind: string; payload: { doc?: Record<string, unknown>; oldDoc?: Record<string, unknown>; patch?: JsonOp[] } }
const fromRealEv = ({ kind, payload }: RealEv) => ({ kind, doc: payload.doc && docKey(fieldsOf(payload.doc)), old: payload.oldDoc && docKey(fieldsOf(payload.oldDoc)), patch: payload.patch && realOps(payload.patch) })

// The op each call's history entries carry, and the kind of what it does to a document.
const OP_NAMES: Record<Call['kind'], string> = { Create: 'create', InsertMany: 'create', Update: 'updateOne', UpdateMany: 'updateMany', Delete: 'deleteOne', DeleteMany: 'deleteMany', Upsert: 'updateOne' }
const kindOf = (call: Call, live: boolean): Kind => {
  if (call.kind === 'Create' || call.kind === 'InsertMany') return 'KCreate'
  if (call.kind === 'Delete' || call.kind === 'DeleteMany') return 'KDelete'
  if (call.kind === 'Upsert' && !live) return 'KCreate'
  return 'KUpdate'
}

// Replays a document's real history: a creation's document, then each patch (flat paths).
const replayReal = (recorded: { kind: Kind; h: RealHist }[], id: number): Doc | undefined => {
  let doc: Doc | undefined
  for (const { kind, h } of recorded) {
    if (idOf(h.collectionId) !== id) continue
    if (kind === 'KCreate') doc = fieldsOf(h.doc)
    else if (kind === 'KDelete') doc = undefined
    else if (doc) {
      for (const op of h.patch ?? []) {
        if (op.op === 'remove') delete doc[op.path.slice(1)]
        else if (op.op !== 'test') doc[op.path.slice(1)] = op.value as number
      }
    }
  }
  return doc
}

const docArb = fc.dictionary(fc.constantFrom(...FIELDS), fc.integer({ min: 0, max: 3 }), { maxKeys: 4 })
const idArb = fc.integer({ min: 1, max: 3 })
const idsArb = fc.uniqueArray(idArb, { minLength: 1, maxLength: 3 })
// Switches are mostly off, so the plain path stays common.
const switchArb = fc.oneof({ weight: 3, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) })
const flagsArb = fc.record({ hook: switchArb, event: switchArb, history: switchArb })
// Repeat updates an id with the document it already has: random documents almost never do that.
type Generated = Call | { kind: 'Repeat'; id: number; flags: Flags }
const callArb: fc.Arbitrary<Generated> = fc.oneof(
  fc.record({ kind: fc.constant('Create' as const), id: idArb, doc: docArb }),
  fc.record({ kind: fc.constant('Update' as const), id: idArb, doc: docArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('Repeat' as const), id: idArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('Delete' as const), id: idArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('InsertMany' as const), items: fc.uniqueArray(fc.record({ id: idArb, doc: docArb }), { selector: (item) => item.id, minLength: 1, maxLength: 3 }) }),
  fc.record({ kind: fc.constant('UpdateMany' as const), ids: idsArb, doc: docArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('DeleteMany' as const), ids: idsArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('Upsert' as const), id: idArb, doc: docArb, flags: flagsArb }),
)

// A known defect (pinned below): an upsert that inserts records the live document with the highest _id
// whose fields hold every value it sets, when there is one, instead of the inserted document.
const misattributed = (call: Call, live: Map<number, Doc>) => call.kind === 'Upsert' && !live.has(call.id) && Object.keys(call.doc).length > 0 && [...live].some(([id, doc]) => id > call.id && Object.entries(call.doc).every(([k, v]) => doc[k] === v))

// Leaves out creates of a live id (the contract covers inserts that can succeed) and the upserts the
// defect above misattributes, and turns a Repeat into an update with the id's current document, or
// drops it when the id is not live.
const contractCalls = (generated: Generated[]): Call[] => {
  const live = new Map<number, Doc>()
  const calls: Call[] = []
  for (const call of generated) {
    if (call.kind === 'Repeat') {
      const doc = live.get(call.id)
      if (doc) calls.push({ kind: 'Update', id: call.id, doc: { ...doc }, flags: call.flags })
      continue
    }
    if ((call.kind === 'Create' && live.has(call.id)) || misattributed(call, live)) continue
    if (call.kind === 'InsertMany') {
      const items = call.items.filter((item) => !live.has(item.id))
      if (items.length === 0) continue
      for (const item of items) live.set(item.id, item.doc)
      calls.push({ kind: 'InsertMany', items })
      continue
    }
    if (call.kind === 'Delete') live.delete(call.id)
    else if (call.kind === 'DeleteMany') for (const id of call.ids) live.delete(id)
    else if (call.kind === 'UpdateMany') for (const id of call.ids.filter((id) => live.has(id))) live.set(id, call.doc)
    else if (call.kind === 'Upsert' || call.kind === 'Create' || live.has(call.id)) live.set(call.id, call.doc)
    calls.push(call)
  }
  return calls
}

const modelFlags = (flags: Flags) => ({ $: 'Flags', ...flags })
const toModelCall = (call: Call) => {
  switch (call.kind) {
    case 'Create':
      return { $: 'Single', cmd: { $: 'Create', id: call.id, doc: toEntries(call.doc) } }
    case 'Update':
      return { $: 'Single', cmd: { $: 'Update', id: call.id, doc: toEntries(call.doc), flags: modelFlags(call.flags) } }
    case 'Delete':
      return { $: 'Single', cmd: { $: 'Delete', id: call.id, flags: modelFlags(call.flags) } }
    case 'InsertMany':
      return { $: 'InsertMany', items: toList(call.items.map((item) => ({ $: 'I', id: item.id, doc: toEntries(item.doc) }))) }
    case 'UpdateMany':
      return { $: 'UpdateMany', ids: toList(call.ids), doc: toEntries(call.doc), flags: modelFlags(call.flags) }
    case 'DeleteMany':
      return { $: 'DeleteMany', ids: toList(call.ids), flags: modelFlags(call.flags) }
    case 'Upsert':
      return { $: 'Upsert', id: call.id, doc: toEntries(call.doc), flags: modelFlags(call.flags) }
  }
}
const switchesOf = (flags: Flags) => ({ ignoreHook: flags.hook, ignoreEvent: flags.event, ignorePatchHistory: flags.history })

// A whole-document update as $set and $unset: the update path whose history the plugin builds from
// the operators. A replaceOne that drops fields does not record the removal (pinned below).
const replaceWith = (doc: Doc) => ({ $set: { ...doc }, $unset: Object.fromEntries(FIELDS.filter((f) => !(f in doc)).map((f) => [f, 1])) })

const execute = async (M: mongoose.Model<LawDoc>, call: Call) => {
  switch (call.kind) {
    case 'Create':
      return M.create({ _id: oid(call.id), ...call.doc })
    case 'Update':
      return M.updateOne({ _id: oid(call.id) }, replaceWith(call.doc))
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'Delete':
      return M.deleteOne({ _id: oid(call.id) })
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'InsertMany':
      return M.insertMany(call.items.map((item) => ({ _id: oid(item.id), ...item.doc })))
    case 'UpdateMany':
      return M.updateMany({ _id: { $in: call.ids.map(oid) } }, replaceWith(call.doc))
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'DeleteMany':
      return M.deleteMany({ _id: { $in: call.ids.map(oid) } })
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'Upsert':
      return M.updateOne({ _id: oid(call.id) }, replaceWith(call.doc))
        .setOptions({ ...switchesOf(call.flags), upsert: true })
        .exec()
  }
}
const noSwitch = (call: Call) => !('flags' in call) || (!call.flags.hook && !call.flags.event && !call.flags.history)

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
const strip = (doc: Doc, omit: Omit): Doc => Object.fromEntries(Object.entries(doc).filter(([k]) => !omit.keys.includes(k)))
const toModelOmit = (omit: Omit) => ({ $: 'Omit', keys: toList(omit.keys.map((k) => FIELDS.indexOf(k))), id: omit.id })

describe('the plugin keeps the laws of laws/history.bend', () => {
  const instance = server('laws-history')
  const seen: RealEv[] = []
  const models = CONFIGS.flatMap((cfg) => OMITS.map((omit) => ({ cfg, omit }))).map(({ cfg, omit }, i) => {
    const name = `LawDoc${i}`
    const schema = new mongoose.Schema<LawDoc>({ f0: Number, f1: Number, f2: Number, f3: Number })
    const events = cfg.events ? { eventCreated: `${name}:created`, eventUpdated: `${name}:updated`, eventDeleted: `${name}:deleted` } : {}
    schema.plugin(patchHistoryPlugin, { omit: ['__v', ...omit.keys, ...(omit.id ? ['_id'] : [])], patchHistoryDisabled: !cfg.history, ...events })
    for (const [suffix, kind] of [
      ['created', 'ECreated'],
      ['updated', 'EUpdated'],
      ['deleted', 'EDeleted'],
    ]) {
      patchEventEmitter.on(`${name}:${suffix}`, (payload) => seen.push({ kind, payload }))
    }
    const label = `history ${cfg.history ? 'on' : 'off'}, events ${cfg.events ? 'on' : 'off'}, omit [${[...omit.keys, ...(omit.id ? ['_id'] : [])].join(', ')}]`
    return { cfg, omit, name, label, M: mongoose.model<LawDoc>(name, schema) }
  })
  const history = () => mongoose.connection.collection('history')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  // Every configuration gets its own run budget, so a rule that only one of them reaches is not left to the draw.
  it.each(models)(
    '$label: each call writes the history and events the model writes, the store is the model store, and history replays to it',
    async ({ cfg, omit, name, M }) => {
      const modelCfg = { $: 'Cfg', ...cfg }
      const modelOmit = toModelOmit(omit)
      const omitted = [...omit.keys, ...(omit.id ? ['_id'] : [])]
      let sequences = 0
      await fc.assert(
        fc.asyncProperty(fc.array(callArb, { maxLength: 8 }).map(contractCalls), async (calls) => {
          sequences++
          await M.collection.deleteMany({})
          await history().deleteMany({})
          seen.length = 0
          let state = empty()
          const recorded: { kind: Kind; h: RealHist }[] = []
          for (const call of calls) {
            const live = call.kind === 'Upsert' && (await M.exists({ _id: oid(call.id) })) !== null
            const histBefore = recorded.length
            const evsBefore = seen.length
            await execute(M, call)
            const next = modelCall(modelCfg, modelOmit, state, toModelCall(call))

            const written = (await history().find({ modelName: name }).sort({ _id: 1 }).skip(histBefore).toArray()) as unknown as RealHist[]
            const kind = kindOf(call, live)
            expect(written.map((h) => h.op).filter((op) => op !== OP_NAMES[call.kind])).toEqual([])
            expect(bag(written.map((h) => fromRealHist(h, kind)))).toEqual(bag(fromList(next.hist).slice(fromList(state.hist).length).map(fromModelHist)))
            expect(bag(seen.slice(evsBefore).map(fromRealEv))).toEqual(bag(fromList(next.evs).slice(fromList(state.evs).length).map(fromModelEv)))
            // Independent of the model (CLAIMS.bend: omitted_never_recorded): no entry holds an omitted key.
            expect(written.flatMap((h) => Object.keys(h.doc ?? {}).filter((k) => omitted.includes(k)))).toEqual([])
            expect(written.flatMap((h) => (h.patch ?? []).filter((op) => omitted.includes(op.path.slice(1))))).toEqual([])
            recorded.push(...written.map((h) => ({ kind, h })))
            state = next
          }

          const realDocs = await M.collection.find({}).toArray()
          const realStore = realDocs.map((d) => [idOf(d._id), docKey(fieldsOf(d))]).sort()
          const modelStore = fromList(state.store)
            .map(({ id, doc }) => [id, entriesKey(doc)])
            .sort()
          expect(realStore).toEqual(modelStore)

          if (cfg.history && calls.every(noSwitch) && !omit.id) {
            for (const id of [1, 2, 3]) {
              const stored = realDocs.find((d) => idOf(d._id) === id)
              const replayed = replayReal(recorded, id)
              expect(replayed && docKey(replayed)).toEqual(stored && docKey(strip(fieldsOf(stored), omit)))
            }
          }
        }),
        { numRuns: 60 },
      )
      expect(sequences).toBe(60)
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
})
