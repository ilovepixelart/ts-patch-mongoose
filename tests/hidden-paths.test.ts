import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { type Model, model, Schema } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

interface Account {
  name: string
  secret?: string
  auth?: { token?: string; provider?: string }
  keys?: { label?: string; value?: string }[]
}

const KeySchema = new Schema({ label: String, value: { type: String, select: false } }, { _id: false })

const accountSchema = (includeHiddenPaths: boolean, prefix: string) => {
  const schema = new Schema<Account>({
    name: String,
    secret: { type: String, select: false },
    auth: { token: { type: String, select: false }, provider: String },
    keys: [KeySchema],
  })
  schema.plugin(patchHistoryPlugin, {
    omit: ['__v'],
    eventCreated: `${prefix}-created`,
    eventUpdated: `${prefix}-updated`,
    eventDeleted: `${prefix}-deleted`,
    ...(includeHiddenPaths && { includeHiddenPaths }),
  })
  return schema
}

const DefaultModel = model<Account>('HiddenDefault', accountSchema(false, 'hidden-default'))
const IncludedModel = model<Account>('HiddenIncluded', accountSchema(true, 'hidden-included'))

// Without `omit`, the plugin gets the very objects a lean insertMany was given on mongoose 8+.
const BareSchema = new Schema<Account>({ name: String, secret: { type: String, select: false }, keys: [KeySchema] })
BareSchema.plugin(patchHistoryPlugin, {})
const BareModel = model<Account>('HiddenBare', BareSchema)

const withSecrets = (n: number): Account => ({ name: `n${n}`, secret: `SECRET-s${n}`, auth: { token: `SECRET-t${n}`, provider: 'p' }, keys: [{ label: 'k', value: `SECRET-k${n}` }] })
const secretChange = { name: 'changed', secret: 'SECRET-s9', 'auth.token': 'SECRET-t9', keys: [{ label: 'k2', value: 'SECRET-k9' }] }

const events: unknown[] = []

const seed = async (M: Model<Account>, n = 1) => {
  const doc = await M.create(withSecrets(n))
  await mongoose.connection.collection('history').deleteMany({})
  events.length = 0
  return doc
}

// Mongoose 6 queries are thenables, not promises.
const operations: [string, (M: Model<Account>) => PromiseLike<unknown>][] = [
  ['save (create)', (M) => M.create(withSecrets(1))],
  ['insertMany', (M) => M.insertMany([withSecrets(1)])],
  ['insertMany (lean)', (M) => M.insertMany([withSecrets(1)], { lean: true })],
  ['bulkSave (create)', (M) => M.bulkSave([new M(withSecrets(1))])],
  [
    'save (update)',
    async (M) => {
      const { _id } = await seed(M)
      const doc = await M.findById(_id).select('+secret +auth.token +keys.value')
      doc?.set(secretChange)
      await doc?.save()
    },
  ],
  ['updateOne', async (M) => M.updateOne({ _id: (await seed(M))._id }, { $set: secretChange })],
  ['updateMany', async (M) => M.updateMany({ _id: (await seed(M))._id }, { $set: secretChange })],
  ['findOneAndUpdate', async (M) => M.findOneAndUpdate({ _id: (await seed(M))._id }, { $set: secretChange })],
  ['findOneAndReplace', async (M) => M.findOneAndReplace({ _id: (await seed(M))._id }, withSecrets(9))],
  ['upsert', (M) => M.updateOne({ name: 'nobody' }, { $set: secretChange }, { upsert: true })],
  [
    'bulkWrite',
    async (M) => {
      const a = await seed(M, 1)
      const b = await seed(M, 2)
      await M.bulkWrite([{ insertOne: { document: withSecrets(3) } }, { updateOne: { filter: { _id: a._id }, update: { $set: secretChange } } }, { deleteOne: { filter: { _id: b._id } } }] as never)
    },
  ],
  ['deleteOne', async (M) => M.deleteOne({ _id: (await seed(M))._id })],
  ['findOneAndDelete', async (M) => M.findOneAndDelete({ _id: (await seed(M))._id })],
  ['deleteMany', async (M) => M.deleteMany({ _id: (await seed(M))._id })],
]

