import { expect } from 'vitest'

import fc from 'fast-check'
import mongoose from 'mongoose'
import model from '../../laws/generated/history.mjs'
import { patchEventEmitter } from '../../src/index'
import { type BendList, fromList, toList } from './bend'

// The harness that holds the plugin to laws/history.bend: random mongoose call sequences, run on a
// target model and on the model alike, with each call's history entries, events, preDelete and
// onError calls compared, then the store and the replayed history.

const FIELDS = ['f0', 'f1', 'f2', 'f3']
type Doc = Record<string, number>
export type LawDoc = { _id: mongoose.Types.ObjectId; f0?: number; f1?: number; f2?: number; f3?: number }
type Flags = { hook: boolean; event: boolean; history: boolean }
type Item = { id: number; doc: Doc }
// One mongoose call each: save of a new document, updateOne, deleteOne, insertMany, updateMany,
// deleteMany, deleteMany whose preDelete rejects (DeleteVetoed), and updateOne with upsert.
type Call =
  | { kind: 'Create'; id: number; doc: Doc }
  | { kind: 'Update'; id: number; doc: Doc; flags: Flags }
  | { kind: 'Delete'; id: number; flags: Flags }
  | { kind: 'InsertMany'; items: Item[] }
  | { kind: 'UpdateMany'; ids: number[]; doc: Doc; flags: Flags }
  | { kind: 'DeleteMany'; ids: number[]; flags: Flags }
  | { kind: 'DeleteVetoed'; ids: number[]; flags: Flags }
  | { kind: 'Upsert'; id: number; doc: Doc; flags: Flags }
export type Cfg = { history: boolean; events: boolean }
// The omit option: fields left out, and whether _id is too.
export type Omit = { keys: string[]; id: boolean }

type Entry = { k: number; v: number }
type ModelOp = { $: 'Put' | 'Del'; k: number; v?: number }
type ModelHist = { kind: { $: string }; id: number; version: number; doc: BendList<Entry>; patch: BendList<ModelOp> }
type ModelEv = { $: string; doc?: BendList<Entry>; old?: BendList<Entry>; patch?: BendList<ModelOp> }
type ModelState = { store: BendList<{ id: number; doc: BendList<Entry> }>; hist: BendList<ModelHist>; evs: BendList<ModelEv> }
const modelCall = model.call as (cfg: unknown, omit: unknown, st: ModelState, call: unknown) => ModelState
const empty = model.empty as () => ModelState

export const oid = (id: number) => new mongoose.Types.ObjectId(id.toString(16).padStart(24, '0'))
export const idOf = (value: unknown) => Number.parseInt((value as mongoose.Types.ObjectId).toHexString(), 16)
// A field set to undefined is a field the document does not have (the updated event's doc keeps
// $unset fields as undefined; pinned in history.laws.test.ts).
export const fieldsOf = (doc: Record<string, unknown> | null | undefined): Doc => Object.fromEntries(Object.entries(doc ?? {}).filter(([k, v]) => FIELDS.includes(k) && v !== undefined)) as Doc
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
const OP_NAMES: Record<Call['kind'], string> = { Create: 'create', InsertMany: 'create', Update: 'updateOne', UpdateMany: 'updateMany', Delete: 'deleteOne', DeleteMany: 'deleteMany', DeleteVetoed: 'deleteMany', Upsert: 'updateOne' }
const kindOf = (call: Call, live: boolean): Kind => {
  if (call.kind === 'Create' || call.kind === 'InsertMany') return 'KCreate'
  if (call.kind === 'Delete' || call.kind === 'DeleteMany' || call.kind === 'DeleteVetoed') return 'KDelete'
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
  fc.record({ kind: fc.constant('DeleteVetoed' as const), ids: idsArb, flags: flagsArb }),
  fc.record({ kind: fc.constant('Upsert' as const), id: idArb, doc: docArb, flags: flagsArb }),
)

// A known defect (pinned in history.laws.test.ts): an upsert that inserts records the live document with the highest _id
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
    else if (call.kind === 'DeleteMany' || (call.kind === 'DeleteVetoed' && skipped(call.flags))) for (const id of call.ids) live.delete(id)
    else if (call.kind === 'DeleteVetoed') {
      // the veto keeps every document
    } else if (call.kind === 'UpdateMany') for (const id of call.ids.filter((id) => live.has(id))) live.set(id, call.doc)
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
    case 'DeleteVetoed':
      return { $: 'DeleteVetoed', ids: toList(call.ids), flags: modelFlags(call.flags) }
    case 'Upsert':
      return { $: 'Upsert', id: call.id, doc: toEntries(call.doc), flags: modelFlags(call.flags) }
  }
}
const switchesOf = (flags: Flags) => ({ ignoreHook: flags.hook, ignoreEvent: flags.event, ignorePatchHistory: flags.history })

