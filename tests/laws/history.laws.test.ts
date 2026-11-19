import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import fc from 'fast-check'
import mongoose from 'mongoose'
import model from '../../laws/generated/history.mjs'
import { patchEventEmitter, patchHistoryPlugin } from '../../src/index'
import server from '../mongo/server'
import { type BendList, fromList, toList } from './bend'

// laws/history.bend models the plugin's contract over a document store: the history entries and
// events each command writes, under every configuration, omit option and query switch. These tests
// run random command sequences on the plugin and the model alike: the history entries, the events and
// the stored documents must be the model's, and replaying a document's history must give the stored
// document without its omitted fields wherever the law applies (history on, no switches, _id kept;
// CLAIMS.bend: replay_matches_store, replay_matches_omitted_store).

const FIELDS = ['f0', 'f1', 'f2', 'f3']
type Doc = Record<string, number>
type LawDoc = { _id: mongoose.Types.ObjectId; f0?: number; f1?: number; f2?: number; f3?: number }
type Flags = { hook: boolean; event: boolean; history: boolean }
type Cmd = { kind: 'Create'; id: number; doc: Doc } | { kind: 'Update'; id: number; doc: Doc; flags: Flags } | { kind: 'Delete'; id: number; flags: Flags }
type Cfg = { history: boolean; events: boolean }
// The omit option: fields left out, and whether _id is too.
type Omit = { keys: string[]; id: boolean }

type Entry = { k: number; v: number }
type ModelOp = { $: 'Put' | 'Del'; k: number; v?: number }
type ModelHist = { kind: { $: string }; id: number; version: number; doc: BendList<Entry>; patch: BendList<ModelOp> }
type ModelEv = { $: string; doc?: BendList<Entry>; old?: BendList<Entry>; patch?: BendList<ModelOp> }
type ModelState = { store: BendList<{ id: number; doc: BendList<Entry> }>; hist: BendList<ModelHist>; evs: BendList<ModelEv> }
const runWith = model.run_with as (cmds: BendList<unknown>, cfg: unknown, omit: unknown, st: unknown) => ModelState
const empty = model.empty as () => unknown

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

// History entries and events in one comparable form, from the model and from the plugin.
const fromModelHist = (h: ModelHist) => ({ kind: h.kind.$, id: h.id, version: h.version, doc: h.kind.$ === 'KUpdate' ? '[]' : entriesKey(h.doc), patch: modelOps(h.patch) })
const KINDS: Record<string, string> = { create: 'KCreate', updateOne: 'KUpdate', deleteOne: 'KDelete' }
type RealHist = { op: string; collectionId: unknown; version: number; doc?: Record<string, unknown>; patch?: JsonOp[] }
const fromRealHist = (h: RealHist) => ({ kind: KINDS[h.op] ?? h.op, id: idOf(h.collectionId), version: h.version, doc: docKey(fieldsOf(h.doc)), patch: realOps(h.patch) })
const fromModelEv = (e: ModelEv) => ({ kind: e.$, doc: e.doc && entriesKey(e.doc), old: e.old && entriesKey(e.old), patch: e.patch && modelOps(e.patch) })
type RealEv = { kind: string; payload: { doc?: Record<string, unknown>; oldDoc?: Record<string, unknown>; patch?: JsonOp[] } }
const fromRealEv = ({ kind, payload }: RealEv) => ({ kind, doc: payload.doc && docKey(fieldsOf(payload.doc)), old: payload.oldDoc && docKey(fieldsOf(payload.oldDoc)), patch: payload.patch && realOps(payload.patch) })

