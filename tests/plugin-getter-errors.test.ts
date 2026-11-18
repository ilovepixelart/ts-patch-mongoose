import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

interface Note {
  text: string
}

const userError = new Error('auth context lost')
const reasonError = new Error('no reason')
const metadataError = new Error('no metadata')

const failing = {
  user: false,
  reason: false,
  metadata: false,
  async: false,
}

const fail = (error: Error): Promise<never> => {
  if (failing.async) return Promise.reject(error)
  throw error
}

const onError = vi.fn()

const getters = {
  getUser: () => (failing.user ? fail(userError) : { id: 'u1' }),
  getReason: () => (failing.reason ? fail(reasonError) : 'r1'),
  getMetadata: () => (failing.metadata ? fail(metadataError) : { m: 1 }),
}

const NoteSchema = new Schema<Note>({ text: String })
NoteSchema.plugin(patchHistoryPlugin, { ...getters, onError })
const NoteModel = model<Note>('GetterNote', NoteSchema)

const DefaultSchema = new Schema<Note>({ text: String })
DefaultSchema.plugin(patchHistoryPlugin, getters)
const DefaultModel = model<Note>('GetterDefaultNote', DefaultSchema)

const stored = async (modelName = 'GetterNote') => {
  const rows = await HistoryModel.find({ modelName }).sort({ _id: 1 }).lean()
  return rows.map((r) => ({ op: r.op, user: r.user, reason: r.reason, metadata: r.metadata }))
}

describe('getUser, getReason and getMetadata failures', () => {
  const instance = server('plugin-getter-errors')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    Object.assign(failing, { user: false, reason: false, metadata: false, async: false })
    onError.mockClear()
    await mongoose.connection.collection('getternotes').deleteMany({})
    await mongoose.connection.collection('getterdefaultnotes').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([false, true])('a getUser failure (async %s) is reported to onError and the entry is still stored without a user', async (async) => {
    Object.assign(failing, { user: true, async })
    await NoteModel.create({ text: 'a' })
    expect(onError.mock.calls).toEqual([[userError]])
    expect(await stored()).toEqual([{ op: 'create', user: undefined, reason: 'r1', metadata: { m: 1 } }])
  })

  it('getReason and getMetadata failures are each reported once', async () => {
    Object.assign(failing, { reason: true, metadata: true })
    await NoteModel.create({ text: 'a' })
    expect(onError.mock.calls).toEqual([[reasonError], [metadataError]])
    expect(await stored()).toEqual([{ op: 'create', user: { id: 'u1' }, reason: undefined, metadata: undefined }])
  })

  it('a getUser failing for every document of insertMany is reported once for the operation', async () => {
    failing.user = true
    await NoteModel.insertMany([{ text: 'a' }, { text: 'b' }, { text: 'c' }])
    expect(onError.mock.calls).toEqual([[userError]])
    expect((await stored()).map((r) => [r.op, r.user])).toEqual([
      ['create', undefined],
      ['create', undefined],
      ['create', undefined],
    ])
  })

  it('a getUser failing for every document of updateMany is reported once for the operation', async () => {
    await NoteModel.insertMany([{ text: 'a' }, { text: 'b' }, { text: 'c' }])
    failing.user = true
    await NoteModel.updateMany({}, { $set: { text: 'z' } })
    expect(onError.mock.calls).toEqual([[userError]])
    expect((await stored()).filter((r) => r.op === 'updateMany').map((r) => r.user)).toEqual([undefined, undefined, undefined])
  })

  it('a getUser failing for every document of deleteMany is reported once for the operation', async () => {
    await NoteModel.insertMany([{ text: 'a' }, { text: 'b' }])
    failing.user = true
    await NoteModel.deleteMany({})
    expect(onError.mock.calls).toEqual([[userError]])
  })

  it('each failing operation reports its own failure', async () => {
    failing.user = true
    const doc = await NoteModel.create({ text: 'a' })
    await NoteModel.updateOne({ _id: doc._id }, { $set: { text: 'b' } })
    expect(onError.mock.calls).toEqual([[userError], [userError]])
  })

  it('working getters report nothing', async () => {
    const doc = await NoteModel.create({ text: 'a' })
    await NoteModel.updateOne({ _id: doc._id }, { $set: { text: 'b' } })
    expect(onError).not.toHaveBeenCalled()
    expect(await stored()).toEqual([
      { op: 'create', user: { id: 'u1' }, reason: 'r1', metadata: { m: 1 } },
      { op: 'updateOne', user: { id: 'u1' }, reason: 'r1', metadata: { m: 1 } },
    ])
  })

  it('without onError a getter failure goes to console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    failing.user = true
    await DefaultModel.create({ text: 'a' })
    expect(consoleError.mock.calls).toEqual([[userError]])
    expect(await stored('GetterDefaultNote')).toEqual([{ op: 'create', user: undefined, reason: 'r1', metadata: { m: 1 } }])
  })
})
