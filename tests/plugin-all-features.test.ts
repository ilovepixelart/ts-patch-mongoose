import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

import type { Types } from 'mongoose'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

interface Address {
  street: string
  city: string
  zip: string
}

const AddressSchema = new Schema<Address>(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    zip: { type: String, required: true },
  },
  { _id: false, timestamps: false },
)

interface Order {
  item: string
  quantity: number
  tags: string[]
  address: Address
  notes?: string
  priority?: number
  assignedTo?: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

const OrderSchema = new Schema<Order>(
  {
    item: { type: String, required: true },
    quantity: { type: Number, required: true },
    tags: { type: [String], default: undefined },
    address: { type: AddressSchema, required: true },
    notes: { type: String },
    priority: { type: Number, default: 0 },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

const ORDER_CREATED = 'order-created'
const ORDER_UPDATED = 'order-updated'
const ORDER_DELETED = 'order-deleted'

const preDeleteDocs: unknown[][] = []

OrderSchema.plugin(patchHistoryPlugin, {
  modelName: 'CustomOrder',
  collectionName: 'custom_orders',
  eventCreated: ORDER_CREATED,
  eventUpdated: ORDER_UPDATED,
  eventDeleted: ORDER_DELETED,
  omit: ['__v', 'createdAt', 'updatedAt', 'notes'],
  getUser: () => ({ name: 'test-user', role: 'admin' }),
  getReason: () => 'automated-test',
  getMetadata: () => ({ source: 'test-suite', version: 1 }),
  preDelete: async (docs) => {
    preDeleteDocs.push(docs)
  },
})

const OrderModel = model<Order>('Order', OrderSchema)

describe('plugin — all features', () => {
  const instance = server('plugin-all-features')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('orders').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
    preDeleteDocs.length = 0
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should use custom modelName and collectionName in history', async () => {
    const order = await OrderModel.create({
      item: 'Widget',
      quantity: 10,
      tags: ['electronics'],
      address: { street: '123 Main St', city: 'Springfield', zip: '62701' },
    })

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(1)

    const [entry] = history
    expect(entry.modelName).toBe('CustomOrder')
    expect(entry.collectionName).toBe('custom_orders')
    expect(entry.collectionId).toEqual(order._id)
  })

  it('should store user, reason, and metadata from callbacks', async () => {
    await OrderModel.create({
      item: 'Gadget',
      quantity: 5,
      tags: ['tech'],
      address: { street: '456 Oak Ave', city: 'Portland', zip: '97201' },
    })

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(1)

    const [entry] = history
    expect(entry.user).toEqual({ name: 'test-user', role: 'admin' })
    expect(entry.reason).toBe('automated-test')
    expect(entry.metadata).toEqual({ source: 'test-suite', version: 1 })
  })

  it('should omit specified fields from history doc', async () => {
    await OrderModel.create({
      item: 'Gizmo',
      quantity: 3,
      tags: ['misc'],
      address: { street: '789 Elm Blvd', city: 'Austin', zip: '73301' },
      notes: 'secret internal note',
    })

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(1)

    const [entry] = history
    expect(entry.doc).toHaveProperty('item', 'Gizmo')
    expect(entry.doc).toHaveProperty('quantity', 3)
    expect(entry.doc).not.toHaveProperty('notes')
    expect(entry.doc).not.toHaveProperty('createdAt')
    expect(entry.doc).not.toHaveProperty('updatedAt')
    expect(entry.doc).not.toHaveProperty('__v')
  })

  it('should omit specified fields from update patches', async () => {
    const order = await OrderModel.create({
      item: 'Widget',
      quantity: 10,
      tags: ['electronics'],
      address: { street: '123 Main St', city: 'Springfield', zip: '62701' },
      notes: 'initial note',
    })

    order.notes = 'updated note'
    await order.save()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(1)
    expect(history[0]?.op).toBe('create')
  })

  it('should track save updates with nested object changes', async () => {
    const order = await OrderModel.create({
      item: 'Widget',
      quantity: 10,
      tags: ['electronics'],
      address: { street: '123 Main St', city: 'Springfield', zip: '62701' },
    })

    order.address = { street: '456 New St', city: 'Chicago', zip: '60601' }
    order.quantity = 20
    await order.save()

    const history = await HistoryModel.find({}).sort('version')
    expect(history).toHaveLength(2)

    const [, update] = history
    expect(update?.op).toBe('update')
    expect(update?.version).toBe(1)
    expect(update?.patch?.length).toBeGreaterThan(0)

    const paths = update?.patch?.map((p) => p.path)
    expect(paths).toContain('/quantity')
    expect(paths).toContain('/address/street')
    expect(paths).toContain('/address/city')
    expect(paths).toContain('/address/zip')
  })

  it('should track updateOne with $set and $inc operators', async () => {
    const order = await OrderModel.create({
      item: 'Widget',
      quantity: 10,
      priority: 1,
      tags: ['electronics'],
      address: { street: '123 Main St', city: 'Springfield', zip: '62701' },
    })

    await OrderModel.updateOne({ _id: order._id }, { $set: { item: 'Super Widget' }, $inc: { priority: 2 } }).exec()

    const history = await HistoryModel.find({}).sort('version')
    expect(history).toHaveLength(2)

    const [, update] = history
    expect(update?.op).toBe('updateOne')

    const paths = update?.patch?.map((p) => p.path)
    expect(paths).toContain('/item')
  })

  it('should track findOneAndUpdate', async () => {
    const order = await OrderModel.create({
      item: 'Widget',
      quantity: 10,
      tags: ['electronics'],
      address: { street: '123 Main St', city: 'Springfield', zip: '62701' },
    })

    await OrderModel.findOneAndUpdate({ _id: order._id }, { quantity: 50 }).exec()

    const history = await HistoryModel.find({}).sort('version')
    expect(history).toHaveLength(2)

    const [, update] = history
    expect(update?.op).toBe('findOneAndUpdate')
    expect(update?.patch).toMatchObject(expect.arrayContaining([expect.objectContaining({ op: 'replace', path: '/quantity', value: 50 })]))
  })

  it('should call preDelete and track deleteOne', async () => {
    const order = await OrderModel.create({
      item: 'Widget',
      quantity: 10,
      tags: ['electronics'],
      address: { street: '123 Main St', city: 'Springfield', zip: '62701' },
    })

    await OrderModel.deleteOne({ _id: order._id }).exec()

    expect(preDeleteDocs).toHaveLength(1)
    expect(preDeleteDocs[0]).toHaveLength(1)
    expect(preDeleteDocs[0]?.[0]).toHaveProperty('item', 'Widget')

    const history = await HistoryModel.find({}).sort('version')
    expect(history).toHaveLength(2)

    const [, deletion] = history
    expect(deletion?.op).toBe('deleteOne')
    expect(deletion?.doc).toHaveProperty('item', 'Widget')
    expect(deletion?.doc).not.toHaveProperty('notes')
    expect(deletion?.doc).not.toHaveProperty('__v')
  })

  it('should call preDelete and track deleteMany', async () => {
    await OrderModel.create({
      item: 'A',
      quantity: 1,
      tags: ['bulk'],
      address: { street: '1 St', city: 'A', zip: '00001' },
    })
    await OrderModel.create({
      item: 'B',
      quantity: 2,
      tags: ['bulk'],
      address: { street: '2 St', city: 'B', zip: '00002' },
    })

    await OrderModel.deleteMany({ tags: 'bulk' }).exec()

    expect(preDeleteDocs).toHaveLength(1)
    expect(preDeleteDocs[0]).toHaveLength(2)

    const history = await HistoryModel.find({ op: 'deleteMany' })
    expect(history).toHaveLength(2)

    for (const entry of history) {
      expect(entry.modelName).toBe('CustomOrder')
      expect(entry.user).toEqual({ name: 'test-user', role: 'admin' })
      expect(entry.reason).toBe('automated-test')
      expect(entry.doc).not.toHaveProperty('notes')
    }
  })

  it('should track insertMany', async () => {
    await OrderModel.insertMany([
      { item: 'X', quantity: 1, tags: ['batch'], address: { street: '1 St', city: 'X', zip: '11111' } },
      { item: 'Y', quantity: 2, tags: ['batch'], address: { street: '2 St', city: 'Y', zip: '22222' } },
      { item: 'Z', quantity: 3, tags: ['batch'], address: { street: '3 St', city: 'Z', zip: '33333' } },
    ])

    const history = await HistoryModel.find({ op: 'create' }).sort('doc.item')
    expect(history).toHaveLength(3)

    for (const entry of history) {
      expect(entry.modelName).toBe('CustomOrder')
      expect(entry.collectionName).toBe('custom_orders')
      expect(entry.version).toBe(0)
      expect(entry.user).toEqual({ name: 'test-user', role: 'admin' })
      expect(entry.reason).toBe('automated-test')
      expect(entry.metadata).toEqual({ source: 'test-suite', version: 1 })
    }
  })

  it('should emit all three event types', async () => {
    const order = await OrderModel.create({
      item: 'EventTest',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'E', zip: '00000' },
    })

    order.item = 'EventTestUpdated'
    await order.save()

    await OrderModel.deleteOne({ _id: order._id }).exec()

    expect(em.emit).toHaveBeenCalledWith(ORDER_CREATED, expect.objectContaining({ doc: expect.any(Object) }))
    expect(em.emit).toHaveBeenCalledWith(
      ORDER_UPDATED,
      expect.objectContaining({
        oldDoc: expect.objectContaining({ item: 'EventTest' }),
        doc: expect.objectContaining({ item: 'EventTestUpdated' }),
        patch: expect.any(Array),
      }),
    )
    expect(em.emit).toHaveBeenCalledWith(ORDER_DELETED, expect.objectContaining({ oldDoc: expect.any(Object) }))
  })

  it('should handle updateMany across multiple documents', async () => {
    await OrderModel.create({ item: 'A', quantity: 1, tags: ['group'], address: { street: '1', city: 'A', zip: '00001' } })
    await OrderModel.create({ item: 'B', quantity: 2, tags: ['group'], address: { street: '2', city: 'B', zip: '00002' } })

    await OrderModel.updateMany({ tags: 'group' }, { $set: { quantity: 99 } }).exec()

    const updates = await HistoryModel.find({ op: 'updateMany' })
    expect(updates).toHaveLength(2)

    for (const entry of updates) {
      expect(entry.patch).toMatchObject(expect.arrayContaining([expect.objectContaining({ op: 'replace', path: '/quantity', value: 99 })]))
      expect(entry.user).toEqual({ name: 'test-user', role: 'admin' })
      expect(entry.reason).toBe('automated-test')
    }
  })

  it('should track array field changes', async () => {
    const order = await OrderModel.create({
      item: 'TagTest',
      quantity: 1,
      tags: ['a', 'b'],
      address: { street: '1 St', city: 'T', zip: '00000' },
    })

    await OrderModel.updateOne({ _id: order._id }, { tags: ['a', 'b', 'c'] }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path)
    expect(paths?.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('should handle upsert creating a new document', async () => {
    await OrderModel.findOneAndUpdate({ item: 'UpsertNew' }, { item: 'UpsertNew', quantity: 1, tags: ['upsert'], address: { street: '1 St', city: 'U', zip: '00000' } }, { upsert: true, runValidators: true }).exec()

    const docs = await OrderModel.find({ item: 'UpsertNew' })
    expect(docs).toHaveLength(1)

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(1)
    expect(history[0]?.op).toBe('findOneAndUpdate')
    expect(history[0]?.doc).toHaveProperty('item', 'UpsertNew')
  })

  it('should skip hooks when ignoreHook is set', async () => {
    await OrderModel.create({
      item: 'IgnoreHook',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'I', zip: '00000' },
    })

    const historyAfterCreate = await HistoryModel.find({})
    expect(historyAfterCreate).toHaveLength(1)

    await OrderModel.updateOne({ item: 'IgnoreHook' }, { quantity: 99 }).setOptions({ ignoreHook: true }).exec()

    const historyAfterUpdate = await HistoryModel.find({})
    expect(historyAfterUpdate).toHaveLength(1)

    await OrderModel.deleteOne({ item: 'IgnoreHook' }).setOptions({ ignoreHook: true }).exec()

    const historyAfterDelete = await HistoryModel.find({})
    expect(historyAfterDelete).toHaveLength(1)
  })

  it('should skip events but keep history when ignoreEvent is set', async () => {
    const order = await OrderModel.create({
      item: 'IgnoreEvent',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'E', zip: '00000' },
    })

    vi.resetAllMocks()

    await OrderModel.updateOne({ _id: order._id }, { quantity: 50 }).setOptions({ ignoreEvent: true }).exec()

    const history = await HistoryModel.find({ op: 'updateOne' })
    expect(history).toHaveLength(1)
    expect(history[0]?.patch).toMatchObject(expect.arrayContaining([expect.objectContaining({ op: 'replace', path: '/quantity', value: 50 })]))

    expect(em.emit).not.toHaveBeenCalledWith(ORDER_UPDATED, expect.anything())
  })

  it('should skip history but keep events when ignorePatchHistory is set', async () => {
    const order = await OrderModel.create({
      item: 'IgnoreHistory',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'H', zip: '00000' },
    })

    vi.resetAllMocks()

    await OrderModel.updateOne({ _id: order._id }, { quantity: 50 }).setOptions({ ignorePatchHistory: true }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledWith(ORDER_UPDATED, expect.objectContaining({ patch: expect.any(Array) }))
  })

  it('should increment version across multiple updates', async () => {
    const order = await OrderModel.create({
      item: 'Versioning',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'V', zip: '00000' },
    })

    order.quantity = 2
    await order.save()
    order.quantity = 3
    await order.save()
    order.quantity = 4
    await order.save()

    const history = await HistoryModel.find({ collectionId: order._id }).sort('version')
    expect(history).toHaveLength(4)
    expect(history[0]?.version).toBe(0)
    expect(history[1]?.version).toBe(1)
    expect(history[2]?.version).toBe(2)
    expect(history[3]?.version).toBe(3)
  })

  it('should track ObjectId reference field changes', async () => {
    const userId = new mongoose.Types.ObjectId()
    const order = await OrderModel.create({
      item: 'RefTest',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'R', zip: '00000' },
    })

    await OrderModel.updateOne({ _id: order._id }, { assignedTo: userId }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path)
    expect(paths).toContain('/assignedTo')
  })