describe('paths declared with select: false', () => {
  const instance = server('hidden-paths')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('history').deleteMany({})
    em.removeAllListeners()
    events.length = 0
    for (const prefix of ['hidden-default', 'hidden-included']) {
      for (const kind of ['created', 'updated', 'deleted']) em.on(`${prefix}-${kind}`, (data: unknown) => events.push(data))
    }
  })

  const recorded = async (modelName: string) => {
    const rows = await HistoryModel.find({ modelName }).sort({ _id: 1 }).lean()
    return { rows, text: JSON.stringify(rows), events: JSON.stringify(events) }
  }

  describe('by default', () => {
    it.each(operations)('%s records the change without their values in history or events', async (_name, run) => {
      await run(DefaultModel)
      const { rows, text, events: eventText } = await recorded('HiddenDefault')
      expect(rows.length).toBeGreaterThan(0)
      expect(events.length).toBeGreaterThan(0)
      expect(text).not.toContain('SECRET')
      expect(eventText).not.toContain('SECRET')
    })

    it('keeps the visible fields of a created document, including those next to a hidden one', async () => {
      const doc = await DefaultModel.create(withSecrets(1))
      const [row] = (await recorded('HiddenDefault')).rows
      expect(row?.doc).toEqual({ _id: doc._id, name: 'n1', auth: { provider: 'p' }, keys: [{ label: 'k' }] })
    })

    it('records nothing for an update that changes only hidden paths', async () => {
      const doc = await seed(DefaultModel)
      await DefaultModel.updateOne({ _id: doc._id }, { $set: { secret: 'SECRET-s9' } })
      expect((await recorded('HiddenDefault')).rows).toEqual([])
      expect(events).toEqual([])
    })

    it('does not change the documents passed to insertMany', async () => {
      const input = { name: 'n1', secret: 'SECRET-s1', keys: [{ label: 'k', value: 'SECRET-k1' }] }
      await BareModel.insertMany([input], { lean: true })
      expect(input).toMatchObject({ name: 'n1', secret: 'SECRET-s1', keys: [{ label: 'k', value: 'SECRET-k1' }] })
      expect(JSON.stringify(await HistoryModel.find({ modelName: 'HiddenBare' }).lean())).not.toContain('SECRET')
    })
  })

  describe('with includeHiddenPaths', () => {
    it.each(operations)('%s records their values', async (_name, run) => {
      await run(IncludedModel)
      const { text, events: eventText } = await recorded('HiddenIncluded')
      expect(text).toContain('SECRET')
      expect(eventText).toContain('SECRET')
    })

    it('records a created document with its hidden paths', async () => {
      await IncludedModel.create(withSecrets(1))
      const [row] = (await recorded('HiddenIncluded')).rows
      expect(row?.doc).toMatchObject(withSecrets(1))
    })

    it('records a change to hidden paths only, with their values', async () => {
      const doc = await seed(IncludedModel)
      await IncludedModel.updateOne({ _id: doc._id }, { $set: { secret: 'SECRET-s9', 'auth.token': 'SECRET-t9' } })
      const [row] = (await recorded('HiddenIncluded')).rows
      expect(row?.patch).toEqual(
        expect.arrayContaining([
          { op: 'replace', path: '/secret', value: 'SECRET-s9' },
          { op: 'replace', path: '/auth/token', value: 'SECRET-t9' },
        ]),
      )
    })

    it('records a deleted document with its hidden paths', async () => {
      const doc = await seed(IncludedModel)
      await IncludedModel.deleteOne({ _id: doc._id })
      const [row] = (await recorded('HiddenIncluded')).rows
      expect(row?.doc).toMatchObject(withSecrets(1))
    })
  })
})
