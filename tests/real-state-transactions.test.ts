import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose, { model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'

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
  })

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
})