// A whole-document update as $set and $unset: the update path whose history the plugin builds from
// the operators. A replaceOne that drops fields does not record the removal (pinned in history.laws.test.ts).
const replaceWith = (doc: Doc) => ({ $set: { ...doc }, $unset: Object.fromEntries(FIELDS.filter((f) => !(f in doc)).map((f) => [f, 1])) })

const execute = async (M: mongoose.Model<LawDoc>, call: Call, extra: Record<string, unknown> = {}) => {
  switch (call.kind) {
    case 'Create':
      return M.create({ _id: oid(call.id), ...call.doc, ...extra })
    case 'Update':
      return M.updateOne({ _id: oid(call.id) }, replaceWith(call.doc))
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'Delete':
      return M.deleteOne({ _id: oid(call.id) })
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'InsertMany':
      return M.insertMany(call.items.map((item) => ({ _id: oid(item.id), ...item.doc, ...extra })))
    case 'UpdateMany':
      return M.updateMany({ _id: { $in: call.ids.map(oid) } }, replaceWith(call.doc))
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'DeleteMany':
    case 'DeleteVetoed':
      return M.deleteMany({ _id: { $in: call.ids.map(oid) } })
        .setOptions(switchesOf(call.flags))
        .exec()
    case 'Upsert':
      return M.updateOne({ _id: oid(call.id) }, replaceWith(call.doc))
        .setOptions({ ...switchesOf(call.flags), upsert: true })
        .exec()
  }
}
// The hook does nothing, preDelete included, with ignoreHook or with both ignoreEvent and ignorePatchHistory.
const skipped = (flags: Flags) => flags.hook || (flags.event && flags.history)
// The documents a delete matches, which preDelete must be given.
const deleteFilter = (call: Call) => {
  if (call.kind === 'Delete') return { _id: oid(call.id) }
  if (call.kind === 'DeleteMany' || call.kind === 'DeleteVetoed') return { _id: { $in: call.ids.map(oid) } }
  return undefined
}
const noSwitch = (call: Call) => !('flags' in call) || (!call.flags.hook && !call.flags.event && !call.flags.history)

const strip = (doc: Doc, omit: Omit): Doc => Object.fromEntries(Object.entries(doc).filter(([k]) => !omit.keys.includes(k)))
const toModelOmit = (omit: Omit) => ({ $: 'Omit', keys: toList(omit.keys.map((k) => FIELDS.indexOf(k))), id: omit.id })
// With every history write rejected, the plugin must act as with history off, and report each failed
// write to onError: one per updated document, one per bulk write of created or deleted documents.
const failedWrites = (entries: ModelHist[]) => entries.filter((h) => h.kind.$ === 'KUpdate').length + (entries.some((h) => h.kind.$ !== 'KUpdate') ? 1 : 0)
const VETO = new Error('preDelete vetoed the delete')

// A model under test: its plugin configuration and, for every created document, fields the laws do
// not cover (extra), which must not change what is recorded.
export type Target = { cfg: Cfg; omit: Omit; rejected: boolean; M: mongoose.Model<LawDoc>; extra?: Record<string, unknown> }

