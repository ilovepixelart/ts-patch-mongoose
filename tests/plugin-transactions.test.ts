import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import replSet from './mongo/repl-set'

import type { ClientSession, Types } from 'mongoose'

interface Account {
  name: string
  balance: number
}

const AccountSchema = new Schema<Account>({
  name: { type: String, required: true },
  balance: { type: Number, default: 0 },
})

AccountSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })

const AccountModel = model<Account>('TxAccount', AccountSchema)

type Expected = [op: string, id: unknown][]

interface Case {
  name: string
  // Runs the operation inside the transaction on the two given accounts and returns the
  // history entries it should add once the transaction commits.
  run: (ids: Types.ObjectId[], session: ClientSession) => Promise<Expected>
}

const cases: Case[] = [
  {
    name: 'save of a new document',
    run: async (_ids, session) => {
      const doc = await new AccountModel({ name: 'n' }).save({ session })
      return [['create', doc._id]]
    },
  },
  {
    name: 'save of an existing document',
    run: async ([id], session) => {
      const doc = await AccountModel.findById(id).session(session).orFail()
      doc.balance = 5
      await doc.save()
      return [['update', id]]
    },
  },
  {
    name: 'Model.create',
    run: async (_ids, session) => {
      const docs = await AccountModel.create([{ name: 'n' }], { session })
      return docs.map((d) => ['create', d._id])
    },
  },
  {
    name: 'insertMany',
    run: async (_ids, session) => {
      const docs = await AccountModel.insertMany([{ name: 'n1' }, { name: 'n2' }], { session })
      return docs.map((d) => ['create', d._id])
    },
  },
  {
    name: 'updateOne',
    run: async ([id], session) => {
      await AccountModel.updateOne({ _id: id }, { $set: { balance: 5 } }, { session })
      return [['updateOne', id]]
    },
  },
  {
    name: 'updateOne with upsert',
    run: async (_ids, session) => {
      await AccountModel.updateOne({ name: 'up' }, { $set: { balance: 5 } }, { upsert: true, session })
      const doc = await AccountModel.findOne({ name: 'up' }).session(session).orFail()
      return [['updateOne', doc._id]]
    },
  },
  {
    name: 'updateMany',
    run: async (ids, session) => {
      await AccountModel.updateMany({ _id: { $in: ids } }, { $set: { balance: 5 } }, { session })
      return ids.map((id) => ['updateMany', id])
    },
  },
  {
    name: 'findOneAndUpdate',
    run: async ([id], session) => {
      await AccountModel.findOneAndUpdate({ _id: id }, { $set: { balance: 5 } }, { session })
      return [['findOneAndUpdate', id]]
    },
  },
  {
    name: 'replaceOne',
    run: async ([id], session) => {
      await AccountModel.replaceOne({ _id: id }, { name: 'z', balance: 5 }, { session })
      return [['replaceOne', id]]
    },
  },
  {
    name: 'deleteOne',
    run: async ([id], session) => {
      await AccountModel.deleteOne({ _id: id }, { session })
      return [['deleteOne', id]]
    },
  },
  {
    name: 'deleteMany',
    run: async (ids, session) => {
      await AccountModel.deleteMany({ _id: { $in: ids } }, { session })
      return ids.map((id) => ['deleteMany', id])
    },
  },
  {
    name: 'findOneAndDelete',
    run: async ([id], session) => {
      await AccountModel.findOneAndDelete({ _id: id }, { session })
      return [['findOneAndDelete', id]]
    },
  },
]

const history = async (): Promise<Expected> => {
  const rows = await HistoryModel.find({ modelName: 'TxAccount' }).sort({ _id: 1 }).lean()
  return rows.map((r) => [r.op, String(r.collectionId)])
}

const asStrings = (expected: Expected): Expected => expected.map(([op, id]) => [op, String(id)])

// Operations inside a transaction must not run in parallel; mongoose 6 has no ordered create.
const seed = async (session?: ClientSession): Promise<Types.ObjectId[]> => {
  const ids: Types.ObjectId[] = []
  for (const name of ['a', 'b']) {
    const [doc] = await AccountModel.create([{ name }], { session: session ?? null })
    if (doc) ids.push(doc._id)
  }
  return ids
}

describe('patch history inside transactions', () => {
  const instance = replSet()

  beforeAll(async () => {
    await instance.create()
    await AccountModel.init()
    await HistoryModel.init()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('txaccounts').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  // History is written outside the caller's transaction, as in 4.0: inside it, manual transactions
  // started while mongoose creates and indexes the history collection fail with LockTimeout. So an
  // aborted transaction keeps the entries of the changes it attempted.
  it.each(cases)('$name in an aborted transaction keeps its history, written outside the transaction', async ({ run }) => {
    const ids = await seed()
    const before = await history()
    const session = await mongoose.startSession()
    let expected: Expected = []
    try {
      session.startTransaction()
      expected = await run(ids, session)
      await session.abortTransaction()
    } finally {
      await session.endSession()
    }
    expect(await AccountModel.countDocuments()).toBe(2)
    expect(await history()).toEqual([...before, ...asStrings(expected)])
  })

  it.each(cases)('$name on documents created in the same committed transaction records its history', async ({ run }) => {
    const session = await mongoose.startSession()
    let expected: Expected = []
    try {
      await session.withTransaction(async () => {
        const ids = await seed(session)
        expected = [...ids.map((id): [string, unknown] => ['create', id]), ...(await run(ids, session))]
      })
    } finally {
      await session.endSession()
    }
    expect(await history()).toEqual(asStrings(expected))
  })

  it.each(cases)('$name on pre-existing documents in a committed transaction records its history', async ({ run }) => {
    const ids = await seed()
    const before = await history()
    const session = await mongoose.startSession()
    let expected: Expected = []
    try {
      await session.withTransaction(async () => {
        expected = await run(ids, session)
      })
    } finally {
      await session.endSession()
    }
    expect(await history()).toEqual([...before, ...asStrings(expected)])
  })
})
