import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import { isMongoose6, isMongooseLessThan8 } from '../src/version'
import replSet from './mongo/repl-set'

import type { Types } from 'mongoose'

// Pins what users observe today: stored history entries, event payloads and their order,
// the commands sent for single-document operations, and how getter failures surface.

interface Item {
  name: string
  count: number
}

const CREATED = 'char-item-created'
const UPDATED = 'char-item-updated'
const DELETED = 'char-item-deleted'

let userMode: 'ok' | 'throw' | 'reject' = 'ok'
const onError = vi.fn()

const ItemSchema = new Schema<Item>({
  name: { type: String, required: true },
  count: { type: Number, default: 0 },
})

ItemSchema.plugin(patchHistoryPlugin, {
  eventCreated: CREATED,
  eventUpdated: UPDATED,
  eventDeleted: DELETED,
  omit: ['__v'],
  getUser: () => {
    if (userMode === 'throw') throw new Error('no user')
    if (userMode === 'reject') return Promise.reject(new Error('no user'))
    return { id: 'u1' }
  },
  getReason: () => 'r1',
  getMetadata: () => ({ m: 1 }),
  onError,
})

const ItemModel = model<Item>('CharItem', ItemSchema)

type Entry = Record<string, unknown>

const json = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V

const entries = async (): Promise<Entry[]> => {
  const rows = await HistoryModel.find({ modelName: 'CharItem' }).sort({ _id: 1 }).lean()
  return rows.map(({ _id, createdAt, updatedAt, ...rest }) => json(rest) as Entry)
}

const events: { name: string; data: unknown }[] = []

const listen = () => {
  for (const name of [CREATED, UPDATED, DELETED]) {
    em.on(name, (data: unknown) => {
      events.push({ name, data: json(data) })
    })
  }
}

const recordCommands = () => {
  const commands: string[] = []
  const sessionKeys: string[] = []
  mongoose.set('debug', (collection: string, method: string, ...args: unknown[]) => {
    commands.push(`${collection}.${method}`)
    for (const arg of args) {
      if (arg && typeof arg === 'object' && Object.hasOwn(arg, 'session')) sessionKeys.push(`${collection}.${method}`)
    }
  })
  return { commands, sessionKeys }
}

const meta = { user: { id: 'u1' }, reason: 'r1', metadata: { m: 1 } }
const base = { modelName: 'CharItem', collectionName: 'charitems' }
// jsonPatch compare runs invertible: every replace is preceded by a test of the old value.
const replace = (path: string, from: unknown, to: unknown) => [
  { op: 'test', path, value: from },
  { op: 'replace', path, value: to },
]
// Entries written through Model.bulkWrite (create and delete paths) get no version key on mongoose 6.
const bulkWriteVersionKey = isMongoose6 ? {} : { __v: 0 }
const idOf = (doc: { _id: Types.ObjectId }): string => String(doc._id)