export const createHarness = () => {
  const seen: RealEv[] = []
  const predeleted: Doc[][] = []
  const errors: unknown[] = []
  let veto = false
  const preDelete = async (docs: object[]) => {
    predeleted.push(docs.map((doc) => fieldsOf(doc as Record<string, unknown>)))
    if (veto) throw VETO
  }
  const onError = (error: Error) => {
    errors.push(error)
  }
  const pluginOptions = (name: string, cfg: Cfg, omit: Omit) => {
    const events = cfg.events ? { eventCreated: `${name}:created`, eventUpdated: `${name}:updated`, eventDeleted: `${name}:deleted` } : {}
    for (const [suffix, kind] of [
      ['created', 'ECreated'],
      ['updated', 'EUpdated'],
      ['deleted', 'EDeleted'],
    ]) {
      patchEventEmitter.on(`${name}:${suffix}`, (payload) => seen.push({ kind, payload }))
    }
    return { omit: ['__v', ...omit.keys, ...(omit.id ? ['_id'] : [])], patchHistoryDisabled: !cfg.history, preDelete, onError, ...events }
  }
  const history = () => mongoose.connection.collection('history')
  const rejectHistoryWrites = async (reject: boolean) => {
    await mongoose.connection.db?.command({ collMod: 'history', validator: reject ? { never: { $exists: true } } : {}, validationAction: 'error' })
  }

  // Runs a delete with preDelete vetoing when asked, and checks that preDelete got the matched
  // documents, whole, unless the hook is skipped or nothing matched, and that only the veto fails it.
  const executeChecked = async (M: mongoose.Model<LawDoc>, call: Call, extra: Record<string, unknown>) => {
    const filter = deleteFilter(call)
    const matched = filter ? (await M.find(filter).lean().exec()).slice(0, call.kind === 'Delete' ? 1 : undefined).map(fieldsOf) : []
    const calls = predeleted.length
    veto = call.kind === 'DeleteVetoed'
    const failure = await execute(M, call, extra).then(
      () => undefined,
      (error: unknown) => error,
    )
    veto = false
    const hooked = filter !== undefined && 'flags' in call && !skipped(call.flags) && matched.length > 0
    expect(predeleted.slice(calls).map((docs) => bag(docs))).toEqual(hooked ? [bag(matched)] : [])
    expect(failure).toBe(hooked && call.kind === 'DeleteVetoed' ? VETO : undefined)
  }

  // One call: what it writes and emits, and the onError calls it causes, against the model's.
  const checkCall = async (target: Target, call: Call, states: { state: ModelState; healthy: ModelState }, recorded: { kind: Kind; h: RealHist }[]) => {
    const { cfg, omit, rejected, M, extra = {} } = target
    // Rejected writes act as history off; the model with history on says which writes failed.
    const modelCfg = { $: 'Cfg', ...cfg, history: cfg.history && !rejected }
    const healthyCfg = { $: 'Cfg', ...cfg }
    const modelOmit = toModelOmit(omit)
    const omitted = [...omit.keys, ...(omit.id ? ['_id'] : [])]
    const live = call.kind === 'Upsert' && (await M.exists({ _id: oid(call.id) })) !== null
    const evsBefore = seen.length
    const errorsBefore = errors.length
    await executeChecked(M, call, extra)
    const next = modelCall(modelCfg, modelOmit, states.state, toModelCall(call))
    const healthyNext = modelCall(healthyCfg, modelOmit, states.healthy, toModelCall(call))
    expect(errors.length - errorsBefore).toBe(rejected ? failedWrites(fromList(healthyNext.hist).slice(fromList(states.healthy.hist).length)) : 0)

    // Every entry written, whatever its model: an entry recorded under another name is still one too many.
    const written = (await history().find({}).sort({ _id: 1 }).skip(recorded.length).toArray()) as unknown as RealHist[]
    const kind = kindOf(call, live)
    expect(written.map((h) => h.op).filter((op) => op !== OP_NAMES[call.kind])).toEqual([])
    expect(bag(written.map((h) => fromRealHist(h, kind)))).toEqual(bag(fromList(next.hist).slice(fromList(states.state.hist).length).map(fromModelHist)))
    expect(bag(seen.slice(evsBefore).map(fromRealEv))).toEqual(bag(fromList(next.evs).slice(fromList(states.state.evs).length).map(fromModelEv)))
    // Independent of the model (CLAIMS.bend: omitted_never_recorded): no entry holds an omitted key.
    expect(written.flatMap((h) => Object.keys(h.doc ?? {}).filter((k) => omitted.includes(k)))).toEqual([])
    expect(written.flatMap((h) => (h.patch ?? []).filter((op) => omitted.includes(op.path.slice(1))))).toEqual([])
    recorded.push(...written.map((h) => ({ kind, h })))
    states.state = next
    states.healthy = healthyNext
  }

  // Random call sequences on the target: each call checked, then the store, then the replay.
  const checkSequences = async (target: Target, numRuns: number) => {
    const { cfg, omit, rejected, M } = target
    let sequences = 0
    await rejectHistoryWrites(rejected)
    await fc
      .assert(
        fc.asyncProperty(fc.array(callArb, { maxLength: 8 }).map(contractCalls), async (calls) => {
          sequences++
          await M.collection.deleteMany({})
          await history().deleteMany({})
          seen.length = 0
          errors.length = 0
          const states = { state: empty(), healthy: empty() }
          const recorded: { kind: Kind; h: RealHist }[] = []
          for (const call of calls) await checkCall(target, call, states, recorded)

          const realDocs = await M.collection.find({}).toArray()
          const realStore = realDocs.map((d) => [idOf(d._id), docKey(fieldsOf(d))]).sort()
          const modelStore = fromList(states.state.store)
            .map(({ id, doc }) => [id, entriesKey(doc)])
            .sort()
          expect(realStore).toEqual(modelStore)

          if (cfg.history && !rejected && calls.every(noSwitch) && !omit.id) {
            for (const id of [1, 2, 3]) {
              const stored = realDocs.find((d) => idOf(d._id) === id)
              const replayed = replayReal(recorded, id)
              expect(replayed && docKey(replayed)).toEqual(stored && docKey(strip(fieldsOf(stored), omit)))
            }
          }
        }),
        { numRuns },
      )
      .finally(() => rejectHistoryWrites(false))
    expect(sequences).toBe(numRuns)
  }

  return { seen, pluginOptions, history, checkSequences }
}
