import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import { isMongooseLessThan7, isMongooseLessThan8 } from '../src/version'
import server from './mongo/server'

interface Card {
  name: string
  count: number
  settings?: Map<string, string>
}

const CARD_CREATED = 'edge-card-created'
const CARD_UPDATED = 'edge-card-updated'

const CardSchema = new Schema<Card>({
  name: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  settings: { type: Map, of: String },
})

CardSchema.plugin(patchHistoryPlugin, {
  omit: ['__v'],
  eventCreated: CARD_CREATED,
  eventUpdated: CARD_UPDATED,
  preDelete: async (docs) => {
    // Simulates another client changing one of the matched docs so the delete no longer matches it.
    const raced = docs.find((d) => (d as unknown as Card).name === 'raced')
    if (raced) await mongoose.connection.collection('edgecards').updateOne({ _id: raced._id }, { $set: { count: 9 } })
  },
})

// Registered after the plugin, so it runs between the plugin's capture and the write.
CardSchema.pre('updateOne', async function () {
  if ((this.getFilter() as { name?: string }).name === 'appears') {
    await mongoose.connection.collection('edgecards').insertOne({ name: 'appears', count: 1 })
  }
})

// Registered after the plugin: moves the first match out of the filter between the capture and the write.
CardSchema.pre('findOneAndUpdate', async function () {
  if (this.getOptions().comment === 'race') {
    await mongoose.connection.collection('edgecards').updateOne({ name: 'first' }, { $set: { count: 9 } })
  }
})

const CardModel = model<Card>('EdgeCard', CardSchema)
const errors: Error[] = []
const NoteSchema = new Schema<{ text: string }>({ text: String })
NoteSchema.plugin(patchHistoryPlugin, {
  onError: (error) => {
    errors.push(error)
  },
})
const NoteModel = model('EdgeNote', NoteSchema)

const PlainCardModel = model<Card>('EdgePlainCard', new Schema<Card>({ name: String, count: { type: Number, default: 0 } }))

const rows = async (op?: string) =>
  HistoryModel.find(op ? { modelName: 'EdgeCard', op } : { modelName: 'EdgeCard' })
    .sort({ _id: 1 })
    .lean()