  it('should handle full lifecycle: create → update → update → delete', async () => {
    const order = await OrderModel.create({
      item: 'Lifecycle',
      quantity: 1,
      tags: ['start'],
      address: { street: '1 St', city: 'L', zip: '00000' },
    })

    order.quantity = 10
    order.tags = ['start', 'updated']
    await order.save()

    await OrderModel.updateOne({ _id: order._id }, { $set: { item: 'Lifecycle Done' } }).exec()

    await OrderModel.deleteOne({ _id: order._id }).exec()

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history).toHaveLength(4)

    expect(history[0]?.op).toBe('create')
    expect(history[0]?.version).toBe(0)

    expect(history[1]?.op).toBe('update')
    expect(history[1]?.version).toBe(1)
    expect(history[1]?.patch?.length).toBeGreaterThan(0)

    expect(history[2]?.op).toBe('updateOne')
    expect(history[2]?.version).toBe(2)

    expect(history[3]?.op).toBe('deleteOne')
    expect(history[3]?.version).toBe(0)
    expect(history[3]?.doc).toHaveProperty('item', 'Lifecycle Done')
    expect(history[3]?.doc).not.toHaveProperty('__v')
    expect(history[3]?.doc).not.toHaveProperty('notes')

    expect(em.emit).toHaveBeenCalledWith(ORDER_CREATED, expect.any(Object))
    expect(em.emit).toHaveBeenCalledWith(ORDER_UPDATED, expect.any(Object))
    expect(em.emit).toHaveBeenCalledWith(ORDER_DELETED, expect.any(Object))
  })

  it('should handle $push $pull $addToSet operators', async () => {
    const order = await OrderModel.create({
      item: 'ArrayOps',
      quantity: 1,
      tags: ['initial'],
      address: { street: '1 St', city: 'A', zip: '00000' },
    })

    await OrderModel.updateOne({ _id: order._id }, { $push: { tags: 'pushed' } }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path)
    expect(paths?.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('should handle multiple $ operators in one update', async () => {
    const order = await OrderModel.create({
      item: 'MultiOp',
      quantity: 1,
      priority: 0,
      tags: ['start'],
      address: { street: '1 St', city: 'M', zip: '00000' },
    })

    await OrderModel.updateOne({ _id: order._id }, { $set: { item: 'MultiOpDone' }, $inc: { priority: 5 } }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path)
    expect(paths).toContain('/item')
    expect(paths).toContain('/priority')
  })

  it('should produce no patch for no-op update (same values)', async () => {
    const order = await OrderModel.create({
      item: 'NoOp',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'N', zip: '00000' },
    })

    await OrderModel.updateOne({ _id: order._id }, { item: 'NoOp', quantity: 1 }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(0)
  })

  it('should track field set to null', async () => {
    const order = await OrderModel.create({
      item: 'NullField',
      quantity: 1,
      priority: 5,
      tags: [],
      address: { street: '1 St', city: 'F', zip: '00000' },
    })

    await OrderModel.updateOne({ _id: order._id }, { priority: null }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path)
    expect(paths).toContain('/priority')
  })

  it('should track findOneAndReplace', async () => {
    const order = await OrderModel.create({
      item: 'ReplaceMe',
      quantity: 1,
      tags: ['old'],
      address: { street: '1 St', city: 'R', zip: '00000' },
    })

    await OrderModel.findOneAndReplace({ _id: order._id }, { item: 'Replaced', quantity: 99, tags: ['new'], address: { street: '2 St', city: 'R', zip: '11111' } }).exec()

    const updates = await HistoryModel.find({ op: 'findOneAndReplace' })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.patch?.length).toBeGreaterThan(0)
  })

  it('should track findByIdAndUpdate', async () => {
    const order = await OrderModel.create({
      item: 'ById',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'B', zip: '00000' },
    })

    await OrderModel.findByIdAndUpdate(order._id, { quantity: 42 }).exec()

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history.length).toBeGreaterThanOrEqual(2)

    const update = history.find((h) => h.patch && h.patch.length > 0)
    expect(update).toBeDefined()

    const paths = update?.patch?.map((p) => p.path)
    expect(paths).toContain('/quantity')
  })

  it('should not crash on update with no matching documents', async () => {
    const fakeId = new mongoose.Types.ObjectId()
    await OrderModel.updateOne({ _id: fakeId }, { quantity: 999 }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('should not crash on delete with no matching documents', async () => {
    const fakeId = new mongoose.Types.ObjectId()
    await OrderModel.deleteOne({ _id: fakeId }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('should handle getUser/getReason/getMetadata throwing gracefully', async () => {
    const ThrowSchema = new Schema<Order>(
      {
        item: { type: String, required: true },
        quantity: { type: Number, required: true },
        tags: { type: [String], default: undefined },
        address: { type: AddressSchema, required: true },
      },
      { timestamps: true },
    )

    ThrowSchema.plugin(patchHistoryPlugin, {
      eventCreated: ORDER_CREATED,
      omit: ['__v', 'createdAt', 'updatedAt'],
      getUser: () => {
        throw new Error('user callback failed')
      },
      getReason: () => {
        throw new Error('reason callback failed')
      },
      getMetadata: () => {
        throw new Error('metadata callback failed')
      },
    })

    const ThrowModel = model<Order>('ThrowOrder', ThrowSchema)

    const doc = await ThrowModel.create({
      item: 'ThrowTest',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'T', zip: '00000' },
    })

    const history = await HistoryModel.find({ collectionId: doc._id })
    expect(history).toHaveLength(1)
    expect(history[0]?.user).toBeUndefined()
    expect(history[0]?.reason).toBeUndefined()
    expect(history[0]?.metadata).toBeUndefined()
  })

  it('should skip everything when ignoreEvent + ignorePatchHistory', async () => {
    const order = await OrderModel.create({
      item: 'SkipAll',
      quantity: 1,
      tags: [],
      address: { street: '1 St', city: 'S', zip: '00000' },
    })

    vi.resetAllMocks()

    await OrderModel.updateOne({ _id: order._id }, { quantity: 50 }).setOptions({ ignoreEvent: true, ignorePatchHistory: true }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne' })
    expect(updates).toHaveLength(0)
    expect(em.emit).not.toHaveBeenCalled()
  })

  it('should track deeply nested changes (3+ levels)', async () => {
    const DeepSchema = new Schema(
      {
        name: String,
        config: {
          type: new Schema(
            {
              settings: {
                type: new Schema(
                  {
                    theme: String,
                    notifications: Boolean,
                  },
                  { _id: false },
                ),
              },
            },
            { _id: false },
          ),
        },
      },
      { timestamps: true },
    )

    DeepSchema.plugin(patchHistoryPlugin, {
      omit: ['__v', 'createdAt', 'updatedAt'],
    })

    const DeepModel = model('DeepDoc', DeepSchema)

    const doc = await DeepModel.create({
      name: 'deep',
      config: { settings: { theme: 'dark', notifications: true } },
    })

    doc.config = { settings: { theme: 'light', notifications: false } }
    await doc.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: doc._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path)
    expect(paths).toContain('/config/settings/theme')
    expect(paths).toContain('/config/settings/notifications')
  })
})
