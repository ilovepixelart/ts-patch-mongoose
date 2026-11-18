import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Document, model, Schema, Types } from 'mongoose'
import em from '../src/em'
import * as api from '../src/index'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

interface Thing {
  name: string
  count: number
  tags: string[]
  secret?: string
}

const CREATED = 'char-created'
const UPDATED = 'char-updated'
const DELETED = 'char-deleted'

type Call = { fn: string; arg: Record<string, unknown> }
const calls: Call[] = []
const preDeleted: { docs: Record<string, unknown>[]; storedAtCall: number }[] = []
const errors: Error[] = []

const ThingSchema = new Schema<Thing>({
  name: { type: String, required: true },
  count: { type: Number, default: 0 },
  tags: { type: [String], default: [] },
  secret: { type: String, select: false },
})

ThingSchema.plugin(patchHistoryPlugin, {
  eventCreated: CREATED,
  eventUpdated: UPDATED,
  eventDeleted: DELETED,
  omit: ['__v'],
  getUser: (doc) => {
    calls.push({ fn: 'getUser', arg: doc as unknown as Record<string, unknown> })
    return { name: (doc as unknown as Thing).name }
  },
  getReason: () => 'because',
  getMetadata: () => ({ source: 'char' }),
  preDelete: async (docs) => {
    const ids = docs.map((d) => d._id)
    preDeleted.push({ docs: docs as unknown as Record<string, unknown>[], storedAtCall: await ThingModel.countDocuments({ _id: { $in: ids } }) })
  },
  onError: (error) => {
    errors.push(error)
  },
})

const ThingModel = model<Thing>('CharThing', ThingSchema)

const PlainSchema = new Schema<{ name: string; tags: string[] }>({ name: String, tags: { type: [String], default: [] } })
PlainSchema.plugin(patchHistoryPlugin, { eventUpdated: UPDATED })
const PlainModel = model('CharPlain', PlainSchema)

const BrokenSchema = new Schema<{ name: string }>({ name: String })
BrokenSchema.plugin(patchHistoryPlugin, {
  modelName: '',
  onError: (error) => {
    errors.push(error)
  },
})
const BrokenModel = model('CharBroken', BrokenSchema)

type Emitted = { event: string; payload: Record<string, unknown> }

const listen = () => {
  const seen: Emitted[] = []
  for (const event of [CREATED, UPDATED, DELETED]) {
    em.on(event, (payload: Record<string, unknown>) => {
      seen.push({ event, payload })
    })
  }
  return seen
}

const STRIP = ['_id', '__v', 'createdAt', 'updatedAt']
const entries = async () => {
  const rows = await HistoryModel.find({ modelName: 'CharThing' }).sort({ createdAt: 1, _id: 1 }).lean()
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !STRIP.includes(k))))
}

