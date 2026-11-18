import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { type Model, model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import { isMongooseLessThan8 } from '../src/version'
import server from './mongo/server'

interface Item {
  name: string
  count: number
  status?: string
}

const itemFields = { name: { type: String, required: true, unique: true }, count: { type: Number, default: 0 }, status: String }

const ItemSchema = new Schema<Item>(itemFields)
ItemSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })

let gate: Promise<void> | null = null
let entered: (() => void) | null = null

// Registered after the plugin, so these run between the plugin's pre('save') hook and the write.
ItemSchema.pre('save', async function () {
  if (this.status === 'fail-later') throw new Error('later pre hook failed')
  if (this.status === 'slow' && gate) {
    entered?.()
    await gate
  }
  if (this.status === 'touch-in-hook') {
    await ItemModel.bulkWrite([{ updateOne: { filter: { _id: this._id }, update: { $set: { name: `${this.name}-touched` } } } }])
  }
})

const ItemModel = model<Item>('BulkItem', ItemSchema)
const PlainModel = model<Item>('BulkPlain', new Schema<Item>(itemFields))

const hookCalls: string[] = []
const HookedSchema = new Schema<Item>({ name: String, count: { type: Number, default: 0 } })
HookedSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })
// Middleware of the same name as an overridden static: mongoose below 8.7 wraps schema statics with it.
HookedSchema.pre(
  'bulkWrite' as never,
  (() => {
    hookCalls.push('pre bulkWrite')
  }) as never,
)
HookedSchema.post(
  'bulkWrite' as never,
  (() => {
    hookCalls.push('post bulkWrite')
  }) as never,
)
HookedSchema.pre('insertMany', function (this: unknown, next?: unknown) {
  hookCalls.push('pre insertMany')
  if (typeof next === 'function') next()
} as never)
HookedSchema.post('insertMany', (() => {
  hookCalls.push('post insertMany')
}) as never)
const HookedModel = model<Item>('BulkHooked', HookedSchema)

const BaseSchema = new Schema({ name: String, count: Number }, { discriminatorKey: 'kind' })
BaseSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })
const BaseModel = model('BulkBase', BaseSchema)
const ChildModel = BaseModel.discriminator('BulkChild', new Schema({ extra: String }))

interface Stat {
  name: string
  count: number
  modifiedCount: number
}

const StatSchema = new Schema<Stat>({ name: String, count: Number, modifiedCount: Number })
StatSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })
const StatModel = model<Stat>('BulkStat', StatSchema)

const history = async (id?: unknown) =>
  HistoryModel.find(id ? { collectionId: id } : { modelName: 'BulkItem' })
    .sort({ _id: 1 })
    .lean()

const changedPaths = async (id: unknown) => (await history(id)).flatMap((row) => (row.patch ?? []).filter((p) => p.op !== 'test').map((p) => `${row.op} ${p.path}`))

const outcome = async (run: () => Promise<unknown>) =>
  run().then(
    () => 'resolved',
    (error: Error) => `rejected ${error.name}`,
  )

const holdSave = () => {
  let release: () => void = () => undefined
  gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const inHook = new Promise<void>((resolve) => {
    entered = resolve
  })
  return { inHook, release }
}

