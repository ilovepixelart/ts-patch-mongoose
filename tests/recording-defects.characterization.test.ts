import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { Schema } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

// Characterization: what the plugin records today where history disagrees with what MongoDB stored.
// History is computed in pre hooks from a simulation of the update applied to every document the
// filter matches, so it describes the plugin's prediction, not the write. Each test pins one such
// case as it is; a fix changes its expectation.

interface Line {
  k: string
  v: number
}

interface Doc {
  sku: string
  count: number
  tags: string[]
  lines: Line[]
  secret?: string
}

const CREATED = 'defects-created'
const UPDATED = 'defects-updated'
const DELETED = 'defects-deleted'

const predeleted: string[][] = []
const events: string[] = []

const schema = new Schema<Doc>({
  sku: String,
  count: { type: Number, default: 0 },
  tags: [String],
  lines: [new Schema<Line>({ k: String, v: Number }, { _id: false })],
  secret: { type: String, select: false },
})
schema.plugin(patchHistoryPlugin, {
  eventCreated: CREATED,
  eventUpdated: UPDATED,
  eventDeleted: DELETED,
  omit: ['__v'],
  preDelete: async (docs) => {
    predeleted.push(docs.map((doc) => String((doc as { sku?: string }).sku)))
  },
})
const Item = mongoose.model<Doc>('DefectItem', schema)

type Recorded = { op: string; sku?: string; patch?: { op: string; path: string; value?: unknown }[] }

// The entries written after the setup, oldest first, without their ids and dates.
const recorded = async (): Promise<Recorded[]> => {
  const rows = await HistoryModel.find({ modelName: 'DefectItem', version: { $gt: 0 } })
    .sort({ _id: 1 })
    .lean()
  const deletes = await HistoryModel.find({ modelName: 'DefectItem', op: { $in: ['deleteOne', 'deleteMany', 'findOneAndDelete'] } })
    .sort({ _id: 1 })
    .lean()
  return [...rows, ...deletes].map((h) => ({
    op: h.op,
    ...(h.doc ? { sku: (h.doc as { sku?: string }).sku } : {}),
    ...(h.patch?.length ? { patch: JSON.parse(JSON.stringify(h.patch)).filter((op: { op: string }) => op.op !== 'test') } : {}),
  }))
}

// Three documents a, b and c, created in that order.
const seed = async (extra: Partial<Doc> = {}) => {
  for (const sku of ['a', 'b', 'c'])
    await Item.create({
      sku,
      tags: ['x', 'y'],
      lines: [
        { k: 'p', v: 1 },
        { k: 'q', v: 2 },
      ],
      ...extra,
    })
}

