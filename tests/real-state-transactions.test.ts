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
CounterSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })
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

  const abortWith = async (work: (session: mongoose.ClientSession) => Promise<unknown>) => {
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

  it.skipIf(isMongooseLessThan8)('with transactionAsyncLocalStorage, history of a committed updateMany is written in the transaction with exact versions', async () => {
    const [a, b] = await CounterModel.create([{ name: 'a' }, { name: 'b' }], { ordered: true })
    mongoose.set('transactionAsyncLocalStorage' as never, true as never)
    try {
      await mongoose.connection.transaction(async () => {
        await CounterModel.updateMany({}, { $inc: { count: 1 } })
        await CounterModel.updateMany({}, { $inc: { count: 1 } })
      })
    } finally {
      mongoose.set('transactionAsyncLocalStorage' as never, false as never)
    }
    const rows = await HistoryModel.find({ op: 'updateMany' }).sort({ version: 1 }).lean()
    expect(rows.map((r) => [String(r.collectionId), r.version]).sort()).toEqual(
      [
        [String(a?._id), 1],
        [String(a?._id), 2],
        [String(b?._id), 1],
        [String(b?._id), 2],
      ].sort(),
    )
  })
})