describe('history characterization (no session)', () => {
  const instance = replSet()

  beforeAll(async () => {
    await instance.create()
    await ItemModel.init()
    await HistoryModel.init()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('charitems').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
    events.length = 0
    userMode = 'ok'
    onError.mockClear()
    em.removeAllListeners()
    listen()
  })

  afterEach(() => {
    mongoose.set('debug', false)
  })

  describe('stored entries and events', () => {
    it('save of a new document stores one create entry with the full doc and emits created', async () => {
      const doc = await new ItemModel({ name: 'a' }).save()
      const id = idOf(doc)
      expect(await entries()).toEqual([{ ...base, op: 'create', collectionId: id, doc: { _id: id, name: 'a', count: 0 }, patch: [], version: 0, ...meta, ...bulkWriteVersionKey }])
      expect(events).toEqual([{ name: CREATED, data: { doc: { _id: id, name: 'a', count: 0 } } }])
    })

    it('save of an existing document stores an update entry with the patch and the next version', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      events.length = 0
      doc.count = 5
      await doc.save()
      const id = idOf(doc)
      const [, update] = await entries()
      expect(update).toEqual({ ...base, op: 'update', collectionId: id, patch: replace('/count', 0, 5), version: 1, ...meta, __v: 0 })
      expect(events).toEqual([{ name: UPDATED, data: { oldDoc: { _id: id, name: 'a', count: 0, __v: 0 }, doc: { _id: id, name: 'a', count: 5, __v: 0 }, patch: replace('/count', 0, 5) } }])
    })

    it('Model.create of two documents stores two create entries in input order', async () => {
      const [a, b] = await ItemModel.create([{ name: 'a' }, { name: 'b' }])
      const rows = await entries()
      expect(rows.map((r) => [r.op, r.collectionId, (r.doc as Entry).name, r.version])).toEqual([
        ['create', idOf(a as never), 'a', 0],
        ['create', idOf(b as never), 'b', 0],
      ])
    })

    it('insertMany stores one create entry per document in input order and emits created in that order', async () => {
      const docs = await ItemModel.insertMany([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
      const ids = docs.map((d) => idOf(d as never))
      expect(await entries()).toEqual(docs.map((d, i) => ({ ...base, op: 'create', collectionId: ids[i], doc: { _id: ids[i], name: d.name, count: 0 }, patch: [], version: 0, ...meta, ...bulkWriteVersionKey })))
      expect(events.map((e) => [e.name, (e.data as { doc: Entry }).doc.name])).toEqual([
        [CREATED, 'a'],
        [CREATED, 'b'],
        [CREATED, 'c'],
      ])
    })

    it('updateOne stores an updateOne entry with the patch and version 1 and emits updated with oldDoc, doc and patch', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      events.length = 0
      await ItemModel.updateOne({ _id: doc._id }, { $set: { count: 3 } })
      const id = idOf(doc)
      const [, update] = await entries()
      expect(update).toEqual({ ...base, op: 'updateOne', collectionId: id, patch: replace('/count', 0, 3), version: 1, ...meta, __v: 0 })
      expect(events).toEqual([{ name: UPDATED, data: { oldDoc: { _id: id, name: 'a', count: 0, __v: 0 }, doc: { _id: id, name: 'a', count: 3, __v: 0 }, patch: replace('/count', 0, 3) } }])
    })

    it('updateMany stores one entry per matched document in cursor order with per-document versions', async () => {
      const [a, b, c] = await ItemModel.insertMany([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
      await ItemModel.updateOne({ _id: a?._id }, { $set: { count: 1 } })
      await ItemModel.updateOne({ _id: a?._id }, { $set: { count: 2 } })
      await mongoose.connection.collection('history').deleteMany({ op: { $ne: 'create' }, collectionId: { $ne: a?._id } })
      events.length = 0

      await ItemModel.updateMany({}, { $set: { count: 9 } })

      const rows = (await entries()).filter((r) => r.op === 'updateMany')
      expect(rows).toEqual([
        { ...base, op: 'updateMany', collectionId: idOf(a as never), patch: replace('/count', 2, 9), version: 3, ...meta, __v: 0 },
        { ...base, op: 'updateMany', collectionId: idOf(b as never), patch: replace('/count', 0, 9), version: 1, ...meta, __v: 0 },
        { ...base, op: 'updateMany', collectionId: idOf(c as never), patch: replace('/count', 0, 9), version: 1, ...meta, __v: 0 },
      ])
      expect(events.map((e) => [e.name, (e.data as { doc: Entry }).doc.name, (e.data as { oldDoc: Entry }).oldDoc.count])).toEqual([
        [UPDATED, 'a', 2],
        [UPDATED, 'b', 0],
        [UPDATED, 'c', 0],
      ])
    })

    it('updateMany skips documents whose patch is empty, keeping the others in order', async () => {
      const [a, , c] = await ItemModel.insertMany([{ name: 'a' }, { name: 'b', count: 4 }, { name: 'c' }])
      events.length = 0
      await ItemModel.updateMany({}, { $set: { count: 4 } })
      const rows = (await entries()).filter((r) => r.op === 'updateMany')
      expect(rows.map((r) => [r.collectionId, r.version])).toEqual([
        [idOf(a as never), 1],
        [idOf(c as never), 1],
      ])
      expect(events).toHaveLength(2)
    })

    it('updateMany twice increments every version by one', async () => {
      await ItemModel.insertMany([{ name: 'a' }, { name: 'b' }])
      await ItemModel.updateMany({}, { $set: { count: 1 } })
      await ItemModel.updateMany({}, { $set: { count: 2 } })
      const rows = (await entries()).filter((r) => r.op === 'updateMany')
      expect(rows.map((r) => [(r.patch as Entry[])[1]?.value, r.version])).toEqual([
        [1, 1],
        [1, 1],
        [2, 2],
        [2, 2],
      ])
    })

    it('updateMany with ignorePatchHistory emits events and stores nothing', async () => {
      await ItemModel.insertMany([{ name: 'a' }, { name: 'b' }])
      events.length = 0
      await ItemModel.updateMany({}, { $set: { count: 1 } }).setOptions({ ignorePatchHistory: true })
      expect((await entries()).filter((r) => r.op === 'updateMany')).toEqual([])
      expect(events).toHaveLength(2)
    })

    it('updateMany with ignoreEvent stores entries and emits nothing', async () => {
      await ItemModel.insertMany([{ name: 'a' }, { name: 'b' }])
      events.length = 0
      await ItemModel.updateMany({}, { $set: { count: 1 } }).setOptions({ ignoreEvent: true })
      expect((await entries()).filter((r) => r.op === 'updateMany')).toHaveLength(2)
      expect(events).toEqual([])
    })

    it('findOneAndUpdate stores a findOneAndUpdate entry', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      await ItemModel.findOneAndUpdate({ _id: doc._id }, { $set: { name: 'b' } })
      const [, update] = await entries()
      expect(update).toEqual({ ...base, op: 'findOneAndUpdate', collectionId: idOf(doc), patch: replace('/name', 'a', 'b'), version: 1, ...meta, __v: 0 })
    })

    it('replaceOne stores a replaceOne entry', async () => {
      const doc = await ItemModel.create({ name: 'a', count: 1 })
      await ItemModel.replaceOne({ _id: doc._id }, { name: 'z', count: 1 })
      const [, update] = await entries()
      expect(update).toEqual({ ...base, op: 'replaceOne', collectionId: idOf(doc), patch: replace('/name', 'a', 'z'), version: 1, ...meta, __v: 0 })
    })

    it('an upsert that inserts stores a create-shaped entry under the update op and emits created', async () => {
      await ItemModel.updateOne({ name: 'up' }, { $set: { count: 7 } }, { upsert: true })
      const created = await ItemModel.findOne({ name: 'up' }).orFail()
      const id = idOf(created)
      expect(await entries()).toEqual([{ ...base, op: 'updateOne', collectionId: id, doc: { _id: id, name: 'up', count: 7 }, patch: [], version: 0, ...meta, ...bulkWriteVersionKey }])
      expect(events).toEqual([{ name: CREATED, data: { doc: { _id: id, name: 'up', count: 7 } } }])
    })

    it('deleteOne stores a deleteOne entry with the deleted doc and emits deleted', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      events.length = 0
      await ItemModel.deleteOne({ _id: doc._id })
      const id = idOf(doc)
      const [, removed] = await entries()
      expect(removed).toEqual({ ...base, op: 'deleteOne', collectionId: id, doc: { _id: id, name: 'a', count: 0 }, patch: [], version: 0, ...meta, ...bulkWriteVersionKey })
      expect(events).toEqual([{ name: DELETED, data: { oldDoc: { _id: id, name: 'a', count: 0 } } }])
    })

    it('deleteMany stores one entry per deleted document in order and emits deleted in that order', async () => {
      const docs = await ItemModel.insertMany([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
      events.length = 0
      await ItemModel.deleteMany({})
      const rows = (await entries()).filter((r) => r.op === 'deleteMany')
      expect(rows.map((r) => [r.collectionId, (r.doc as Entry).name, r.version, r.user])).toEqual(docs.map((d) => [idOf(d as never), d.name, 0, { id: 'u1' }]))
      expect(events.map((e) => [e.name, (e.data as { oldDoc: Entry }).oldDoc.name])).toEqual([
        [DELETED, 'a'],
        [DELETED, 'b'],
        [DELETED, 'c'],
      ])
    })

    it('findOneAndDelete stores a findOneAndDelete entry', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      await ItemModel.findOneAndDelete({ _id: doc._id })
      const [, removed] = await entries()
      expect(removed).toEqual({ ...base, op: 'findOneAndDelete', collectionId: idOf(doc), doc: { _id: idOf(doc), name: 'a', count: 0 }, patch: [], version: 0, ...meta, ...bulkWriteVersionKey })
    })

    it('stored entries carry createdAt and updatedAt timestamps', async () => {
      await ItemModel.create({ name: 'a' })
      const [raw] = await HistoryModel.find({ modelName: 'CharItem' }).lean()
      expect(Object.keys(raw ?? {}).sort()).toEqual([...Object.keys(bulkWriteVersionKey), '_id', 'collectionId', 'collectionName', 'createdAt', 'doc', 'metadata', 'modelName', 'op', 'patch', 'reason', 'updatedAt', 'user', 'version'])
    })
  })

  describe('getter failures', () => {
    it.each(['throw', 'reject'] as const)('a getUser that does %s still stores the entry without a user field', async (mode) => {
      userMode = mode
      const doc = await ItemModel.create({ name: 'a' })
      await ItemModel.updateOne({ _id: doc._id }, { $set: { count: 1 } })
      const rows = await entries()
      expect(rows.map((r) => [r.op, Object.hasOwn(r, 'user'), r.reason, r.metadata])).toEqual([
        ['create', false, 'r1', { m: 1 }],
        ['updateOne', false, 'r1', { m: 1 }],
      ])
      expect(events.map((e) => e.name)).toEqual([CREATED, UPDATED])
    })
  })

  describe('commands for single-document operations', () => {
    const run = async (action: () => Promise<unknown>) => {
      const recorded = recordCommands()
      await action()
      mongoose.set('debug', false)
      return recorded
    }

    it('save of a new document writes history with one bulkWrite before the insert', async () => {
      const { commands, sessionKeys } = await run(() => new ItemModel({ name: 'a' }).save())
      expect(commands).toEqual(['history.bulkWrite', 'charitems.insertOne'])
      expect(sessionKeys).toEqual([])
    })

    it('save of an existing document reads the original and the last version, then inserts the entry', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      doc.count = 1
      const { commands, sessionKeys } = await run(() => doc.save())
      expect(commands).toEqual(['charitems.findOne', 'history.findOne', 'history.insertOne', 'charitems.updateOne'])
      expect(sessionKeys).toEqual([])
    })

    it('updateOne reads through a cursor and the last version, then inserts the entry', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      const { commands, sessionKeys } = await run(() => ItemModel.updateOne({ _id: doc._id }, { $set: { count: 1 } }))
      expect(commands).toEqual(['charitems.find', 'history.findOne', 'history.insertOne', 'charitems.updateOne'])
      expect(sessionKeys).toEqual([])
    })

    it('an inserting upsert counts, updates, finds the new document and writes one bulkWrite', async () => {
      const { commands, sessionKeys } = await run(() => ItemModel.updateOne({ name: 'up' }, { $set: { count: 1 } }, { upsert: true }))
      expect(commands).toEqual(['charitems.countDocuments', 'charitems.find', 'charitems.updateOne', 'charitems.findOne', 'history.bulkWrite'])
      expect(sessionKeys).toEqual([])
    })

    it('deleteOne reads the document, deletes it, then writes one bulkWrite', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      const { commands, sessionKeys } = await run(() => ItemModel.deleteOne({ _id: doc._id }))
      expect(commands).toEqual(['charitems.findOne', 'charitems.deleteOne', 'history.bulkWrite'])
      expect(sessionKeys).toEqual([])
    })

    it('deleteMany reads the documents once and writes one bulkWrite', async () => {
      await ItemModel.insertMany([{ name: 'a' }, { name: 'b' }])
      const { commands, sessionKeys } = await run(() => ItemModel.deleteMany({}))
      expect(commands).toEqual(['charitems.find', 'charitems.deleteMany', 'history.bulkWrite'])
      expect(sessionKeys).toEqual([])
    })

    it('insertMany inserts the documents and writes one bulkWrite', async () => {
      const { commands, sessionKeys } = await run(() => ItemModel.insertMany([{ name: 'a' }, { name: 'b' }]))
      expect(commands).toEqual(['charitems.insertMany', 'history.bulkWrite'])
      expect(sessionKeys).toEqual([])
    })
  })
  // Mongoose 8+ can carry the transaction session through AsyncLocalStorage; the plugin's own
  // queries and history writes then join the transaction without being given a session.
  describe.skipIf(isMongooseLessThan8)('transactionAsyncLocalStorage', () => {
    const withAsyncLocalStorage = async (body: () => Promise<void>) => {
      mongoose.set('transactionAsyncLocalStorage' as never, true as never)
      try {
        await body()
      } finally {
        mongoose.set('transactionAsyncLocalStorage' as never, false as never)
      }
    }

    it('an aborted connection.transaction leaves neither the update nor its history', () =>
      withAsyncLocalStorage(async () => {
        const doc = await ItemModel.create({ name: 'a' })
        await expect(
          mongoose.connection.transaction(async () => {
            await ItemModel.updateOne({ _id: doc._id }, { $set: { count: 1 } })
            throw new Error('abort')
          }),
        ).rejects.toThrow('abort')
        expect((await ItemModel.findById(doc._id).lean())?.count).toBe(0)
        expect((await entries()).map((r) => r.op)).toEqual(['create'])
      }))

    it('a committed connection.transaction records the update of a document created in it', () =>
      withAsyncLocalStorage(async () => {
        let id: Types.ObjectId | undefined
        await mongoose.connection.transaction(async () => {
          const [doc] = await ItemModel.create([{ name: 'a' }])
          id = doc?._id
          await ItemModel.updateOne({ _id: id }, { $set: { count: 1 } })
        })
        expect((await entries()).map((r) => [r.op, r.collectionId])).toEqual([
          ['create', String(id)],
          ['updateOne', String(id)],
        ])
      }))
  })
})