describe('characterization: recording defects', () => {
  const instance = server('recording-defects')
  const listen = (name: string) => () => events.push(name)
  const listeners = [CREATED, UPDATED, DELETED].map((name) => [name, listen(name)] as const)

  beforeAll(async () => {
    await instance.create()
    for (const [name, fn] of listeners) em.on(name, fn)
  })

  afterAll(async () => {
    for (const [name, fn] of listeners) em.off(name, fn)
    await instance.destroy()
  })

  beforeEach(async () => {
    await Item.collection.deleteMany({})
    await HistoryModel.deleteMany({})
    predeleted.length = 0
  })

  it('characterization: an updateOne matching three documents records an entry for each, though it changes one', async () => {
    await seed()
    const result = await Item.updateOne({}, { $set: { count: 5 } })
    expect(result.modifiedCount).toBe(1)
    expect((await recorded()).map((r) => r.op)).toEqual(['updateOne', 'updateOne', 'updateOne'])
  })

  it('characterization: a sorted findOneAndUpdate records every match, not the document it updates', async () => {
    await seed()
    const updated = await Item.findOneAndUpdate({}, { $set: { count: 5 } }, { sort: { sku: -1 }, new: true })
    expect(updated?.sku).toBe('c')
    expect((await recorded()).length).toBe(3)
  })

  it('characterization: a conditional $pull records nothing', async () => {
    await seed()
    await Item.updateOne({ sku: 'a' }, { $pull: { lines: { v: { $gt: 1 } } } })
    expect((await Item.findOne({ sku: 'a' }).lean())?.lines).toEqual([{ k: 'p', v: 1 }])
    expect(await recorded()).toEqual([])
  })

  it('characterization: a positional $ update records nothing', async () => {
    await seed()
    await Item.updateOne({ sku: 'a', 'lines.k': 'q' }, { $set: { 'lines.$.v': 9 } })
    expect((await Item.findOne({ sku: 'a' }).lean())?.lines).toEqual([
      { k: 'p', v: 1 },
      { k: 'q', v: 9 },
    ])
    expect(await recorded()).toEqual([])
  })

  it('characterization: an arrayFilters update records nothing', async () => {
    await seed()
    await Item.updateOne({ sku: 'a' }, { $set: { 'lines.$[l].v': 7 } }, { arrayFilters: [{ 'l.k': 'p' }] })
    expect((await Item.findOne({ sku: 'a' }).lean())?.lines).toEqual([
      { k: 'p', v: 7 },
      { k: 'q', v: 2 },
    ])
    expect(await recorded()).toEqual([])
  })

  it('characterization: a $push at position 0 records the value as appended at the end', async () => {
    await seed()
    await Item.updateOne({ sku: 'a' }, { $push: { tags: { $each: ['w'], $position: 0 } } })
    expect((await Item.findOne({ sku: 'a' }).lean())?.tags).toEqual(['w', 'x', 'y'])
    expect((await recorded()).map((r) => r.patch)).toEqual([[{ op: 'add', path: '/tags/2', value: 'w' }]])
  })

  it('characterization: a pipeline update records nothing', async () => {
    await seed()
    await Item.updateOne({ sku: 'a' }, [{ $set: { count: { $add: ['$count', 3] } } }], { updatePipeline: true } as never)
    expect((await Item.findOne({ sku: 'a' }).lean())?.count).toBe(3)
    expect(await recorded()).toEqual([])
  })

  it('characterization: Model.bulkWrite records nothing', async () => {
    await seed()
    await Item.bulkWrite([{ updateOne: { filter: { sku: 'a' }, update: { $set: { count: 1 } } } }, { deleteOne: { filter: { sku: 'b' } } }, { insertOne: { document: { sku: 'd' } } }])
    expect((await Item.find({}).sort({ sku: 1 }).lean()).map((d) => d.sku)).toEqual(['a', 'c', 'd'])
    expect(await recorded()).toEqual([])
    expect(await HistoryModel.countDocuments({ modelName: 'DefectItem' })).toBe(3)
  })

  it('characterization: a sorted findOneAndDelete records and hands preDelete the first match, not the document it deletes', async () => {
    await seed()
    const deleted = await Item.findOneAndDelete({}, { sort: { sku: -1 } })
    expect(deleted?.sku).toBe('c')
    expect(predeleted).toEqual([['a']])
    expect((await recorded()).map((r) => r.sku)).toEqual(['a'])
  })

  it('characterization: two concurrent updates of one document record the same version', async () => {
    await seed()
    await Promise.all([1, 2].map((n) => Item.updateOne({ sku: 'a' }, { $inc: { count: n } })))
    const versions = (await HistoryModel.find({ modelName: 'DefectItem', version: { $gt: 0 } }).lean()).map((h) => h.version)
    expect(versions).toEqual([1, 1])
  })

  it('characterization: a $set of a path strict mode drops records it as added', async () => {
    await seed()
    await Item.updateOne({ sku: 'a' }, { $set: { notInSchema: 1 } } as never)
    expect(await Item.collection.findOne({ sku: 'a' })).not.toHaveProperty('notInSchema')
    expect((await recorded()).map((r) => r.patch)).toEqual([[{ op: 'add', path: '/notInSchema', value: 1 }]])
  })

  it('characterization: a select: false path is recorded in the create entry', async () => {
    await Item.create({ sku: 'a', secret: 'hash' })
    const created = await HistoryModel.findOne({ modelName: 'DefectItem', op: 'create' }).lean()
    expect((created?.doc as { secret?: string } | undefined)?.secret).toBe('hash')
  })
})
