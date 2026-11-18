import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

interface Row {
  sku: string
  note?: string
}

const RowSchema = new Schema<Row>({
  sku: { type: String, required: true },
  note: { type: String },
})

RowSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })

const RowModel = model<Row>('BatchRow', RowSchema)

const onError = vi.fn()
const ReportedSchema = new Schema<Row>({ sku: { type: String, required: true }, note: { type: String } })
ReportedSchema.plugin(patchHistoryPlugin, { omit: ['__v'], onError })
const ReportedModel = model<Row>('BatchReportedRow', ReportedSchema)

const BATCH = 1000

const recordHistoryCommands = () => {
  const commands: string[] = []
  mongoose.set('debug', (collection: string, method: string) => {
    if (collection === 'history') commands.push(method)
  })
  return commands
}

const seed = async (n: number) => {
  const docs = await RowModel.insertMany(Array.from({ length: n }, (_, i) => ({ sku: `s${i}` })))
  return docs.map((d) => String(d._id))
}

const entries = async (op: string) => {
  const rows = await HistoryModel.find({ modelName: 'BatchRow', op }).sort({ _id: 1 }).lean()
  return rows.map((r) => ({ id: String(r.collectionId), version: r.version, patch: r.patch }))
}

describe('history writes for multi-document operations', () => {
  const instance = server('plugin-batch-history')

  beforeAll(async () => {
    await instance.create()
    await RowModel.init()
    await HistoryModel.init()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('batchrows').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    mongoose.set('debug', false)
    vi.restoreAllMocks()
  })

  it('updateMany over 1000 documents reads versions and writes history in one command each', async () => {
    const ids = await seed(BATCH)
    const commands = recordHistoryCommands()
    await RowModel.updateMany({}, { $set: { note: 'x' } })
    mongoose.set('debug', false)
    expect(commands).toEqual(['aggregate', 'insertMany'])
    const rows = await entries('updateMany')
    expect(rows.map((r) => r.id)).toEqual(ids)
    expect(rows.every((r) => r.version === 1)).toBe(true)
    expect(rows[0]?.patch).toEqual([{ op: 'add', path: '/note', value: 'x' }])
  }, 60_000)

  it('updateMany over 1001 documents writes two batches and keeps every entry in cursor order', async () => {
    const ids = await seed(BATCH + 1)
    await RowModel.updateMany({}, { $set: { note: 'x' } })
    const commands = recordHistoryCommands()
    await RowModel.updateMany({}, { $set: { note: 'y' } })
    mongoose.set('debug', false)
    expect(commands).toEqual(['aggregate', 'insertMany', 'findOne', 'insertOne'])
    const rows = await entries('updateMany')
    expect(rows.map((r) => r.id)).toEqual([...ids, ...ids])
    expect(rows.map((r) => r.version)).toEqual([...ids.map(() => 1), ...ids.map(() => 2)])
    expect(rows.at(-1)?.patch).toEqual([
      { op: 'test', path: '/note', value: 'x' },
      { op: 'replace', path: '/note', value: 'y' },
    ])
  }, 60_000)

  it('deleteMany over 1000 documents writes history in one command', async () => {
    const ids = await seed(BATCH)
    const commands = recordHistoryCommands()
    await RowModel.deleteMany({})
    mongoose.set('debug', false)
    expect(commands).toEqual(['bulkWrite'])
    expect((await entries('deleteMany')).map((r) => r.id)).toEqual(ids)
  }, 60_000)

  it('insertMany of 1000 documents writes history in one command', async () => {
    const commands = recordHistoryCommands()
    const ids = await seed(BATCH)
    mongoose.set('debug', false)
    expect(commands).toEqual(['bulkWrite'])
    expect((await entries('create')).map((r) => r.id)).toEqual(ids)
  }, 60_000)

  it('updateMany over documents that have no history yet records version 0 for them', async () => {
    const { insertedIds } = await mongoose.connection.collection('batchrows').insertMany([{ sku: 'a' }, { sku: 'b' }])
    await RowModel.updateMany({}, { $set: { note: 'x' } })
    expect(await entries('updateMany')).toEqual(Object.values(insertedIds).map((id) => ({ id: String(id), version: 0, patch: [{ op: 'add', path: '/note', value: 'x' }] })))
  })

  it('a failed batch history write is reported to onError once and the update still applies', async () => {
    await ReportedModel.insertMany([{ sku: 'a' }, { sku: 'b' }])
    const failure = new Error('insertMany failed')
    vi.spyOn(HistoryModel, 'insertMany').mockRejectedValueOnce(failure)
    await ReportedModel.updateMany({}, { $set: { note: 'x' } })
    expect(onError.mock.calls).toEqual([[failure]])
    expect(await ReportedModel.countDocuments({ note: 'x' })).toBe(2)
  })
})