describe('real-state history edge cases', () => {
  const instance = server('real-state-edges')

  beforeAll(async () => {
    await instance.create()
    await CardModel.init()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('edgecards').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
    em.removeAllListeners()
    errors.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bulkSave() is recorded once, through the save hooks', async () => {
    const existing = await CardModel.create({ name: 'a' })
    existing.count = 5
    const fresh = new CardModel({ name: 'b' })
    await CardModel.bulkSave([existing, fresh])
    expect((await rows()).map((r) => [r.op, String(r.collectionId)]).sort()).toEqual(
      [
        ['create', String(existing._id)],
        ['update', String(existing._id)],
        ['create', String(fresh._id)],
      ].sort(),
    )
  })

  it('a doc whose save() failed is still recorded by a later bulkWrite', async () => {
    await CardModel.create({ name: 'taken' })
    const doc = await CardModel.create({ name: 'a' })
    doc.name = 'taken'
    await expect(doc.save()).rejects.toThrow(/E11000/)
    await CardModel.bulkWrite([{ updateOne: { filter: { _id: doc._id }, update: { $set: { count: 2 } } } }])
    expect((await rows('updateOne')).map((r) => String(r.collectionId))).toEqual([String(doc._id)])
  })

  it('callback-style bulkWrite is passed to mongoose unchanged', async () => {
    const doc = await CardModel.create({ name: 'a' })
    const ops = [{ updateOne: { filter: { _id: doc._id }, update: { $set: { count: 2 } } } }]
    const bulkWrite = CardModel.bulkWrite as unknown as (o: unknown, opts: unknown, cb: (e: unknown, r: unknown) => void) => Promise<unknown> | undefined
    if (isMongooseLessThan7) {
      const res = await new Promise((resolve, reject) => bulkWrite.call(CardModel, ops, {}, (e, r) => (e ? reject(e) : resolve(r))))
      expect(res).toMatchObject({ modifiedCount: 1 })
    } else {
      await expect(Promise.resolve().then(() => bulkWrite.call(CardModel, ops, {}, () => undefined))).rejects.toThrow(/callback/)
    }
  })

  it('deleteMany records only the docs it removed when another client changed one so it no longer matched', async () => {
    await CardModel.insertMany([{ name: 'raced' }, { name: 'kept-history' }])
    const res = await CardModel.deleteMany({ count: 0 })
    expect(res.deletedCount).toBe(1)
    expect((await rows('deleteMany')).map((r) => (r.doc as Card).name)).toEqual(['kept-history'])
  })

  it('findOneAndDelete records nothing when the captured doc no longer matched at delete time', async () => {
    await CardModel.insertMany([{ name: 'raced' }])
    const gone = await CardModel.findOneAndDelete({ count: 0 })
    expect({ gone, rows: await rows('findOneAndDelete') }).toEqual({ gone: null, rows: [] })
  })

  it('an upsert that matched a doc created after the capture records no create entry', async () => {
    const res = await CardModel.updateOne({ name: 'appears' }, { $set: { count: 2 } }, { upsert: true })
    expect({ upserted: res.upsertedCount, matched: res.matchedCount }).toEqual({ upserted: 0, matched: 1 })
    expect(await rows()).toEqual([])
  })

  it('findOneAndUpdate records nothing for a captured doc it did not update', async () => {
    await CardModel.insertMany([{ name: 'first' }, { name: 'second' }])
    const updated = await CardModel.findOneAndUpdate({ count: 0 }, { $set: { note: 'x' } as never }, { comment: 'race', new: true, strict: false })
    expect(updated?.name).toBe('second')
    expect((await rows('findOneAndUpdate')).filter((r) => r.patch?.length)).toEqual([])
  })

  it('an update that modifies nothing does not read the stored state again', async () => {
    const doc = await CardModel.create({ name: 'a' })
    const commands: string[] = []
    mongoose.set('debug', (collection: string, method: string) => {
      commands.push(`${collection}.${method}`)
    })
    await CardModel.updateOne({ _id: doc._id }, { $set: { count: 0 } })
    mongoose.set('debug', false)
    expect(commands).toEqual(['edgecards.findOne', 'edgecards.updateOne'])
  })

  it('a filter with a collation records the doc the collation matched', async () => {
    const doc = await CardModel.create({ name: 'Mixed' })
    await CardModel.updateOne({ name: 'mixed' }, { $set: { count: 3 } }, { collation: { locale: 'en', strength: 2 } })
    expect((await rows('updateOne')).map((r) => String(r.collectionId))).toEqual([String(doc._id)])
  })

  it('findOneAndUpdate returning the raw result records the change and the upsert', async () => {
    const doc = await CardModel.create({ name: 'a' })
    const raw = isMongooseLessThan8 ? { rawResult: true } : { includeResultMetadata: true }
    await CardModel.findOneAndUpdate({ _id: doc._id }, { $set: { count: 4 } }, raw as never)
    await CardModel.findOneAndUpdate({ name: 'u' }, { $set: { count: 1 } }, { upsert: true, ...raw } as never)
    const upserted = await CardModel.findOne({ name: 'u' }).orFail()
    expect((await rows('findOneAndUpdate')).map((r) => [String(r.collectionId), r.doc ? 'create' : 'update'])).toEqual([
      [String(doc._id), 'update'],
      [String(upserted._id), 'create'],
    ])
  })

  it('findOneAndUpdate with upsert and new records the inserted doc by its id', async () => {
    const created = await CardModel.findOneAndUpdate({ name: 'n' }, { $set: { count: 1 } }, { upsert: true, new: true })
    expect((await rows('findOneAndUpdate')).map((r) => [String(r.collectionId), (r.doc as Card).count])).toEqual([[String(created?._id), 1]])
  })

  it('a save() that changes nothing issues no command beyond what mongoose sends, and records nothing', async () => {
    const commandsOf = async (doc: { save: () => Promise<unknown> }) => {
      const commands: string[] = []
      mongoose.set('debug', (_collection: string, method: string) => {
        commands.push(method)
      })
      await doc.save()
      mongoose.set('debug', false)
      return commands
    }
    const tracked = await commandsOf(await CardModel.create({ name: 'a' }))
    const untracked = await commandsOf(await PlainCardModel.create({ name: 'a' }))
    expect({ tracked, rows: (await rows()).length }).toEqual({ tracked: untracked, rows: 1 })
  })

  it('a failure reading the after-state goes to onError and does not reject the write that succeeded', async () => {
    const doc = await NoteModel.create({ text: 'a' })
    const failure = new Error('read failed')
    vi.spyOn(NoteModel, 'find').mockImplementationOnce(() => {
      throw failure
    })
    await expect(NoteModel.updateOne({ _id: doc._id }, { $set: { text: 'b' } })).resolves.toMatchObject({ modifiedCount: 1 })
    expect({ errors, stored: (await NoteModel.findById(doc._id).lean())?.text }).toEqual({ errors: [failure], stored: 'b' })
  })

  it('a Map path change is recorded by its entries', async () => {
    const doc = await CardModel.create({ name: 'a', settings: new Map([['theme', 'dark']]) })
    await CardModel.updateOne({ _id: doc._id }, { $set: { 'settings.locale': 'en' } })
    const loaded = await CardModel.findById(doc._id).orFail()
    loaded.settings?.set('theme', 'light')
    await loaded.save()
    expect((await rows()).filter((r) => r.op !== 'create').map((r) => r.patch)).toEqual([
      [{ op: 'add', path: '/settings/locale', value: 'en' }],
      [
        { op: 'test', path: '/settings/theme', value: 'dark' },
        { op: 'replace', path: '/settings/theme', value: 'light' },
      ],
    ])
  })
})