// Replays a document's real history: the create entry's document, then each patch (flat paths).
const replayReal = (raw: RealHist[], id: number): Doc | undefined => {
  let doc: Doc | undefined
  for (const h of raw) {
    if (idOf(h.collectionId) !== id) continue
    if (h.op === 'create') doc = fieldsOf(h.doc)
    else if (h.op === 'deleteOne') doc = undefined
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
// Switches are mostly off, so the plain path stays common.
const switchArb = fc.oneof({ weight: 3, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) })
const flagsArb = fc.record({ hook: switchArb, event: switchArb, history: switchArb })
// Repeat updates an id with the document it already has: random documents almost never do that.
type Generated = Cmd | { kind: 'Repeat'; id: number; flags: Flags }
const cmdArb: fc.Arbitrary<Generated> = fc.oneof(
  fc.record({ kind: fc.constant('Create' as const), id: idArb, doc: docArb }),
  fc.record({ kind: fc.constant('Update' as const), id: idArb, doc: docArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('Repeat' as const), id: idArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('Delete' as const), id: idArb, flags: flagsArb }),
)

// Leaves out creates of an id that is live (the contract covers inserts that can succeed), and turns
// a Repeat into an update with the id's current document, or drops it when the id is not live.
const contractCommands = (generated: Generated[]): Cmd[] => {
  const live = new Map<number, Doc>()
  const cmds: Cmd[] = []
  for (const cmd of generated) {
    if (cmd.kind === 'Create' && live.has(cmd.id)) continue
    if (cmd.kind === 'Repeat') {
      const doc = live.get(cmd.id)
      if (doc) cmds.push({ kind: 'Update', id: cmd.id, doc: { ...doc }, flags: cmd.flags })
      continue
    }
    if (cmd.kind === 'Delete') live.delete(cmd.id)
    else if (live.has(cmd.id) || cmd.kind === 'Create') live.set(cmd.id, cmd.doc)
    cmds.push(cmd)
  }
  return cmds
}

const toModelCmd = (cmd: Cmd) => {
  if (cmd.kind === 'Create') return { $: 'Create', id: cmd.id, doc: toEntries(cmd.doc) }
  const flags = { $: 'Flags', ...cmd.flags }
  if (cmd.kind === 'Update') return { $: 'Update', id: cmd.id, doc: toEntries(cmd.doc), flags }
  return { $: 'Delete', id: cmd.id, flags }
}
const switchesOf = (flags: Flags) => ({ ignoreHook: flags.hook, ignoreEvent: flags.event, ignorePatchHistory: flags.history })

// A whole-document update as $set and $unset: the update path whose history the plugin builds from
// the operators. A replaceOne that drops fields does not record the removal (pinned below).
const replaceWith = (doc: Doc) => ({ $set: { ...doc }, $unset: Object.fromEntries(FIELDS.filter((f) => !(f in doc)).map((f) => [f, 1])) })

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
    '$label: writes the history and events the model writes, stores what it stores, and replays to the store without omitted fields',
    async ({ cfg, omit, name, M }) => {
      let sequences = 0
      await fc.assert(
        fc.asyncProperty(fc.array(cmdArb, { maxLength: 8 }).map(contractCommands), async (cmds) => {
          sequences++
          await M.collection.deleteMany({})
          await history().deleteMany({})
          seen.length = 0
          for (const cmd of cmds) {
            if (cmd.kind === 'Create') await M.create({ _id: oid(cmd.id), ...cmd.doc })
            else if (cmd.kind === 'Update')
              await M.updateOne({ _id: oid(cmd.id) }, replaceWith(cmd.doc))
                .setOptions(switchesOf(cmd.flags))
                .exec()
            else
              await M.deleteOne({ _id: oid(cmd.id) })
                .setOptions(switchesOf(cmd.flags))
                .exec()
          }
          const state = runWith(toList(cmds.map(toModelCmd)), { $: 'Cfg', ...cfg }, toModelOmit(omit), empty())

          const raw = (await history().find({ modelName: name }).sort({ _id: 1 }).toArray()) as unknown as RealHist[]
          expect(raw.map(fromRealHist)).toEqual(fromList(state.hist).map(fromModelHist))
          // Independent of the model (CLAIMS.bend: omitted_never_recorded): no entry holds an omitted key.
          const omitted = [...omit.keys, ...(omit.id ? ['_id'] : [])]
          expect(raw.flatMap((h) => Object.keys(h.doc ?? {}).filter((k) => omitted.includes(k)))).toEqual([])
          expect(raw.flatMap((h) => (h.patch ?? []).filter((op) => omitted.includes(op.path.slice(1))))).toEqual([])
          expect(seen.map(fromRealEv)).toEqual(fromList(state.evs).map(fromModelEv))

          const realDocs = await M.collection.find({}).toArray()
          const realStore = realDocs.map((d) => [idOf(d._id), docKey(fieldsOf(d))]).sort()
          const modelStore = fromList(state.store)
            .map(({ id, doc }) => [id, entriesKey(doc)])
            .sort()
          expect(realStore).toEqual(modelStore)

          const noSwitches = cmds.every((cmd) => cmd.kind === 'Create' || (!cmd.flags.hook && !cmd.flags.event && !cmd.flags.history))
          if (cfg.history && noSwitches && !omit.id) {
            for (const id of [1, 2, 3]) {
              const stored = realDocs.find((d) => idOf(d._id) === id)
              const replayed = replayReal(raw, id)
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
})
