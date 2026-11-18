import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import mongoose, { model, Schema, type Types } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

interface Line {
  name: string
  qty: number
}

interface Item {
  sku: string
  count: number
  note?: string
  tags: string[]
  lines: Line[]
}

const ItemSchema = new Schema<Item>({
  sku: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  note: { type: String },
  tags: { type: [String], default: [] },
  lines: { type: [{ _id: false, name: String, qty: Number }], default: [] },
})

const ITEM_CREATED = 'real-item-created'
const ITEM_UPDATED = 'real-item-updated'
const ITEM_DELETED = 'real-item-deleted'

const preDeleted: string[][] = []

ItemSchema.plugin(patchHistoryPlugin, {
  omit: ['__v'],
  eventCreated: ITEM_CREATED,
  eventUpdated: ITEM_UPDATED,
  eventDeleted: ITEM_DELETED,
  preDelete: async (docs) => {
    const skus = docs.map((d) => (d as unknown as Item).sku)
    preDeleted.push(skus)
    // Simulates another client deleting the doc between the capture and the delete.
    if (skus.includes('raced')) await mongoose.connection.collection('realitems').deleteOne({ sku: 'raced' })
  },
})

const ItemModel = model<Item>('RealItem', ItemSchema)

const LooseSchema = new Schema<{ sku: string }>({ sku: String }, { strict: false })
LooseSchema.plugin(patchHistoryPlugin, { omit: ['__v'] })
const LooseModel = model('RealLoose', LooseSchema)

const updates = async (id?: Types.ObjectId) => {
  const filter: Record<string, unknown> = { op: { $nin: ['create'] }, patch: { $ne: [] } }
  if (id) filter.collectionId = id
  return HistoryModel.find(filter).sort({ createdAt: 1, _id: 1 }).lean()
}

type Op = { op: string; path: string; value?: unknown }

// RFC 6902 add, remove, replace and test, enough to replay recorded patches onto a plain object.
const replay = (source: Record<string, unknown>, patch: Op[]): Record<string, unknown> => {
  const target = structuredClone(source)
  for (const { op, path, value } of patch) {
    const keys = path.split('/').slice(1)
    const last = keys.pop() as string
    const parent = keys.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, target)
    if (op === 'test') {
      expect(parent[last]).toEqual(value)
    } else if (Array.isArray(parent)) {
      const index = last === '-' ? parent.length : Number(last)
      if (op === 'add') parent.splice(index, 0, value)
      if (op === 'remove') parent.splice(index, 1)
      if (op === 'replace') parent[index] = value
    } else if (op === 'remove') {
      delete parent[last]
    } else {
      parent[last] = value
    }
  }
  return target
}

const count = (event: string) => {
  const seen = { n: 0 }
  em.on(event, () => {
    seen.n++
  })
  return seen
}