describe('bulkWrite recording', () => {
  const instance = server('bulk-write-recording')

  beforeAll(async () => {
    await instance.create()
    await ItemModel.init()
    await PlainModel.init()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('bulkitems').deleteMany({})
    await mongoose.connection.collection('bulkplains').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
    gate = null
  })

  describe('an operation mongoose rejects while casting', () => {
    const withBadFilter = (id: unknown) => [{ updateOne: { filter: { _id: id }, update: { $set: { count: 1 } } } }, { updateOne: { filter: { _id: 'not-an-id' }, update: { $set: { count: 2 } } } }]

    it.each([false, true])('settles the call as mongoose alone does, ordered: %s', async (ordered) => {
      const plain = await PlainModel.create({ name: 'p' })
      const tracked = await ItemModel.create({ name: 't' })
      const expected = await outcome(() => PlainModel.bulkWrite(withBadFilter(plain._id) as never, { ordered }))
      const actual = await outcome(() => ItemModel.bulkWrite(withBadFilter(tracked._id) as never, { ordered }))
      expect(actual).toBe(expected)
      expect((await ItemModel.findById(tracked._id).lean())?.count).toBe((await PlainModel.findById(plain._id).lean())?.count)
    })

    it('records the operations an unordered call applied', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      await ItemModel.bulkWrite(withBadFilter(doc._id) as never, { ordered: false }).catch(() => undefined)
      expect(await changedPaths(doc._id)).toEqual(['updateOne /count'])
    })

    it.skipIf(isMongooseLessThan8)('names an upsert by its own operation when an earlier one was left out', async () => {
      const ops = [{ deleteOne: { filter: { _id: 'not-an-id' } } }, { updateOne: { filter: { name: 'up' }, update: { $set: { count: 1 } }, upsert: true } }]
      await ItemModel.bulkWrite(ops as never, { ordered: false }).catch(() => undefined)
      const upserted = await ItemModel.findOne({ name: 'up' }).lean()
      expect((await history(upserted?._id)).map((row) => row.op)).toEqual(['updateOne'])
    })

    it.skipIf(isMongooseLessThan8)('records the applied operations when mongoose throws for the ones it left out', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      await expect(ItemModel.bulkWrite(withBadFilter(doc._id) as never, { ordered: false, throwOnValidationError: true } as never)).rejects.toThrow()
      expect((await ItemModel.findById(doc._id).lean())?.count).toBe(1)
      expect(await changedPaths(doc._id)).toEqual(['updateOne /count'])
    })
  })

  describe('a call the server partly fails', () => {
    it('unordered: records every operation that was applied and none that failed', async () => {
      const taken = await ItemModel.create({ name: 'taken' })
      const doc = await ItemModel.create({ name: 'a' })
      const gone = await ItemModel.create({ name: 'gone' })
      const ops = [
        { updateOne: { filter: { _id: doc._id }, update: { $set: { name: 'taken' } } } },
        { updateOne: { filter: { _id: doc._id }, update: { $set: { count: 3 } } } },
        { insertOne: { document: { name: 'taken' } } },
        { insertOne: { document: { _id: taken._id, name: 'same-id' } } },
        { insertOne: { document: { name: 'fresh' } } },
        { deleteOne: { filter: { _id: gone._id } } },
      ]
      await mongoose.connection.collection('history').deleteMany({})

      await expect(ItemModel.bulkWrite(ops as never, { ordered: false })).rejects.toThrow(/E11000/)

      const fresh = await ItemModel.findOne({ name: 'fresh' }).lean()
      const recorded = (await history()).map((row) => `${row.op} ${String(row.collectionId)}`).sort()
      expect(recorded).toEqual([`create ${String(fresh?._id)}`, `deleteOne ${String(gone._id)}`, `updateOne ${String(doc._id)}`].sort())
      expect(await changedPaths(doc._id)).toEqual(['updateOne /count'])
    })

    it('ordered: records the operations before the failure only', async () => {
      const first = await ItemModel.create({ name: 'first' })
      const second = await ItemModel.create({ name: 'second' })
      const ops = [
        { updateOne: { filter: { _id: first._id }, update: { $set: { count: 1 } } } },
        { insertOne: { document: { name: 'second' } } },
        { updateOne: { filter: { _id: second._id }, update: { $set: { count: 1 } } } },
        { insertOne: { document: { name: 'late' } } },
        { insertOne: { document: { _id: second._id, name: 'late-same-id' } } },
      ]
      await mongoose.connection.collection('history').deleteMany({})

      await expect(ItemModel.bulkWrite(ops as never)).rejects.toThrow(/E11000/)

      expect((await ItemModel.findById(second._id).lean())?.count).toBe(0)
      expect((await history()).map((row) => `${row.op} ${String(row.collectionId)}`)).toEqual([`updateOne ${String(first._id)}`])
    })
  })

  describe('bulkSave and other writes on the same documents', () => {
    it('a bulkSave that fails in a later pre(save) hook leaves later bulkWrites recorded', async () => {
      const a = await ItemModel.create({ name: 'a' })
      const b = await ItemModel.create({ name: 'b' })
      a.count = 1
      b.status = 'fail-later'
      await expect(ItemModel.bulkSave([a, b])).rejects.toThrow('later pre hook failed')
      await mongoose.connection.collection('history').deleteMany({})

      await ItemModel.bulkWrite([{ updateOne: { filter: { _id: a._id }, update: { $set: { count: 5 } } } }])

      expect(await changedPaths(a._id)).toEqual(['updateOne /count'])
    })

    it('a save() that fails in a later pre(save) hook leaves a later bulkWrite recorded', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      doc.status = 'fail-later'
      await expect(doc.save()).rejects.toThrow('later pre hook failed')
      await mongoose.connection.collection('history').deleteMany({})

      await ItemModel.bulkWrite([{ updateOne: { filter: { _id: doc._id }, update: { $set: { count: 7 } } } }])

      expect(await changedPaths(doc._id)).toEqual(['updateOne /count'])
    })

    it('a bulkWrite that runs while a save() of the same document is in flight is recorded, and so is the save', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      await mongoose.connection.collection('history').deleteMany({})
      const { inHook, release } = holdSave()
      doc.status = 'slow'
      doc.count = 1
      const saving = doc.save()
      await inHook

      await ItemModel.bulkWrite([{ updateOne: { filter: { _id: doc._id }, update: { $set: { name: 'renamed' } } } }])
      release()
      await saving

      // The save diffs the state its pre hook read against the state after its write, so it also shows the rename.
      expect(await changedPaths(doc._id)).toEqual(expect.arrayContaining(['updateOne /name', 'update /count', 'update /status']))
      expect((await history(doc._id)).map((row) => row.op)).toEqual(['updateOne', 'update'])
    })

    it('a bulkWrite delete that runs while a save() of the same document is in flight is recorded', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      await mongoose.connection.collection('history').deleteMany({})
      const { inHook, release } = holdSave()
      doc.status = 'slow'
      const saving = doc.save().catch(() => undefined)
      await inHook

      await ItemModel.bulkWrite([{ deleteOne: { filter: { _id: doc._id } } }])
      release()
      await saving

      expect(await ItemModel.findById(doc._id).lean()).toBeNull()
      expect((await history(doc._id)).map((row) => row.op)).toEqual(['deleteOne'])
    })

    it('a bulkWrite issued from a pre(save) hook during bulkSave is recorded, and so is the bulkSave', async () => {
      const doc = await ItemModel.create({ name: 'a' })
      await mongoose.connection.collection('history').deleteMany({})
      doc.status = 'touch-in-hook'

      await ItemModel.bulkSave([doc])

      expect(await changedPaths(doc._id)).toEqual(expect.arrayContaining(['updateOne /name', 'update /status']))
      expect((await history(doc._id)).map((row) => row.op)).toEqual(['updateOne', 'update'])
    })
  })

  describe('middleware the schema declares for bulkWrite and insertMany', () => {
    // Mongoose runs bulkWrite middleware natively from 8.2; below that the schema only declares it.
    const nativeBulkWriteHooks = !isMongooseLessThan8 && !mongoose.version.match(/^8\.[01]\./)

    it('bulkWrite resolves, is recorded once, and runs the middleware as mongoose alone does', async () => {
      hookCalls.length = 0
      const res = await HookedModel.bulkWrite([{ insertOne: { document: { name: 'a' } } }])
      expect(res.insertedCount).toBe(1)
      expect(await HistoryModel.countDocuments({ modelName: 'BulkHooked' })).toBe(1)
      expect(hookCalls).toEqual(nativeBulkWriteHooks ? ['pre bulkWrite', 'post bulkWrite'] : [])
    })

    it('insertMany resolves, is recorded once, and runs the middleware once', async () => {
      hookCalls.length = 0
      const docs = await HookedModel.insertMany([{ name: 'b' }])
      expect(docs).toHaveLength(1)
      expect(await HistoryModel.countDocuments({ modelName: 'BulkHooked', collectionId: docs[0]?._id })).toBe(1)
      expect(hookCalls).toEqual(['pre insertMany', 'post insertMany'])
    })
  })

  it('bulkWrite on a discriminator model is recorded', async () => {
    const doc = await ChildModel.create({ name: 'c', count: 0, extra: 'e' })
    await mongoose.connection.collection('history').deleteMany({})
    await ChildModel.bulkWrite([{ updateOne: { filter: { _id: doc._id }, update: { $set: { count: 2 } } } }] as never)
    expect(await changedPaths(doc._id)).toEqual(['updateOne /count'])
  })

  it('findOneAndUpdate is recorded on a model with a numeric modifiedCount field equal to 0', async () => {
    const doc = await StatModel.create({ name: 's', count: 0, modifiedCount: 0 })
    await mongoose.connection.collection('history').deleteMany({})

    await (StatModel as Model<Stat>).findOneAndUpdate({ _id: doc._id }, { $set: { count: 1 } })

    expect((await history(doc._id)).map((row) => row.op)).toEqual(['findOneAndUpdate'])
  })
})
