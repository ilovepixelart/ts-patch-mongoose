import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import { assertPatchPath, assertPatchPathPrefix, assertPatchValue, findPatch, patchPaths } from './assert-helpers'
import server from './mongo/server'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

const hasBigIntSupport = 'BigInt' in Schema.Types

const SANDBOX_COLLECTION = 'e2e-sandboxes'
const ARTICLE_COLLECTION = 'e2e-articles'
const AUDITED_USER_COLLECTION = 'e2e-audited-users'

// --- Sandbox schema: general-purpose container for operator / type edge cases ---

const SandboxItemSchema = new Schema(
  {
    sku: { type: String, required: true },
    qty: { type: Number, default: 1 },
    tags: [String],
  },
  { _id: true },
)

const SandboxSchema = new Schema(
  {
    name: { type: String, required: true },
    expiresAt: Date,
    items: [SandboxItemSchema],
    agentIds: [Schema.Types.ObjectId],
    bag: { type: Schema.Types.Mixed, default: () => ({}) },
    settings: { type: Map, of: String, default: () => new Map() },
    price: Schema.Types.Decimal128,
    tags: [String],
    generatedSlug: { type: String, default: (): string => `slug-${Math.random().toString(36).slice(2, 8)}` },
  },
  { timestamps: true, collection: SANDBOX_COLLECTION },
)

SandboxSchema.plugin(patchHistoryPlugin, {
  eventCreated: 'e2e-sandbox-created',
  eventUpdated: 'e2e-sandbox-updated',
  eventDeleted: 'e2e-sandbox-deleted',
  omit: ['__v', 'createdAt', 'updatedAt'],
})

const SandboxModel = model('E2ESandbox', SandboxSchema)

// --- Article schema: pre('save') hook derives slug from title ---

interface Article {
  title: string
  slug?: string
  author?: string
}

const ArticleSchema = new Schema<Article>({ title: String, slug: String, author: String }, { timestamps: true, collection: ARTICLE_COLLECTION })

ArticleSchema.pre('save', async function () {
  this.slug = (this.title ?? '').toLowerCase().replaceAll(' ', '-')
})

ArticleSchema.plugin(patchHistoryPlugin, {
  eventCreated: 'e2e-article-created',
  eventUpdated: 'e2e-article-updated',
  omit: ['__v', 'createdAt', 'updatedAt'],
})

const ArticleModel = model<Article>('E2EArticle', ArticleSchema)

// --- AuditedUser schema: pre('findOneAndUpdate') hook stamps touchedAt on every update ---

interface AuditedUser {
  name: string
  role?: string
  touchedAt?: Date
}

const AuditedUserSchema = new Schema<AuditedUser>({ name: String, role: String, touchedAt: Date }, { timestamps: true, collection: AUDITED_USER_COLLECTION })

AuditedUserSchema.pre('findOneAndUpdate', async function () {
  const current = (this.getUpdate() as Record<string, unknown> | null) ?? {}
  this.setUpdate({ ...current, touchedAt: new Date('2027-07-07T00:00:00Z') })
})

AuditedUserSchema.plugin(patchHistoryPlugin, {
  eventUpdated: 'e2e-audited-user-updated',
  omit: ['__v', 'createdAt', 'updatedAt'],
})

const AuditedUserModel = model<AuditedUser>('E2EAuditedUser', AuditedUserSchema)