describe('history records the real stored states', () => {
  const instance = server('real-state-history')

  beforeAll(async () => {
    await instance.create()
    await ItemModel.init()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('realitems').deleteMany({})
    await mongoose.connection.collection('realloose').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
    em.removeAllListeners()
    preDeleted.length = 0
  })

  describe('F1 single-document operations record only the document they changed', () => {
    it('F1 red: updateOne on a filter matching 3 docs writes exactly one update entry, for the changed doc', async () => {
      await ItemModel.create([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }])
      const res = await ItemModel.updateOne({}, { $set: { note: 'x' } })
      expect(res.modifiedCount).toBe(1)
      const changed = await ItemModel.findOne({ note: 'x' }).orFail()
      const rows = await updates()
      expect(rows.map((r) => String(r.collectionId))).toEqual([String(changed._id)])
    })

    it('F1 red: findOneAndUpdate with sort records the doc it actually changed, and only that one', async () => {
      await ItemModel.create([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }])
      const changed = await ItemModel.findOneAndUpdate({}, { $set: { note: 'x' } }, { sort: { sku: -1 }, new: true })
      const rows = await updates()
      expect(rows.map((r) => String(r.collectionId))).toEqual([String(changed?._id)])
    })

    it('F1 control: updateOne on a filter matching 1 doc writes one update entry', async () => {
      await ItemModel.create([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }])
      await ItemModel.updateOne({ sku: 'b' }, { $set: { note: 'x' } })
      expect(await updates()).toHaveLength(1)
    })
  })

  describe('F2 a failed write records nothing and emits nothing', () => {
    it('F2 red: updateOne rejected by a unique index leaves no history and emits no event', async () => {
      await ItemModel.create([{ sku: 'a' }, { sku: 'b' }])
      const emitted = count(ITEM_UPDATED)
      await expect(ItemModel.updateOne({ sku: 'a' }, { $set: { sku: 'b' } })).rejects.toThrow(/E11000/)
      expect(await ItemModel.countDocuments({ sku: 'a' })).toBe(1)
      expect({ history: (await updates()).length, emitted: emitted.n }).toEqual({ history: 0, emitted: 0 })
    })

    it('F2 red: doc.save() rejected by a unique index leaves no update history and emits no event', async () => {
      await ItemModel.create([{ sku: 'a' }, { sku: 'b' }])
      const emitted = count(ITEM_UPDATED)
      const doc = await ItemModel.findOne({ sku: 'a' }).orFail()
      doc.sku = 'b'
      await expect(doc.save()).rejects.toThrow(/E11000/)
      expect({ history: (await updates()).length, emitted: emitted.n }).toEqual({ history: 0, emitted: 0 })
    })

    it('F2 red: create rejected by a unique index leaves no create history and emits no event', async () => {
      await ItemModel.create({ sku: 'a' })
      const emitted = count(ITEM_CREATED)
      await expect(ItemModel.create({ sku: 'a' })).rejects.toThrow(/E11000/)
      expect({ history: await HistoryModel.countDocuments({ op: 'create' }), emitted: emitted.n }).toEqual({ history: 1, emitted: 0 })
    })

    it('F2 control: updateOne to a non-colliding sku records one entry and one event', async () => {
      await ItemModel.create([{ sku: 'a' }, { sku: 'b' }])
      const emitted = count(ITEM_UPDATED)
      await ItemModel.updateOne({ sku: 'a' }, { $set: { sku: 'c' } })
      expect({ history: (await updates()).length, emitted: emitted.n }).toEqual({ history: 1, emitted: 1 })
    })
  })

  describe('F3 update operators are recorded as the server applied them', () => {
    it('F3 red: $pull with a condition records the removal', async () => {
      const doc = await ItemModel.create({ sku: 'a', tags: ['x', 'y', 'z'] })
      await ItemModel.updateOne({ _id: doc._id }, { $pull: { tags: { $in: ['x', 'y'] } } })
      expect((await ItemModel.findById(doc._id).lean())?.tags).toEqual(['z'])
      const rows = await updates(doc._id)
      expect(rows).toHaveLength(1)
      expect(replay({ tags: ['x', 'y', 'z'] }, rows[0]?.patch ?? [])).toEqual({ tags: ['z'] })
    })

    it('F3 red: positional $ update records the change', async () => {
      const doc = await ItemModel.create({ sku: 'a', lines: [{ name: 'p', qty: 1 }] })
      await ItemModel.updateOne({ _id: doc._id, 'lines.name': 'p' }, { $set: { 'lines.$.qty': 5 } })
      expect((await ItemModel.findById(doc._id).lean())?.lines[0]?.qty).toBe(5)
      const rows = await updates(doc._id)
      expect(rows).toHaveLength(1)
      expect(replay({ lines: [{ name: 'p', qty: 1 }] }, rows[0]?.patch ?? [])).toEqual({ lines: [{ name: 'p', qty: 5 }] })
    })

    it('F3 red: arrayFilters update records the change', async () => {
      const doc = await ItemModel.create({ sku: 'a', lines: [{ name: 'p', qty: 1 }] })
      await ItemModel.updateOne({ _id: doc._id }, { $set: { 'lines.$[l].qty': 7 } }, { arrayFilters: [{ 'l.name': 'p' }] })
      expect((await ItemModel.findById(doc._id).lean())?.lines[0]?.qty).toBe(7)
      const rows = await updates(doc._id)
      expect(rows).toHaveLength(1)
      expect(replay({ lines: [{ name: 'p', qty: 1 }] }, rows[0]?.patch ?? [])).toEqual({ lines: [{ name: 'p', qty: 7 }] })
    })

    it('F3 red: $push with $position records a patch that turns the old array into the stored one', async () => {
      const doc = await ItemModel.create({ sku: 'a', tags: ['b', 'c'] })
      await ItemModel.updateOne({ _id: doc._id }, { $push: { tags: { $each: ['a'], $position: 0 } } })
      expect((await ItemModel.findById(doc._id).lean())?.tags).toEqual(['a', 'b', 'c'])
      const [row] = await updates(doc._id)
      expect(replay({ tags: ['b', 'c'] }, row?.patch ?? [])).toEqual({ tags: ['a', 'b', 'c'] })
    })

    it('F3 control: $pull of an exact value records the removal', async () => {
      const doc = await ItemModel.create({ sku: 'a', tags: ['x', 'y', 'z'] })
      await ItemModel.updateOne({ _id: doc._id }, { $pull: { tags: 'x' } })
      expect(await updates(doc._id)).toHaveLength(1)
    })
  })

  describe('F4 aggregation pipeline updates', () => {
    it('F4 red: updateOne with a pipeline records the change', async () => {
      const doc = await ItemModel.create({ sku: 'a', count: 1 })
      await ItemModel.updateOne({ _id: doc._id }, [{ $set: { count: { $add: ['$count', 1] } } }], { updatePipeline: true } as never)
      expect((await ItemModel.findById(doc._id).lean())?.count).toBe(2)
      const [row] = await updates(doc._id)
      expect(row?.patch).toEqual([
        { op: 'test', path: '/count', value: 1 },
        { op: 'replace', path: '/count', value: 2 },
      ])
    })

    it('F4 control: updateOne with $inc records the change', async () => {
      const doc = await ItemModel.create({ sku: 'a', count: 1 })
      await ItemModel.updateOne({ _id: doc._id }, { $inc: { count: 1 } })
      expect(await updates(doc._id)).toHaveLength(1)
    })
  })

  describe('F5 bulkWrite', () => {
    it('F5 red: bulkWrite records updates, replacements, inserts and deletes and emits their events', async () => {
      const [a, b, c] = await ItemModel.create([{ sku: 'a', count: 1 }, { sku: 'b' }, { sku: 'c' }], { ordered: true })
      const events = { created: count(ITEM_CREATED), updated: count(ITEM_UPDATED), deleted: count(ITEM_DELETED) }
      await ItemModel.bulkWrite([
        { updateOne: { filter: { _id: a?._id }, update: { $set: { count: 9 } } } },
        { replaceOne: { filter: { _id: b?._id }, replacement: { sku: 'b', note: 'r' } } },
        { insertOne: { document: { sku: 'd' } } },
        { deleteOne: { filter: { _id: c?._id } } },
        { updateMany: { filter: { sku: 'nobody' }, update: { $set: { note: 'n' } } } },
      ] as never)
      const rows = await HistoryModel.find({ op: { $ne: 'create' } }).lean()
      const byOp = rows.map((r) => [r.op, (r.doc as { sku?: string } | undefined)?.sku ?? String(r.collectionId)]).sort()
      const inserted = await ItemModel.findOne({ sku: 'd' }).orFail()
      expect(byOp).toEqual(
        [
          ['deleteOne', 'c'],
          ['replaceOne', String(b?._id)],
          ['updateOne', String(a?._id)],
        ].sort(),
      )
      expect(await HistoryModel.countDocuments({ op: 'create', collectionId: inserted._id })).toBe(1)
      expect(rows.find((r) => String(r.collectionId) === String(a?._id))?.patch).toEqual([
        { op: 'test', path: '/count', value: 1 },
        { op: 'replace', path: '/count', value: 9 },
      ])
      expect(preDeleted).toEqual([['c']])
      expect({ created: events.created.n, updated: events.updated.n, deleted: events.deleted.n }).toEqual({ created: 1, updated: 2, deleted: 1 })
    })

    it('F5 red: bulkWrite upsert that inserts records a create-shaped entry', async () => {
      await ItemModel.bulkWrite([{ updateOne: { filter: { sku: 'u' }, update: { $set: { count: 2 } }, upsert: true } }])
      const doc = await ItemModel.findOne({ sku: 'u' }).orFail()
      const rows = await HistoryModel.find({ collectionId: doc._id }).lean()
      expect(rows.map((r) => [r.op, r.version, (r.doc as { count: number }).count])).toEqual([['updateOne', 0, 2]])
    })

    it('F5 control: bulkWrite with ignoreHook records nothing', async () => {
      const doc = await ItemModel.create({ sku: 'a', count: 1 })
      await ItemModel.bulkWrite([{ updateOne: { filter: { _id: doc._id }, update: { $set: { count: 9 } } } }], { ignoreHook: true } as never)
      expect(await updates(doc._id)).toHaveLength(0)
    })

    it('F5 control: updateOne with the same update records the change', async () => {
      const doc = await ItemModel.create({ sku: 'a', count: 1 })
      await ItemModel.updateOne({ _id: doc._id }, { $set: { count: 9 } })
      expect(await updates(doc._id)).toHaveLength(1)
    })
  })

  describe('F6 replaceOne records removed fields', () => {
    it('F6 red: replaceOne dropping a field records its removal', async () => {
      const doc = await ItemModel.create({ sku: 'a', note: 'keep?' })
      await ItemModel.replaceOne({ _id: doc._id }, { sku: 'a' })
      expect((await ItemModel.findById(doc._id).lean())?.note).toBeUndefined()
      const rows = await updates(doc._id)
      expect(rows.flatMap((r) => r.patch ?? [])).toContainEqual({ op: 'remove', path: '/note' })
    })

    it('F6 control: replaceOne changing a field records the replacement', async () => {
      const doc = await ItemModel.create({ sku: 'a', note: 'old' })
      await ItemModel.replaceOne({ _id: doc._id }, { sku: 'a', note: 'new' })
      const rows = await updates(doc._id)
      expect(rows.flatMap((r) => r.patch ?? [])).toContainEqual({ op: 'replace', path: '/note', value: 'new' })
    })
  })

  describe('F7 findOneAndDelete with sort records the deleted document', () => {
    const deleted = async () => HistoryModel.find({ op: 'findOneAndDelete' }).lean()

    it('F7 red: findOneAndDelete sort { sku: -1 } records and passes to preDelete the doc that was deleted', async () => {
      await ItemModel.insertMany([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }])
      const gone = await ItemModel.findOneAndDelete({}, { sort: { sku: -1 } })
      expect(gone?.sku).toBe('c')
      const rows = await deleted()
      expect({ history: rows.map((r) => (r.doc as { sku: string }).sku), preDeleted }).toEqual({ history: ['c'], preDeleted: [['c']] })
    })

    it('F7 red: deleteOne records nothing and emits nothing when the doc was already gone at delete time', async () => {
      await ItemModel.insertMany([{ sku: 'raced' }])
      const emitted = count(ITEM_DELETED)
      const res = await ItemModel.deleteOne({ sku: 'raced' })
      expect({ deleted: res.deletedCount, preDeleted }).toEqual({ deleted: 0, preDeleted: [['raced']] })
      expect({ history: await HistoryModel.countDocuments({ op: 'deleteOne' }), emitted: emitted.n }).toEqual({ history: 0, emitted: 0 })
    })

    it('F7 control: findOneAndDelete by unique filter records the doc that was deleted', async () => {
      await ItemModel.insertMany([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }])
      await ItemModel.findOneAndDelete({ sku: 'c' })
      const rows = await deleted()
      expect(rows.map((r) => (r.doc as { sku: string }).sku)).toEqual(['c'])
    })
  })

  describe('F8 concurrent updates outside a transaction', () => {
    it('F8: two parallel $inc record only states that were stored, and the last entry ends at the stored value', async () => {
      const doc = await ItemModel.create({ sku: 'a', count: 0 })
      await Promise.all([ItemModel.updateOne({ _id: doc._id }, { $inc: { count: 1 } }), ItemModel.updateOne({ _id: doc._id }, { $inc: { count: 1 } })])
      expect((await ItemModel.findById(doc._id).lean())?.count).toBe(2)
      const values = (await updates(doc._id)).flatMap((r) => (r.patch ?? []).filter((p) => p.op === 'replace').map((p) => (p as { value?: unknown }).value))
      expect(values).toHaveLength(2)
      expect(values.every((v) => v === 1 || v === 2)).toBe(true)
      expect(values).toContain(2)
    })

    it('F8 control: two sequential $inc record 0->1 and 1->2 with distinct versions', async () => {
      const doc = await ItemModel.create({ sku: 'a', count: 0 })
      await ItemModel.updateOne({ _id: doc._id }, { $inc: { count: 1 } })
      await ItemModel.updateOne({ _id: doc._id }, { $inc: { count: 1 } })
      const rows = await updates(doc._id)
      const values = rows.flatMap((r) => (r.patch ?? []).filter((p) => p.op === 'replace').map((p) => (p as { value?: unknown }).value))
      expect({ values, versions: rows.map((r) => r.version) }).toEqual({ values: [1, 2], versions: [1, 2] })
    })
  })

  describe('F9 strict mode', () => {
    it('F9 red: $set of a path not in a strict schema records nothing', async () => {
      const doc = await ItemModel.create({ sku: 'a' })
      await ItemModel.updateOne({ _id: doc._id }, { $set: { notInSchema: 'ghost' } } as never)
      expect((await ItemModel.findById(doc._id).lean()) as unknown as Record<string, unknown>).not.toHaveProperty('notInSchema')
      expect(await updates(doc._id)).toHaveLength(0)
    })

    it('F9 control: $set of a path not in a strict: false schema is stored and recorded', async () => {
      const doc = await LooseModel.create({ sku: 'a' })
      await LooseModel.updateOne({ _id: doc._id }, { $set: { extra: 'kept' } } as never)
      expect(((await LooseModel.findById(doc._id).lean()) as unknown as Record<string, unknown>).extra).toBe('kept')
      const [row] = await updates(doc._id)
      expect(row?.patch).toEqual([{ op: 'add', path: '/extra', value: 'kept' }])
    })

    it('F9 control: $set of a schema path to its current value records nothing', async () => {
      const doc = await ItemModel.create({ sku: 'a', note: 'same' })
      await ItemModel.updateOne({ _id: doc._id }, { $set: { note: 'same' } })
      expect(await updates(doc._id)).toHaveLength(0)
    })
  })
})
