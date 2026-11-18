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

interface Admin {
  name: string
  kind?: string
  passwordHash?: string
  profile?: { pin?: string; nick?: string }
  keys?: { label?: string; value?: string }[]
}

const discriminatedModels = (includeHiddenPaths: boolean, prefix: string) => {
  const schema = new Schema<Admin>({ name: String }, { discriminatorKey: 'kind' })
  schema.plugin(patchHistoryPlugin, {
    omit: ['__v'],
    eventCreated: `${prefix}-created`,
    eventUpdated: `${prefix}-updated`,
    eventDeleted: `${prefix}-deleted`,
    ...(includeHiddenPaths && { includeHiddenPaths }),
  })
  const base = model<Admin>(`${prefix}-user`, schema)
  const child = base.discriminator<Admin>(`${prefix}-admin`, new Schema({ passwordHash: { type: String, select: false }, profile: { pin: { type: String, select: false }, nick: String }, keys: [KeySchema] }))
  return [base, child] as const
}

const [DiscBase, DiscChild] = discriminatedModels(false, 'hidden-disc')
const [DiscBaseIncluded, DiscChildIncluded] = discriminatedModels(true, 'hidden-disc-included')

const withAdminSecrets = (n: number): Admin => ({ name: `a${n}`, passwordHash: `SECRET-p${n}`, profile: { pin: `SECRET-pin${n}`, nick: 'n' }, keys: [{ label: 'k', value: `SECRET-k${n}` }] })
const adminChange = { name: 'changed', passwordHash: 'SECRET-p9', 'profile.pin': 'SECRET-pin9', keys: [{ label: 'k2', value: 'SECRET-k9' }] }

const withSecrets = (n: number): Account => ({ name: `n${n}`, secret: `SECRET-s${n}`, auth: { token: `SECRET-t${n}`, provider: 'p' }, keys: [{ label: 'k', value: `SECRET-k${n}` }] })
const secretChange = { name: 'changed', secret: 'SECRET-s9', 'auth.token': 'SECRET-t9', keys: [{ label: 'k2', value: 'SECRET-k9' }] }

const events: unknown[] = []

const seed = async (M: Model<Account>, n = 1) => {
  const doc = await M.create(withSecrets(n))
  await mongoose.connection.collection('history').deleteMany({})
  events.length = 0
  return doc
}

const seedAdmin = async (M: Model<Admin>, n = 1) => {
  const doc = await M.create(withAdminSecrets(n))
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
    for (const prefix of ['hidden-default', 'hidden-included', 'hidden-disc', 'hidden-disc-included']) {
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

  describe('declared only in a discriminator schema', () => {
    for (const [title, Base, Child, included] of [
      ['by default', DiscBase, DiscChild, false],
      ['with includeHiddenPaths', DiscBaseIncluded, DiscChildIncluded, true],
    ] as const) {
      describe(title, () => {
        const discOperations: [string, () => PromiseLike<unknown>][] = [
          ['save (create)', () => Child.create(withAdminSecrets(1))],
          ['insertMany', () => Child.insertMany([withAdminSecrets(1)])],
          [
            'save (update)',
            async () => {
              const { _id } = await seedAdmin(Child)
              const doc = await Child.findById(_id).select('+passwordHash +profile.pin +keys.value')
              doc?.set(adminChange)
              await doc?.save()
            },
          ],
          ['updateOne on the discriminator', async () => Child.updateOne({ _id: (await seedAdmin(Child))._id }, { $set: adminChange })],
          ['updateOne on the base model', async () => Base.updateOne({ _id: (await seedAdmin(Child))._id }, { $set: { name: 'changed' } })],
          ['findOneAndUpdate on the base model', async () => Base.findOneAndUpdate({ _id: (await seedAdmin(Child))._id }, { $set: { name: 'changed' } })],
          ['deleteOne on the discriminator', async () => Child.deleteOne({ _id: (await seedAdmin(Child))._id })],
          ['deleteOne on the base model', async () => Base.deleteOne({ _id: (await seedAdmin(Child))._id })],
          [
            'bulkWrite on the base model',
            async () => {
              const a = await seedAdmin(Child, 1)
              const b = await seedAdmin(Child, 2)
              await Base.bulkWrite([{ updateOne: { filter: { _id: a._id }, update: { $set: { name: 'changed' } } } }, { deleteOne: { filter: { _id: b._id } } }] as never)
            },
          ],
        ]

        it.each(discOperations)('%s', async (_name, run) => {
          await run()
          const { rows, text, events: eventText } = await recorded(Base.modelName)
          const childRows = await HistoryModel.find({ modelName: Child.modelName }).lean()
          const all = text + JSON.stringify(childRows)
          expect(rows.length + childRows.length).toBeGreaterThan(0)
          if (included) {
            expect(all + eventText).toContain('SECRET')
          } else {
            expect(all).not.toContain('SECRET')
            expect(eventText).not.toContain('SECRET')
          }
        })
      })
    }
  })
})