describe('characterization: observable behaviour of the plugin', () => {
  const instance = server('characterization')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('charthings').deleteMany({})
    await mongoose.connection.collection('charplains').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
    em.removeAllListeners()
    calls.length = 0
    preDeleted.length = 0
    errors.length = 0
  })

  it('exports exactly patchHistoryPlugin, patchEventEmitter and setPatchHistoryTTL at runtime', () => {
    expect(Object.keys(api).sort()).toEqual(['patchEventEmitter', 'patchHistoryPlugin', 'setPatchHistoryTTL'])
    expect(api.patchEventEmitter).toBe(em)
  })

  describe('create', () => {
    it('save() of a new doc writes one create entry with the omitted doc, version 0 and user, reason, metadata', async () => {
      const doc = await new ThingModel({ name: 'a', tags: ['x'] }).save()
      expect(await entries()).toEqual([
        {
          op: 'create',
          modelName: 'CharThing',
          collectionName: 'charthings',
          collectionId: doc._id,
          doc: { _id: doc._id, name: 'a', count: 0, tags: ['x'] },
          patch: [],
          version: 0,
          user: { name: 'a' },
          reason: 'because',
          metadata: { source: 'char' },
        },
      ])
    })

    it('save() of a new doc emits the created event with only the omitted doc as a plain object', async () => {
      const seen = listen()
      const doc = await ThingModel.create({ name: 'a' })
      expect(seen).toEqual([{ event: CREATED, payload: { doc: { _id: doc._id, name: 'a', count: 0, tags: [] } } }])
      expect(seen[0]?.payload.doc).not.toBeInstanceOf(Document)
    })

    it('getUser receives the created doc before omit, as it was before the insert (no version key yet)', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      expect(calls).toEqual([{ fn: 'getUser', arg: { _id: doc._id, name: 'a', count: 0, tags: [] } }])
    })

    it('insertMany writes one create entry per doc with op create', async () => {
      const docs = await ThingModel.insertMany([{ name: 'a' }, { name: 'b' }])
      const rows = await entries()
      expect(rows.map((r) => [r.op, String(r.collectionId), r.version, (r.doc as { name: string }).name])).toEqual([
        ['create', String(docs[0]?._id), 0, 'a'],
        ['create', String(docs[1]?._id), 0, 'b'],
      ])
    })
  })

  describe('update', () => {
    it('save() of an existing doc writes an update entry with test and replace ops and the next version', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      doc.name = 'b'
      await doc.save()
      const rows = await entries()
      expect(rows[1]).toEqual({
        op: 'update',
        modelName: 'CharThing',
        collectionName: 'charthings',
        collectionId: doc._id,
        patch: [
          { op: 'test', path: '/name', value: 'a' },
          { op: 'replace', path: '/name', value: 'b' },
        ],
        version: 1,
        user: { name: 'b' },
        reason: 'because',
        metadata: { source: 'char' },
      })
    })

    it('the save() update event carries the stored doc as oldDoc and the saved doc as doc', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const seen = listen()
      doc.name = 'b'
      await doc.save()
      expect(seen).toEqual([
        {
          event: UPDATED,
          payload: {
            oldDoc: { _id: doc._id, name: 'a', count: 0, tags: [], __v: 0 },
            doc: { _id: doc._id, name: 'b', count: 0, tags: [], __v: 0 },
            patch: [
              { op: 'test', path: '/name', value: 'a' },
              { op: 'replace', path: '/name', value: 'b' },
            ],
          },
        },
      ])
    })

    it('without omit, a save() that pushes to an array records the array change and the version key', async () => {
      const doc = await PlainModel.create({ name: 'a' })
      doc.tags.push('x')
      await doc.save()
      const [row] = await HistoryModel.find({ modelName: 'CharPlain', op: 'update' }).lean()
      expect(row?.patch).toEqual([{ op: 'add', path: '/tags/0', value: 'x' }])
    })

    it('without omit, an updateOne records no version key change', async () => {
      const doc = await PlainModel.create({ name: 'a' })
      await PlainModel.updateOne({ _id: doc._id }, { $push: { tags: 'x' } })
      const [row] = await HistoryModel.find({ modelName: 'CharPlain', op: 'updateOne' }).lean()
      expect(row?.patch).toEqual([{ op: 'add', path: '/tags/0', value: 'x' }])
    })

    it('updateOne writes an update entry named after the query op, versions count up from the create entry', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } })
      await ThingModel.updateOne({ _id: doc._id }, { $inc: { count: 2 } })
      const rows = await entries()
      expect(rows.map((r) => [r.op, r.version, r.patch])).toEqual([
        ['create', 0, []],
        [
          'updateOne',
          1,
          [
            { op: 'test', path: '/name', value: 'a' },
            { op: 'replace', path: '/name', value: 'b' },
          ],
        ],
        [
          'updateOne',
          2,
          [
            { op: 'test', path: '/count', value: 0 },
            { op: 'replace', path: '/count', value: 2 },
          ],
        ],
      ])
    })

    it('an update to a doc without history starts at version 0', async () => {
      const { insertedId } = await mongoose.connection.collection('charthings').insertOne({ name: 'raw', count: 0, tags: [] })
      await ThingModel.updateOne({ _id: insertedId }, { $set: { name: 'b' } })
      await ThingModel.updateOne({ _id: insertedId }, { $set: { name: 'c' } })
      expect((await entries()).map((r) => [r.op, r.version])).toEqual([
        ['updateOne', 0],
        ['updateOne', 1],
      ])
    })

    it('the update event carries oldDoc and doc as plain objects without omit, and the omitted patch', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const seen = listen()
      await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } })
      expect(seen).toEqual([
        {
          event: UPDATED,
          payload: {
            oldDoc: { _id: doc._id, name: 'a', count: 0, tags: [], __v: 0 },
            doc: { _id: doc._id, name: 'b', count: 0, tags: [], __v: 0 },
            patch: [
              { op: 'test', path: '/name', value: 'a' },
              { op: 'replace', path: '/name', value: 'b' },
            ],
          },
        },
      ])
      expect(seen[0]?.payload.oldDoc).not.toBeInstanceOf(Document)
      expect(seen[0]?.payload.doc).not.toBeInstanceOf(Document)
      expect((seen[0]?.payload.doc as { _id?: unknown } | undefined)?._id).toBeInstanceOf(Types.ObjectId)
    })

    it('getUser receives the after-update state for query updates', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      calls.length = 0
      await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } })
      expect(calls).toEqual([{ fn: 'getUser', arg: { _id: doc._id, name: 'b', count: 0, tags: [], __v: 0 } }])
    })

    it('an update that changes nothing writes no entry and emits no event', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const seen = listen()
      await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'a' } })
      doc.name = 'a'
      await doc.save()
      expect({ rows: (await entries()).length, seen }).toEqual({ rows: 1, seen: [] })
    })

    it('updateMany writes one entry and emits one event per changed doc', async () => {
      await ThingModel.create([{ name: 'a' }, { name: 'b' }, { name: 'c', count: 5 }])
      const seen = listen()
      await ThingModel.updateMany({}, { $set: { count: 5 } })
      const rows = (await entries()).filter((r) => r.op === 'updateMany')
      expect({ rows: rows.length, events: seen.length }).toEqual({ rows: 2, events: 2 })
    })

    it('records findOneAndUpdate, findByIdAndUpdate, replaceOne and findOneAndReplace under their query op names', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      await ThingModel.findOneAndUpdate({ _id: doc._id }, { $set: { name: 'b' } })
      await ThingModel.findByIdAndUpdate(doc._id, { $set: { name: 'c' } })
      await ThingModel.replaceOne({ _id: doc._id }, { name: 'd', count: 0, tags: [] })
      await ThingModel.findOneAndReplace({ _id: doc._id }, { name: 'e', count: 0, tags: [] })
      expect((await entries()).map((r) => [r.op, r.version])).toEqual([
        ['create', 0],
        ['findOneAndUpdate', 1],
        ['findOneAndUpdate', 2],
        ['replaceOne', 3],
        ['findOneAndReplace', 4],
      ])
    })

    it('does not change what the query returns', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const before = await ThingModel.findOneAndUpdate({ _id: doc._id }, { $set: { name: 'b' } }).lean()
      const after = await ThingModel.findOneAndUpdate({ _id: doc._id }, { $set: { name: 'c' } }, { new: true }).lean()
      const res = await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'd' } })
      expect({ before: before?.name, after: after?.name, matched: res.matchedCount, modified: res.modifiedCount }).toEqual({ before: 'a', after: 'c', matched: 1, modified: 1 })
    })
  })

  describe('upsert', () => {
    it('updateOne with upsert that inserts writes a create-shaped entry under the query op and emits the created event', async () => {
      const seen = listen()
      await ThingModel.updateOne({ name: 'new' }, { $set: { count: 3 } }, { upsert: true })
      const stored = await ThingModel.findOne({ name: 'new' }).lean()
      expect(await entries()).toEqual([
        {
          op: 'updateOne',
          modelName: 'CharThing',
          collectionName: 'charthings',
          collectionId: stored?._id,
          doc: { _id: stored?._id, name: 'new', count: 3, tags: [] },
          patch: [],
          version: 0,
          user: { name: 'new' },
          reason: 'because',
          metadata: { source: 'char' },
        },
      ])
      expect(seen).toEqual([{ event: CREATED, payload: { doc: { _id: stored?._id, name: 'new', count: 3, tags: [] } } }])
    })

    it('findOneAndUpdate with upsert that inserts writes a create-shaped entry under findOneAndUpdate', async () => {
      await ThingModel.findOneAndUpdate({ name: 'new' }, { $set: { count: 3 } }, { upsert: true, new: true })
      expect((await entries()).map((r) => [r.op, r.version, (r.doc as { name: string }).name, r.patch])).toEqual([['findOneAndUpdate', 0, 'new', []]])
    })

    it('updateOne with upsert that matches a doc writes an update entry', async () => {
      await ThingModel.create({ name: 'a' })
      const seen = listen()
      await ThingModel.updateOne({ name: 'a' }, { $set: { count: 3 } }, { upsert: true })
      expect((await entries()).map((r) => [r.op, r.version])).toEqual([
        ['create', 0],
        ['updateOne', 1],
      ])
      expect(seen.map((s) => s.event)).toEqual([UPDATED])
    })
  })

  describe('delete', () => {
    it('deleteOne writes a delete entry with the omitted lean doc and emits the deleted event', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const seen = listen()
      await ThingModel.deleteOne({ _id: doc._id })
      const rows = await entries()
      expect(rows[1]).toEqual({
        op: 'deleteOne',
        modelName: 'CharThing',
        collectionName: 'charthings',
        collectionId: doc._id,
        doc: { _id: doc._id, name: 'a', count: 0, tags: [] },
        patch: [],
        version: 0,
        user: { name: 'a' },
        reason: 'because',
        metadata: { source: 'char' },
      })
      expect(seen).toEqual([{ event: DELETED, payload: { oldDoc: { _id: doc._id, name: 'a', count: 0, tags: [] } } }])
    })

    it('records deleteMany, findOneAndDelete and findByIdAndDelete under their query op names', async () => {
      const [a, b] = await ThingModel.create([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }])
      await ThingModel.findOneAndDelete({ _id: a?._id })
      await ThingModel.findByIdAndDelete(b?._id)
      await ThingModel.deleteMany({ name: { $in: ['c', 'd'] } })
      const rows = (await entries()).filter((r) => r.op !== 'create')
      expect(rows.map((r) => [r.op, (r.doc as { name: string }).name, String(r.collectionId) === String((r.doc as { _id: unknown })._id)]).sort()).toEqual([
        ['deleteMany', 'c', true],
        ['deleteMany', 'd', true],
        ['findOneAndDelete', 'a', true],
        ['findOneAndDelete', 'b', true],
      ])
    })

    it('preDelete is called once, before the delete, with lean copies of the matching docs', async () => {
      const docs = await ThingModel.insertMany([{ name: 'a' }, { name: 'b' }])
      await ThingModel.deleteMany({})
      expect(preDeleted).toEqual([
        {
          docs: docs.map((d) => ({ _id: d._id, name: d.name, count: 0, tags: [], __v: 0 })),
          storedAtCall: 2,
        },
      ])
      expect(preDeleted[0]?.docs[0]).not.toBeInstanceOf(Document)
    })

    it('preDelete is not called and nothing is recorded when nothing matches', async () => {
      const seen = listen()
      await ThingModel.deleteMany({ name: 'nobody' })
      await ThingModel.deleteOne({ name: 'nobody' })
      expect({ preDeleted, rows: await entries(), seen }).toEqual({ preDeleted: [], rows: [], seen: [] })
    })
  })

  describe('query options', () => {
    it('ignoreEvent keeps history and suppresses the event', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const seen = listen()
      await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } }).setOptions({ ignoreEvent: true })
      await ThingModel.deleteOne({ _id: doc._id }).setOptions({ ignoreEvent: true })
      expect({ ops: (await entries()).map((r) => r.op), seen }).toEqual({ ops: ['create', 'updateOne', 'deleteOne'], seen: [] })
    })

    it('ignorePatchHistory keeps the event and suppresses history', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const seen = listen()
      await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } }).setOptions({ ignorePatchHistory: true })
      await ThingModel.deleteOne({ _id: doc._id }).setOptions({ ignorePatchHistory: true })
      expect({ ops: (await entries()).map((r) => r.op), events: seen.map((s) => s.event) }).toEqual({ ops: ['create'], events: [UPDATED, DELETED] })
    })

    it('ignoreHook, or ignoreEvent with ignorePatchHistory, records and emits nothing and skips preDelete', async () => {
      const [a, b] = await ThingModel.create([{ name: 'a' }, { name: 'b' }])
      const seen = listen()
      await ThingModel.updateOne({ _id: a?._id }, { $set: { name: 'x' } }).setOptions({ ignoreHook: true })
      await ThingModel.updateOne({ _id: b?._id }, { $set: { name: 'y' } }).setOptions({ ignoreEvent: true, ignorePatchHistory: true })
      await ThingModel.deleteOne({ _id: a?._id }).setOptions({ ignoreHook: true })
      await ThingModel.deleteOne({ _id: b?._id }).setOptions({ ignoreEvent: true, ignorePatchHistory: true })
      expect({ ops: (await entries()).map((r) => r.op), seen, preDeleted }).toEqual({ ops: ['create', 'create'], seen: [], preDeleted: [] })
    })
  })

  describe('errors', () => {
    it('a throwing event listener neither rejects the operation nor stops history', async () => {
      em.on(UPDATED, () => {
        throw new Error('listener failed')
      })
      const doc = await ThingModel.create({ name: 'a' })
      await expect(ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } })).resolves.toBeDefined()
      expect((await entries()).map((r) => r.op)).toEqual(['create', 'updateOne'])
    })

    it('a failing update history write goes to onError and does not reject the operation', async () => {
      const doc = await BrokenModel.create({ name: 'a' })
      errors.length = 0
      await expect(BrokenModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } })).resolves.toBeDefined()
      expect(errors.map((e) => e.name)).toEqual(['ValidationError'])
      expect(await BrokenModel.countDocuments({ name: 'b' })).toBe(1)
    })
  })

  describe('timing', () => {
    const WRITES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite']
    const trace = () => {
      const order: string[] = []
      mongoose.set('debug', (collection: string, method: string) => {
        if (WRITES.includes(method)) order.push(`${collection}.${method}`)
      })
      for (const event of [CREATED, UPDATED, DELETED]) {
        em.on(event, () => {
          order.push(event)
        })
      }
      return order
    }

    it('orders the update write, its event and its history write', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const order = trace()
      await ThingModel.updateOne({ _id: doc._id }, { $set: { name: 'b' } })
      mongoose.set('debug', false)
      expect(order).toEqual([UPDATED, 'history.insertOne', 'charthings.updateOne'])
    })

    it('orders the save() insert, its event and its history write', async () => {
      const order = trace()
      await ThingModel.create({ name: 'a' })
      mongoose.set('debug', false)
      expect(order).toEqual([CREATED, 'history.bulkWrite', 'charthings.insertOne'])
    })

    it('orders the delete, its event and its history write', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      const order = trace()
      await ThingModel.deleteOne({ _id: doc._id })
      mongoose.set('debug', false)
      expect(order).toEqual(['charthings.deleteOne', DELETED, 'history.bulkWrite'])
    })
  })

  describe('stored state', () => {
    it('a select: false path set by an update is recorded', async () => {
      const doc = await ThingModel.create({ name: 'a' })
      await ThingModel.updateOne({ _id: doc._id }, { $set: { secret: 's1' } })
      const rows = await entries()
      expect(rows[1]?.patch).toContainEqual({ op: 'add', path: '/secret', value: 's1' })
    })
  })
})
