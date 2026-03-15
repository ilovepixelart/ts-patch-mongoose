import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

const MoneySchema = new Schema({ amount: Number, currency: { type: String, default: 'USD' } }, { _id: false })

const LineItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: MoneySchema, required: true },
    discount: { type: MoneySchema },
    tags: [String],
    metadata: { type: Schema.Types.Mixed },
  },
  { _id: true },
)

const AddressSchema = new Schema(
  {
    label: String,
    street: String,
    city: String,
    state: String,
    zip: String,
    country: { type: String, default: 'US' },
    coords: { lat: Number, lng: Number },
  },
  { _id: false },
)

const PaymentSchema = new Schema(
  {
    method: { type: String, enum: ['card', 'paypal', 'crypto', 'bank'] },
    last4: String,
    transactionId: String,
    paidAt: Date,
  },
  { _id: false },
)

interface EcomOrder {
  orderNumber: string
  customerId: mongoose.Types.ObjectId
  status: string
  items: (typeof LineItemSchema)[]
  shippingAddress: (typeof AddressSchema)
  billingAddress: (typeof AddressSchema)
  payment: (typeof PaymentSchema)
  totals: {
    subtotal: { amount: number; currency: string }
    tax: { amount: number; currency: string }
    shipping: { amount: number; currency: string }
    total: { amount: number; currency: string }
  }
  notes: string[]
  internalNotes: string
  assignedTo: mongoose.Types.ObjectId[]
  priority: number
  tags: string[]
  createdAt?: Date
  updatedAt?: Date
}

const EcomOrderSchema = new Schema<EcomOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, default: 'pending' },
    items: [LineItemSchema],
    shippingAddress: AddressSchema,
    billingAddress: AddressSchema,
    payment: PaymentSchema,
    totals: {
      subtotal: MoneySchema,
      tax: MoneySchema,
      shipping: MoneySchema,
      total: MoneySchema,
    },
    notes: [String],
    internalNotes: String,
    assignedTo: [{ type: Schema.Types.ObjectId }],
    priority: { type: Number, default: 0 },
    tags: [String],
  },
  { timestamps: true },
)

EcomOrderSchema.plugin(patchHistoryPlugin, {
  eventCreated: 'order-created',
  eventUpdated: 'order-updated',
  eventDeleted: 'order-deleted',
  omit: ['__v', 'createdAt', 'updatedAt', 'internalNotes'],
  getUser: () => ({ userId: 'admin-123', role: 'admin' }),
  getReason: () => 'system-action',
  getMetadata: () => ({ service: 'order-service', version: '2.0' }),
})

const EcomOrderModel = model<EcomOrder>('EcomOrder', EcomOrderSchema)

const productId1 = new mongoose.Types.ObjectId()
const productId2 = new mongoose.Types.ObjectId()
const productId3 = new mongoose.Types.ObjectId()
const customerId = new mongoose.Types.ObjectId()
const agentId1 = new mongoose.Types.ObjectId()
const agentId2 = new mongoose.Types.ObjectId()

const createRealisticOrder = () =>
  EcomOrderModel.create({
    orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    customerId,
    status: 'pending',
    items: [
      {
        productId: productId1,
        sku: 'WIDGET-001',
        name: 'Premium Widget',
        quantity: 2,
        price: { amount: 29.99, currency: 'USD' },
        discount: { amount: 5, currency: 'USD' },
        tags: ['electronics', 'sale'],
        metadata: { weight: 0.5, dimensions: { w: 10, h: 5, d: 3 } },
      },
      {
        productId: productId2,
        sku: 'GADGET-002',
        name: 'Super Gadget',
        quantity: 1,
        price: { amount: 149.99, currency: 'USD' },
        tags: ['electronics'],
        metadata: { weight: 1.2 },
      },
    ],
    shippingAddress: {
      label: 'Home',
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
      country: 'US',
      coords: { lat: 39.7817, lng: -89.6501 },
    },
    billingAddress: {
      label: 'Office',
      street: '456 Corp Ave',
      city: 'Chicago',
      state: 'IL',
      zip: '60601',
      country: 'US',
    },
    payment: { method: 'card', last4: '4242' },
    totals: {
      subtotal: { amount: 209.97, currency: 'USD' },
      tax: { amount: 18.9, currency: 'USD' },
      shipping: { amount: 9.99, currency: 'USD' },
      total: { amount: 238.86, currency: 'USD' },
    },
    notes: ['Gift wrap requested', 'Leave at door'],
    internalNotes: 'VIP customer',
    assignedTo: [agentId1],
    priority: 2,
    tags: ['vip', 'express'],
  })

