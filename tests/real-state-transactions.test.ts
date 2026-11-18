import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose, { model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import { isMongooseLessThan8 } from '../src/version'

interface Counter {
  name: string
  count: number
}

const CounterSchema = new Schema<Counter>({ name: { type: String, required: true }, count: { type: Number, default: 0 } })
const errors: Error[] = []
CounterSchema.plugin(patchHistoryPlugin, {
  omit: ['__v'],
  onError: (error) => {
    errors.push(error)
  },
})
const CounterModel = model<Counter>('RealTxCounter', CounterSchema)

describe('history inside transactions', () => {
  let replSet: MongoMemoryReplSet

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
    await mongoose.connect(replSet.getUri())
    await CounterModel.init()
    await HistoryModel.init()
  }, 60_000)

  afterAll(async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.connection.close()
    await replSet.stop({ doCleanup: true, force: true })
  })

  beforeEach(async () => {
    await mongoose.connection.collection('realtxcounters').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
    errors.length = 0
  })

  const incInTransaction = async (id: unknown) => {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await CounterModel.updateOne({ _id: id }, { $inc: { count: 1 } }, { session })
      })
    } finally {
      await session.endSession()
    }
  }

  const abortWith = async (work: (session: mongoose.ClientSession) => PromiseLike<unknown>) => {
    const session = await mongoose.startSession()
    try {
      session.startTransaction()
      await work(session)
      await session.abortTransaction()
    } finally {
      await session.endSession()
    }
  }

  it("history is written outside the caller's transaction: an aborted transaction keeps the entries of its writes", async () => {
    const doc = await CounterModel.create({ name: 'a' })
    await mongoose.connection.collection('history').deleteMany({})
    await abortWith((session) => CounterModel.updateOne({ _id: doc._id }, { $inc: { count: 1 } }, { session }))
    expect((await CounterModel.findById(doc._id).lean())?.count).toBe(0)
    const rows = await HistoryModel.find({ collectionId: doc._id }).lean()
    expect(rows.map((r) => [r.op, (r.patch ?? []).map((p) => (p as { value?: unknown }).value)])).toEqual([['updateOne', [0, 1]]])
  })

  it('bulkSave(docs, { session }) in a transaction records the change read in that transaction', async () => {
    const doc = await CounterModel.create({ name: 'a' })
    await mongoose.connection.collection('history').deleteMany({})
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        doc.count = 4
        await CounterModel.bulkSave([doc], { session })
      })
    } finally {
      await session.endSession()
    }
    const rows = await HistoryModel.find({ collectionId: doc._id }).lean()
    expect(rows.map((r) => [r.op, (r.patch ?? []).map((p) => (p as { value?: unknown }).value)])).toEqual([['update', [0, 4]]])
  })

  it('F8 red: two parallel $inc in transactions record 0->1 and 1->2 with distinct versions', async () => {
    const doc = await CounterModel.create({ name: 'a', count: 0 })
    await Promise.all([incInTransaction(doc._id), incInTransaction(doc._id)])
    expect((await CounterModel.findById(doc._id).lean())?.count).toBe(2)
    const rows = await HistoryModel.find({ collectionId: doc._id, op: 'updateOne' }).sort({ version: 1 }).lean()
    expect(rows.map((r) => [r.version, (r.patch ?? []).map((p) => (p as { value?: unknown }).value)])).toEqual([
      [1, [0, 1]],
      [2, [1, 2]],
    ])
  })

  const withAsyncLocalStorage = async (work: () => Promise<void>) => {
    mongoose.set('transactionAsyncLocalStorage' as never, true as never)
    try {
      await work()
    } finally {
      mongoose.set('transactionAsyncLocalStorage' as never, false as never)
    }
  }

  it.skipIf(isMongooseLessThan8)('with transactionAsyncLocalStorage, history is written outside the transaction with exact versions', async () => {
    const [a, b] = await CounterModel.create([{ name: 'a' }, { name: 'b' }], { ordered: true })
    await withAsyncLocalStorage(async () => {
      await mongoose.connection.transaction(async () => {
        await CounterModel.updateMany({}, { $inc: { count: 1 } })
        await CounterModel.updateMany({}, { $inc: { count: 1 } })
      })
      await mongoose.connection
        .transaction(async () => {
          await CounterModel.updateMany({}, { $inc: { count: 1 } })
          await CounterModel.updateOne({ _id: a?._id }, { $inc: { count: 1 } })
          await CounterModel.create({ name: 'c' })
          throw new Error('abort')
        })
        .catch(() => undefined)
    })
    expect((await CounterModel.findById(a?._id).lean())?.count).toBe(2)
    expect(await CounterModel.countDocuments({ name: 'c' })).toBe(0)
    expect(await HistoryModel.countDocuments({ op: 'create', 'doc.name': 'c' })).toBe(1)
    const rows = await HistoryModel.find({ op: { $in: ['updateMany', 'updateOne'] } })
      .sort({ version: 1 })
      .lean()
    expect(rows.map((r) => [String(r.collectionId), r.version]).sort()).toEqual(
      [
        [String(a?._id), 1],
        [String(a?._id), 2],
        [String(a?._id), 3],
        [String(a?._id), 4],
        [String(b?._id), 1],
        [String(b?._id), 2],
        [String(b?._id), 3],
      ].sort(),
    )
  })

  it.skipIf(isMongooseLessThan8)('with transactionAsyncLocalStorage, Model.create of two documents records both', async () => {
    await withAsyncLocalStorage(async () => {
      await mongoose.connection.transaction(async () => {
        // A first operation starts the transaction; the two saves of create then run in parallel inside it.
        await CounterModel.findOne({})
        await CounterModel.create([{ name: 'p' }, { name: 'q' }])
      })
    })
    expect(await CounterModel.countDocuments({ name: { $in: ['p', 'q'] } })).toBe(2)
    expect(errors).toEqual([])
    expect((await HistoryModel.find({ op: 'create' }).lean()).map((r) => (r.doc as { name?: string }).name).sort()).toEqual(['p', 'q'])
  })
})