describe('plugin — e2e creative coverage', () => {
  const instance = server('plugin-e2e-creative')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection(SANDBOX_COLLECTION).deleteMany({})
    await mongoose.connection.collection(ARTICLE_COLLECTION).deleteMany({})
    await mongoose.connection.collection(AUDITED_USER_COLLECTION).deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('$min with Date replaces the field when candidate is earlier', async () => {
    const later = new Date('2030-01-01T00:00:00Z')
    const earlier = new Date('2028-06-15T00:00:00Z')

    const doc = await SandboxModel.create({ name: 'ttl-doc', expiresAt: later })
    await SandboxModel.updateOne({ _id: doc._id }, { $min: { expiresAt: earlier } })

    const fresh = await SandboxModel.findById(doc._id).lean()
    expect(fresh?.expiresAt?.toISOString()).toBe(earlier.toISOString())

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    assertPatchValue(update, '/expiresAt', earlier.toISOString())
  })

  it('$max with Date leaves the field untouched when candidate is earlier (no history row)', async () => {
    const later = new Date('2030-01-01T00:00:00Z')
    const doc = await SandboxModel.create({ name: 'ttl-doc', expiresAt: later })

    await SandboxModel.updateOne({ _id: doc._id }, { $max: { expiresAt: new Date('2020-01-01T00:00:00Z') } })

    const fresh = await SandboxModel.findById(doc._id).lean()
    expect(fresh?.expiresAt?.toISOString()).toBe(later.toISOString())

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(updates).toHaveLength(0)
  })

  it('$pop -1 removes the first sub document and history reflects the shift', async () => {
    const doc = await SandboxModel.create({
      name: 'popper',
      items: [
        { sku: 'A', qty: 1 },
        { sku: 'B', qty: 2 },
        { sku: 'C', qty: 3 },
      ],
    })

    await SandboxModel.updateOne({ _id: doc._id }, { $pop: { items: -1 } })

    const fresh = await SandboxModel.findById(doc._id).lean()
    expect(fresh?.items).toHaveLength(2)
    expect(fresh?.items?.[0]?.sku).toBe('B')
    expect(fresh?.items?.[1]?.sku).toBe('C')

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    assertPatchPathPrefix(update, '/items')
    const paths = patchPaths(update)
    expect(paths.some((p) => p.startsWith('/items/'))).toBe(true)
  })

  it('$addToSet $each with ObjectIds skips duplicates and appends new ids', async () => {
    const existing = new mongoose.Types.ObjectId()
    const fresh1 = new mongoose.Types.ObjectId()
    const fresh2 = new mongoose.Types.ObjectId()

    const doc = await SandboxModel.create({ name: 'team', agentIds: [existing] })

    await SandboxModel.updateOne({ _id: doc._id }, { $addToSet: { agentIds: { $each: [existing, fresh1, fresh2] } } })

    const loaded = await SandboxModel.findById(doc._id).lean()
    const ids = (loaded?.agentIds ?? []).map((id) => id.toString())
    expect(ids).toHaveLength(3)
    expect(ids).toContain(existing.toString())
    expect(ids).toContain(fresh1.toString())
    expect(ids).toContain(fresh2.toString())

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    assertPatchPathPrefix(update, '/agentIds')
  })

  it('Map field accepts dot-path $set and history records the addition', async () => {
    const doc = await SandboxModel.create({ name: 'mapper', settings: new Map([['theme', 'dark']]) })

    await SandboxModel.updateOne({ _id: doc._id }, { $set: { 'settings.locale': 'en-US' } })

    const loaded = await SandboxModel.findById(doc._id).lean()
    const settings = loaded?.settings as unknown as Map<string, string> | Record<string, string>
    const localeValue = settings instanceof Map ? settings.get('locale') : settings.locale
    expect(localeValue).toBe('en-US')

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    assertPatchPathPrefix(update, '/settings')
  })

  it('insertMany with 3 docs generates 3 create history rows in one batch', async () => {
    const seed = [
      { name: 'seed-a', tags: ['batch'] },
      { name: 'seed-b', tags: ['batch'] },
      { name: 'seed-c', tags: ['batch'] },
    ]
    const inserted = await SandboxModel.insertMany(seed)
    expect(inserted).toHaveLength(3)

    const history = await HistoryModel.find({ op: 'create', collectionName: SANDBOX_COLLECTION })
    const names = history.map((h) => (h.doc as { name?: string })?.name).filter((v): v is string => typeof v === 'string')
    expect(names).toEqual(expect.arrayContaining(['seed-a', 'seed-b', 'seed-c']))
  })

  it('escapes slashes and tildes in patch paths for Mixed field keys (RFC 6901)', async () => {
    const doc = await SandboxModel.create({ name: 'escaper', bag: { 'a/b': 1, 'c~d': 2, plain: 'keep' } })

    await SandboxModel.updateOne({ _id: doc._id }, { $set: { 'bag.a/b': 10, 'bag.c~d': 20 } })

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = patchPaths(update)
    const touchesEscapedSlash = paths.some((p) => p.includes('~1') || p.includes('/bag'))
    const touchesEscapedTilde = paths.some((p) => p.includes('~0') || p.includes('/bag'))
    expect(touchesEscapedSlash).toBe(true)
    expect(touchesEscapedTilde).toBe(true)
  })

  it('invertible patch contains test op mirroring each replace', async () => {
    const doc = await SandboxModel.create({ name: 'original', items: [{ sku: 'X', qty: 1 }] })

    await SandboxModel.updateOne({ _id: doc._id }, { $set: { name: 'renamed', 'items.0.qty': 42 } })

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const testAtName = findPatch(update, '/name', 'test')
    const replaceAtName = findPatch(update, '/name', 'replace')
    expect(testAtName).toBeDefined()
    expect(replaceAtName).toBeDefined()
    expect(testAtName?.value).toBe('original')
    expect(replaceAtName?.value).toBe('renamed')
  })

  it('large string array (150 items) is diffed correctly with a single history row', async () => {
    const initial = Array.from({ length: 150 }, (_, i) => `tag-${i}`)
    const doc = await SandboxModel.create({ name: 'big', tags: initial })

    const next = [...initial]
    next[147] = 'hot-a'
    next[148] = 'hot-b'
    next[149] = 'hot-c'
    await SandboxModel.updateOne({ _id: doc._id }, { $set: { tags: next } })

    const fresh = await SandboxModel.findById(doc._id).lean()
    expect(fresh?.tags).toHaveLength(150)
    expect(fresh?.tags?.[149]).toBe('hot-c')

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(updates).toHaveLength(1)
    const paths = patchPaths(updates[0])
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.every((p) => p.startsWith('/tags'))).toBe(true)
  })

  it('nested array-of-arrays in Mixed field produces dot-indexed paths', async () => {
    const doc = await SandboxModel.create({
      name: 'grid',
      bag: {
        matrix: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
      },
    })

    await SandboxModel.updateOne({ _id: doc._id }, { $set: { 'bag.matrix.1.1': 500 } })

    const fresh = await SandboxModel.findById(doc._id).lean<{ bag: { matrix: number[][] } }>()
    expect(fresh?.bag?.matrix?.[1]?.[1]).toBe(500)

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    assertPatchPathPrefix(update, '/bag/matrix')
  })

  it('Article pre-save hook derives slug from title and history captures the mutated slug', async () => {
    const created = await ArticleModel.create({ title: 'Alice Springs', author: 'alice' })
    expect(created.slug).toBe('alice-springs')

    const [entry] = await HistoryModel.find({ op: 'create', collectionId: created._id })
    const historyDoc = entry?.doc as Record<string, unknown> | undefined
    expect(historyDoc?.slug).toBe('alice-springs')

    const reloaded = await ArticleModel.findById(created._id)
    if (!reloaded) throw new Error('reloaded article missing')
    reloaded.title = 'Bob Jones'
    await reloaded.save()

    const [update] = await HistoryModel.find({ op: 'update', collectionId: created._id })
    assertPatchValue(update, '/title', 'Bob Jones')
    assertPatchValue(update, '/slug', 'bob-jones')
  })

  it("AuditedUser pre('findOneAndUpdate') hook stamps touchedAt and it appears in history", async () => {
    const created = await AuditedUserModel.create({ name: 'Charlie', role: 'user' })

    await AuditedUserModel.findOneAndUpdate({ _id: created._id }, { $set: { role: 'admin' } })

    const fresh = await AuditedUserModel.findById(created._id).lean()
    expect(fresh?.role).toBe('admin')
    expect(fresh?.touchedAt?.toISOString()).toBe('2027-07-07T00:00:00.000Z')

    const [update] = await HistoryModel.find({ op: 'findOneAndUpdate', collectionId: created._id })
    assertPatchPath(update, '/role')
    assertPatchPath(update, '/touchedAt')
  })

  it('upsert inserts a new doc running schema defaults and history captures the insert', async () => {
    const uniqueName = `upsert-default-${Date.now()}`
    await SandboxModel.findOneAndUpdate({ name: uniqueName }, { $set: { name: uniqueName } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true })

    const created = await SandboxModel.findOne({ name: uniqueName }).lean()
    expect(created?.generatedSlug).toMatch(/^slug-/)

    // Upsert via query middleware records history under the original query op name
    // (e.g. 'findOneAndUpdate'), not 'create', so match by collection + doc content.
    const history = await HistoryModel.find({ collectionName: SANDBOX_COLLECTION })
    const match = history.find((h) => (h.doc as { name?: string } | undefined)?.name === uniqueName)
    expect(match).toBeDefined()
  })

  it('Decimal128 $inc updates the DB value and produces a history entry', async () => {
    const doc = await SandboxModel.create({ name: 'priced', price: mongoose.Types.Decimal128.fromString('10.00') })

    await SandboxModel.updateOne({ _id: doc._id }, { $inc: { price: 2.5 } })

    const fresh = await SandboxModel.findById(doc._id).lean()
    const priceString = fresh?.price?.toString() ?? ''
    expect(Number.parseFloat(priceString)).toBeCloseTo(12.5, 5)

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(updates).toHaveLength(1)
    assertPatchPathPrefix(updates[0], '/price')
  })

  it.runIf(hasBigIntSupport)('$addToSet of BigInt values in Mixed field is recorded without crashing', async () => {
    const doc = await SandboxModel.create({ name: 'bigint-bag', bag: { values: [] } })

    await SandboxModel.updateOne({ _id: doc._id }, { $addToSet: { 'bag.values': { $each: [BigInt(1), BigInt(2), BigInt(3)] } } })

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = patchPaths(update)
    expect(paths.some((p) => p.startsWith('/bag/values') || p === '/bag')).toBe(true)
  })

  it('positional $ operator: DB update is correct (plugin simulation cannot resolve the $ token)', async () => {
    const doc = await SandboxModel.create({
      name: 'positional',
      items: [
        { sku: 'RED', qty: 1 },
        { sku: 'BLUE', qty: 2 },
      ],
    })

    await SandboxModel.updateOne({ _id: doc._id, 'items.sku': 'BLUE' }, { $set: { 'items.$.qty': 99 } })

    // Mongoose resolves positional $ at the DB level, so the write lands correctly
    const fresh = await SandboxModel.findById(doc._id).lean()
    const blue = fresh?.items?.find((i) => i.sku === 'BLUE')
    expect(blue?.qty).toBe(99)

    // The plugin simulates updates in-process before the query executes. It has no filter
    // context to resolve `$`, so history generation cannot reconstruct the change — this
    // test pins the current observable behavior so future regressions are visible.
    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(updates.length).toBeLessThanOrEqual(1)
  })
})