describe('plugin — complex data structures', () => {
  const instance = server('plugin-complex-data')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('ecomorders').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should create history for complex document with nested schemas, arrays of objects, and ObjectId refs', async () => {
    const order = await createRealisticOrder()

    const history = await HistoryModel.find({ collectionId: order._id })
    expect(history).toHaveLength(1)

    const entry = history[0]
    expect(entry?.op).toBe('create')
    expect(entry?.doc).toHaveProperty('orderNumber')
    expect(entry?.doc).toHaveProperty('items')
    expect(entry?.doc).toHaveProperty('shippingAddress')
    expect(entry?.doc).toHaveProperty('totals')
    expect(entry?.doc).not.toHaveProperty('internalNotes')
    expect(entry?.doc).not.toHaveProperty('__v')
    expect(entry?.user).toEqual({ userId: 'admin-123', role: 'admin' })
    expect(entry?.reason).toBe('system-action')
  })

  it('should track adding a new line item via $push', async () => {
    const order = await createRealisticOrder()

    await EcomOrderModel.updateOne(
      { _id: order._id },
      {
        $push: {
          items: {
            productId: productId3,
            sku: 'CABLE-003',
            name: 'USB Cable',
            quantity: 3,
            price: { amount: 9.99, currency: 'USD' },
            tags: ['accessories'],
          },
        },
      },
    ).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/items'))).toBe(true)
  })

  it('should track nested address change with coords update', async () => {
    const order = await createRealisticOrder()

    order.shippingAddress = {
      ...order.toObject().shippingAddress,
      coords: { lat: 40.7128, lng: -74.006 },
      city: 'New York',
      state: 'NY',
      zip: '10001',
    }
    await order.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: order._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/shippingAddress'))).toBe(true)
  })

  it('should track payment and status update together via $set', async () => {
    const order = await createRealisticOrder()

    await EcomOrderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          status: 'paid',
          payment: { method: 'card', last4: '4242', transactionId: 'txn_abc123', paidAt: new Date('2026-03-15') },
        },
      },
    ).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/status'))).toBe(true)
    expect(paths.some((p) => p?.includes('/payment'))).toBe(true)
  })

  it('should track ObjectId array changes (assignedTo agents)', async () => {
    const order = await createRealisticOrder()

    await EcomOrderModel.updateOne({ _id: order._id }, { $push: { assignedTo: agentId2 } }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/assignedTo'))).toBe(true)
  })

  it('should track nested money object updates (totals recalculation)', async () => {
    const order = await createRealisticOrder()

    await EcomOrderModel.updateOne(
      { _id: order._id },
      { $set: { 'totals.tax': { amount: 21.5, currency: 'USD' }, 'totals.total': { amount: 241.46, currency: 'USD' } } },
    ).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/totals'))).toBe(true)
  })

  it('should track string array mutations (notes)', async () => {
    const order = await createRealisticOrder()

    order.notes = ['Leave at door', 'Call on arrival']
    await order.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: order._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/notes'))).toBe(true)
  })

  it('should track $addToSet on tags', async () => {
    const order = await createRealisticOrder()

    await EcomOrderModel.updateOne({ _id: order._id }, { $addToSet: { tags: 'fragile' } }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('should track full status workflow with versioning', async () => {
    const order = await createRealisticOrder()

    for (const status of ['processing', 'shipped', 'delivered']) {
      await EcomOrderModel.updateOne({ _id: order._id }, { $set: { status } }).exec()
    }

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history).toHaveLength(4)

    expect(history[0]?.op).toBe('create')
    expect(history[1]?.patch).toMatchObject(expect.arrayContaining([expect.objectContaining({ path: '/status', value: 'processing' })]))
    expect(history[2]?.patch).toMatchObject(expect.arrayContaining([expect.objectContaining({ path: '/status', value: 'shipped' })]))
    expect(history[3]?.patch).toMatchObject(expect.arrayContaining([expect.objectContaining({ path: '/status', value: 'delivered' })]))
    expect(history[1]?.version).toBe(1)
    expect(history[2]?.version).toBe(2)
    expect(history[3]?.version).toBe(3)
  })

  it('should omit internalNotes from all history entries across full lifecycle', async () => {
    const order = await createRealisticOrder()

    order.internalNotes = 'Updated internal note'
    order.status = 'processing'
    await order.save()

    await EcomOrderModel.deleteOne({ _id: order._id }).exec()

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history.length).toBeGreaterThanOrEqual(2)

    for (const entry of history) {
      if (entry.doc) {
        expect(entry.doc).not.toHaveProperty('internalNotes')
        expect(entry.doc).not.toHaveProperty('__v')
      }
    }
  })

  it('should handle bulk order creation via insertMany', async () => {
    const orders = Array.from({ length: 5 }, (_, i) => ({
      orderNumber: `BULK-${Date.now()}-${i}`,
      customerId,
      items: [{ productId: productId1, sku: `ITEM-${i}`, name: `Bulk Item ${i}`, quantity: i + 1, price: { amount: 10 * (i + 1) } }],
      shippingAddress: { street: `${i} St`, city: 'Bulk City', state: 'BC', zip: '00000' },
      totals: { subtotal: { amount: 10 * (i + 1) }, tax: { amount: 0 }, shipping: { amount: 0 }, total: { amount: 10 * (i + 1) } },
    }))

    await EcomOrderModel.insertMany(orders)

    const history = await HistoryModel.find({ op: 'create' })
    expect(history).toHaveLength(5)

    for (const entry of history) {
      expect(entry.user).toEqual({ userId: 'admin-123', role: 'admin' })
      expect(entry.reason).toBe('system-action')
    }
  })

  it('should preserve full document on delete (minus omitted fields)', async () => {
    const order = await createRealisticOrder()

    await EcomOrderModel.deleteOne({ _id: order._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'deleteOne', collectionId: order._id })
    expect(deletion).toBeDefined()
    expect(deletion?.doc).toHaveProperty('orderNumber')
    expect(deletion?.doc).toHaveProperty('items')
    expect(deletion?.doc).toHaveProperty('shippingAddress')
    expect(deletion?.doc).toHaveProperty('payment')
    expect(deletion?.doc).toHaveProperty('totals')
    expect(deletion?.doc).not.toHaveProperty('internalNotes')
    expect(deletion?.doc).not.toHaveProperty('__v')
    expect(deletion?.doc).not.toHaveProperty('createdAt')
  })
})
