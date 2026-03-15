import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import server from './mongo/server'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

// --- Realistic e-commerce schema ---

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

interface Money {
  amount: number
  currency: string
}

interface LineItem {
  productId: mongoose.Types.ObjectId
  sku: string
  name: string
  quantity: number
  price: Money
  discount?: Money
  tags?: string[]
  metadata?: Record<string, unknown>
}

interface Address {
  label?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  coords?: { lat: number; lng: number }
}

interface Payment {
  method?: string
  last4?: string
  transactionId?: string
  paidAt?: Date
}

interface EcomOrder {
  orderNumber: string
  customerId: mongoose.Types.ObjectId
  status: string
  items: LineItem[]
  shippingAddress: Address
  billingAddress: Address
  payment: Payment
  totals: { subtotal: Money; tax: Money; shipping: Money; total: Money }
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
    totals: { subtotal: MoneySchema, tax: MoneySchema, shipping: MoneySchema, total: MoneySchema },
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

// --- Stable ObjectIds for cross-test reference ---

const productIds = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId())
const customerId = new mongoose.Types.ObjectId()
const agentIds = Array.from({ length: 3 }, () => new mongoose.Types.ObjectId())

const createOrder = () =>
  EcomOrderModel.create({
    orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    customerId,
    status: 'pending',
    items: [
      {
        productId: productIds[0],
        sku: 'WIDGET-001',
        name: 'Premium Widget',
        quantity: 2,
        price: { amount: 29.99, currency: 'USD' },
        discount: { amount: 5, currency: 'USD' },
        tags: ['electronics', 'sale'],
        metadata: { weight: 0.5, dimensions: { w: 10, h: 5, d: 3 } },
      },
      {
        productId: productIds[1],
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
    assignedTo: [agentIds[0]],
    priority: 2,
    tags: ['vip', 'express'],
  })

const getPatch = (entry: { patch?: { op: string; path: string; value?: unknown }[] } | undefined, path: string) => entry?.patch?.find((p) => p.path === path && p.op === 'replace')

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

  // --- Create ---

  it('should capture full document structure on create with correct omissions', async () => {
    const order = await createOrder()
    const [entry] = await HistoryModel.find({ collectionId: order._id })

    expect(entry?.op).toBe('create')
    expect(entry?.version).toBe(0)

    const doc = entry?.doc as Record<string, unknown>
    expect(doc.orderNumber).toBe(order.orderNumber)
    expect(doc.status).toBe('pending')
    expect(doc.priority).toBe(2)
    expect((doc.items as unknown[]).length).toBe(2)
    expect((doc.notes as string[]).length).toBe(2)
    expect((doc.tags as string[]).length).toBe(2)
    expect(doc.shippingAddress).toHaveProperty('coords')
    expect(doc.payment).toHaveProperty('method', 'card')
    expect(doc.totals).toHaveProperty('total')

    expect(doc).not.toHaveProperty('internalNotes')
    expect(doc).not.toHaveProperty('__v')
    expect(doc).not.toHaveProperty('createdAt')
    expect(doc).not.toHaveProperty('updatedAt')

    expect(entry?.user).toEqual({ userId: 'admin-123', role: 'admin' })
    expect(entry?.reason).toBe('system-action')
    expect(entry?.metadata).toEqual({ service: 'order-service', version: '2.0' })
  })

  // --- Nested subdocument updates ---

  it('should track address change with deep coords and capture exact patch values', async () => {
    const order = await createOrder()

    order.shippingAddress = {
      label: 'New Home',
      street: '789 Oak Rd',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
      country: 'US',
      coords: { lat: 45.5152, lng: -122.6784 },
    }
    await order.save()

    const [update] = await HistoryModel.find({ op: 'update', collectionId: order._id })
    const paths = update?.patch?.map((p) => p.path) ?? []

    expect(paths).toContain('/shippingAddress/label')
    expect(paths).toContain('/shippingAddress/street')
    expect(paths).toContain('/shippingAddress/city')
    expect(paths).toContain('/shippingAddress/coords/lat')
    expect(paths).toContain('/shippingAddress/coords/lng')

    expect(getPatch(update, '/shippingAddress/city')?.value).toBe('Portland')
  })

  it('should track payment completion with transactionId and paidAt date', async () => {
    const order = await createOrder()
    const paidAt = new Date('2026-03-15T10:00:00Z')

    await EcomOrderModel.updateOne({ _id: order._id }, { $set: { status: 'paid', payment: { method: 'card', last4: '4242', transactionId: 'txn_abc123', paidAt } } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    const paths = update?.patch?.map((p) => p.path) ?? []

    expect(paths.some((p) => p?.includes('/status'))).toBe(true)
    expect(paths.some((p) => p?.includes('/payment'))).toBe(true)
    expect(getPatch(update, '/status')?.value).toBe('paid')
  })

  // --- Array of subdocuments ---

  it('should track adding a line item via $push with nested Money schema', async () => {
    const order = await createOrder()

    await EcomOrderModel.updateOne(
      { _id: order._id },
      {
        $push: {
          items: {
            productId: productIds[2],
            sku: 'CABLE-003',
            name: 'USB-C Cable',
            quantity: 3,
            price: { amount: 9.99, currency: 'USD' },
            discount: { amount: 1, currency: 'USD' },
            tags: ['accessories', 'cables'],
            metadata: { color: 'black', length: '2m' },
          },
        },
      },
    ).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(update?.patch?.length).toBeGreaterThan(0)

    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/items'))).toBe(true)
  })

  it('should track removing a line item via save', async () => {
    const order = await createOrder()
    expect(order.items.length).toBe(2)

    order.items = [order.items[0]]
    await order.save()

    const [update] = await HistoryModel.find({ op: 'update', collectionId: order._id })
    expect(update?.patch?.length).toBeGreaterThan(0)

    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/items'))).toBe(true)
  })

  // --- Compound operations ---

  it('should track $set + $inc + $push in a single update', async () => {
    const order = await createOrder()

    await EcomOrderModel.updateOne(
      { _id: order._id },
      {
        $set: { status: 'processing' },
        $inc: { priority: 1 },
        $push: { tags: 'rush' },
      },
    ).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(update?.patch?.length).toBeGreaterThan(0)

    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/status'))).toBe(true)
    expect(paths.some((p) => p?.includes('/priority'))).toBe(true)
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  // --- ObjectId mutations ---

  it('should track adding and replacing ObjectId refs in assignedTo array', async () => {
    const order = await createOrder()

    await EcomOrderModel.updateOne({ _id: order._id }, { $push: { assignedTo: agentIds[1] } }).exec()

    const [push] = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(push?.patch?.some((p) => p.path.startsWith('/assignedTo'))).toBe(true)

    await EcomOrderModel.updateOne({ _id: order._id }, { assignedTo: [agentIds[2]] }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: order._id }).sort('createdAt')
    expect(updates).toHaveLength(2)
    expect(updates[1]?.patch?.some((p) => p.path.startsWith('/assignedTo'))).toBe(true)
  })

  it('should track changing customerId (ObjectId field replacement)', async () => {
    const order = await createOrder()
    const newCustomerId = new mongoose.Types.ObjectId()

    await EcomOrderModel.updateOne({ _id: order._id }, { $set: { customerId: newCustomerId } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    expect(update?.patch?.some((p) => p.path === '/customerId')).toBe(true)
  })

  // --- Money / totals ---

  it('should track totals recalculation with exact values', async () => {
    const order = await createOrder()

    await EcomOrderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          'totals.tax': { amount: 25.01, currency: 'USD' },
          'totals.shipping': { amount: 0, currency: 'USD' },
          'totals.total': { amount: 234.97, currency: 'USD' },
        },
      },
    ).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: order._id })
    const paths = update?.patch?.map((p) => p.path) ?? []

    expect(paths.some((p) => p?.includes('/totals/tax'))).toBe(true)
    expect(paths.some((p) => p?.includes('/totals/shipping'))).toBe(true)
    expect(paths.some((p) => p?.includes('/totals/total'))).toBe(true)
  })

  // --- Status workflow ---

  it('should track full order lifecycle with correct versions and ops', async () => {
    const order = await createOrder()

    for (const status of ['processing', 'shipped', 'delivered']) {
      await EcomOrderModel.updateOne({ _id: order._id }, { $set: { status } }).exec()
    }

    await EcomOrderModel.deleteOne({ _id: order._id }).exec()

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history).toHaveLength(5)

    expect(history[0]?.op).toBe('create')
    expect(history[0]?.version).toBe(0)

    expect(history[1]?.version).toBe(1)
    expect(getPatch(history[1], '/status')?.value).toBe('processing')

    expect(history[2]?.version).toBe(2)
    expect(getPatch(history[2], '/status')?.value).toBe('shipped')

    expect(history[3]?.version).toBe(3)
    expect(getPatch(history[3], '/status')?.value).toBe('delivered')

    expect(history[4]?.op).toBe('deleteOne')
    expect(history[4]?.doc).toHaveProperty('status', 'delivered')
    expect(history[4]?.doc).not.toHaveProperty('internalNotes')
  })

  // --- Omission across lifecycle ---

  it('should never leak omitted fields in any history entry type', async () => {
    const order = await createOrder()

    order.internalNotes = 'Escalated to manager'
    order.status = 'processing'
    await order.save()

    await EcomOrderModel.updateOne({ _id: order._id }, { $set: { internalNotes: 'Resolved', status: 'shipped' } }).exec()

    await EcomOrderModel.deleteOne({ _id: order._id }).exec()

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history.length).toBe(4)

    for (const entry of history) {
      if (entry.doc) {
        expect(entry.doc).not.toHaveProperty('internalNotes')
        expect(entry.doc).not.toHaveProperty('__v')
        expect(entry.doc).not.toHaveProperty('createdAt')
        expect(entry.doc).not.toHaveProperty('updatedAt')
      }
      if (entry.patch) {
        const paths = entry.patch.map((p) => p.path)
        expect(paths).not.toContain('/internalNotes')
        expect(paths).not.toContain('/__v')
        expect(paths).not.toContain('/createdAt')
        expect(paths).not.toContain('/updatedAt')
      }
    }
  })

  // --- Bulk ---

  it('should handle insertMany with varied complex documents', async () => {
    const orders = Array.from({ length: 5 }, (_, i) => ({
      orderNumber: `BULK-${Date.now()}-${i}`,
      customerId,
      status: i % 2 === 0 ? 'pending' : 'processing',
      items: [
        {
          productId: productIds[i % productIds.length],
          sku: `BULK-${i}`,
          name: `Bulk Item ${i}`,
          quantity: i + 1,
          price: { amount: 10.5 * (i + 1), currency: i % 2 === 0 ? 'USD' : 'EUR' },
          tags: [`batch-${i}`],
        },
      ],
      shippingAddress: { street: `${100 + i} Bulk St`, city: 'Bulk City', state: 'BC', zip: `${10000 + i}` },
      totals: {
        subtotal: { amount: 10.5 * (i + 1) },
        tax: { amount: 0.9 * (i + 1) },
        shipping: { amount: 5 },
        total: { amount: 10.5 * (i + 1) + 0.9 * (i + 1) + 5 },
      },
      priority: i,
    }))

    await EcomOrderModel.insertMany(orders)

    const history = await HistoryModel.find({ op: 'create' })
    expect(history).toHaveLength(5)

    for (const entry of history) {
      expect(entry.user).toEqual({ userId: 'admin-123', role: 'admin' })
      expect(entry.reason).toBe('system-action')
      expect(entry.metadata).toEqual({ service: 'order-service', version: '2.0' })
      expect(entry.doc).not.toHaveProperty('internalNotes')
    }
  })

  // --- updateMany ---

  it('should track updateMany across multiple complex documents', async () => {
    await createOrder()
    await createOrder()

    await EcomOrderModel.updateMany({ customerId }, { $set: { priority: 10 }, $push: { tags: 'bulk-updated' } }).exec()

    const updates = await HistoryModel.find({ op: 'updateMany' })
    expect(updates).toHaveLength(2)

    for (const entry of updates) {
      expect(entry.patch?.some((p) => p.path === '/priority')).toBe(true)
      expect(entry.patch?.some((p) => p.path.startsWith('/tags'))).toBe(true)
      expect(entry.user).toEqual({ userId: 'admin-123', role: 'admin' })
    }
  })

  // --- Delete ---

  it('should preserve complete document snapshot on delete with nested data intact', async () => {
    const order = await createOrder()

    await EcomOrderModel.deleteOne({ _id: order._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'deleteOne', collectionId: order._id })
    const doc = deletion?.doc as Record<string, unknown>

    expect(doc.orderNumber).toBe(order.orderNumber)
    expect(doc.status).toBe('pending')
    expect((doc.items as unknown[]).length).toBe(2)
    expect(doc.shippingAddress).toHaveProperty('coords')
    expect((doc.shippingAddress as Address).coords?.lat).toBe(39.7817)
    expect(doc.payment).toHaveProperty('last4', '4242')
    expect((doc.totals as Record<string, Money>).total.amount).toBe(238.86)
    expect((doc.assignedTo as string[]).length).toBe(1)
    expect(doc.tags as string[]).toEqual(expect.arrayContaining(['vip', 'express']))

    expect(doc).not.toHaveProperty('internalNotes')
    expect(doc).not.toHaveProperty('__v')
  })
})

// --- All mongoose schema types ---

const AllTypesSchema = new Schema(
  {
    str: String,
    num: Number,
    bool: Boolean,
    date: Date,
    objectId: Schema.Types.ObjectId,
    decimal: Schema.Types.Decimal128,
    uuid: Schema.Types.UUID,
    buf: Buffer,
    mixed: Schema.Types.Mixed,
    nested: { deep: { value: String } },
    map: { type: Map, of: String },
    arrStr: [String],
    arrNum: [Number],
    arrObjectId: [Schema.Types.ObjectId],
    arrNested: [new Schema({ label: String, score: Number }, { _id: false })],
  },
  { timestamps: true },
)

AllTypesSchema.plugin(patchHistoryPlugin, {
  omit: ['__v', 'createdAt', 'updatedAt'],
})

const AllTypesModel = model('AllTypes', AllTypesSchema)

describe('plugin — all mongoose schema types', () => {
  const instance = server('plugin-all-types')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('alltypes').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should create and track a document with every schema type', async () => {
    const refId = new mongoose.Types.ObjectId()
    const doc = await AllTypesModel.create({
      str: 'hello',
      num: 42,
      bool: true,
      date: new Date('2026-01-15'),
      objectId: refId,
      decimal: mongoose.Types.Decimal128.fromString('99.99'),
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      buf: Buffer.from('binary data'),
      mixed: { anything: [1, 'two', { three: true }] },
      nested: { deep: { value: 'found it' } },
      map: new Map([
        ['key1', 'val1'],
        ['key2', 'val2'],
      ]),
      arrStr: ['a', 'b', 'c'],
      arrNum: [1, 2, 3],
      arrObjectId: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
      arrNested: [
        { label: 'first', score: 10 },
        { label: 'second', score: 20 },
      ],
    })

    const [entry] = await HistoryModel.find({ collectionId: doc._id })
    expect(entry?.op).toBe('create')

    const saved = entry?.doc as Record<string, unknown>
    expect(saved.str).toBe('hello')
    expect(saved.num).toBe(42)
    expect(saved.bool).toBe(true)
    expect(saved.date).toBeDefined()
    expect(saved.objectId).toBeDefined()
    expect(saved.decimal).toBeDefined()
    expect(saved.uuid).toBeDefined()
    expect(saved.buf).toBeDefined()
    expect(saved.mixed).toHaveProperty('anything')
    expect(saved.nested).toEqual({ deep: { value: 'found it' } })
    expect(saved.map).toBeDefined()
    expect(saved.arrStr).toEqual(['a', 'b', 'c'])
    expect(saved.arrNum).toEqual([1, 2, 3])
    expect((saved.arrObjectId as unknown[]).length).toBe(2)
    expect((saved.arrNested as unknown[]).length).toBe(2)
  })

  it('should track String update', async () => {
    const doc = await AllTypesModel.create({ str: 'before' })
    await AllTypesModel.updateOne({ _id: doc._id }, { str: 'after' }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/str')?.value).toBe('after')
  })

  it('should track Number update', async () => {
    const doc = await AllTypesModel.create({ num: 1 })
    await AllTypesModel.updateOne({ _id: doc._id }, { num: 999 }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/num')?.value).toBe(999)
  })

  it('should track Boolean toggle', async () => {
    const doc = await AllTypesModel.create({ bool: false })
    await AllTypesModel.updateOne({ _id: doc._id }, { bool: true }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/bool')?.value).toBe(true)
  })

  it('should track Date update', async () => {
    const doc = await AllTypesModel.create({ date: new Date('2025-01-01') })
    await AllTypesModel.updateOne({ _id: doc._id }, { date: new Date('2026-06-15') }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/date')
  })

  it('should track ObjectId reference change', async () => {
    const id1 = new mongoose.Types.ObjectId()
    const id2 = new mongoose.Types.ObjectId()
    const doc = await AllTypesModel.create({ objectId: id1 })
    await AllTypesModel.updateOne({ _id: doc._id }, { objectId: id2 }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/objectId')).toBeDefined()
  })

  it('should track Decimal128 update', async () => {
    const doc = await AllTypesModel.create({ decimal: mongoose.Types.Decimal128.fromString('10.00') })
    await AllTypesModel.updateOne({ _id: doc._id }, { decimal: mongoose.Types.Decimal128.fromString('99.95') }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/decimal'))).toBe(true)
  })

  it('should track UUID update', async () => {
    const doc = await AllTypesModel.create({ uuid: '550e8400-e29b-41d4-a716-446655440000' })
    await AllTypesModel.updateOne({ _id: doc._id }, { uuid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/uuid')).toBeDefined()
  })

  it('should track Buffer update', async () => {
    const doc = await AllTypesModel.create({ buf: Buffer.from('old') })
    await AllTypesModel.updateOne({ _id: doc._id }, { buf: Buffer.from('new') }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/buf')).toBeDefined()
  })

  it('should track Mixed type update (arbitrary object)', async () => {
    const doc = await AllTypesModel.create({ mixed: { version: 1, data: [1, 2] } })
    await AllTypesModel.updateOne({ _id: doc._id }, { mixed: { version: 2, data: [1, 2, 3], extra: 'new' } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/mixed'))).toBe(true)
  })

  it('should track deeply nested field update', async () => {
    const doc = await AllTypesModel.create({ nested: { deep: { value: 'old' } } })
    doc.nested = { deep: { value: 'new' } }
    await doc.save()

    const [update] = await HistoryModel.find({ op: 'update', collectionId: doc._id })
    expect(getPatch(update, '/nested/deep/value')?.value).toBe('new')
  })

  it('should track Map field update via save', async () => {
    const doc = await AllTypesModel.create({ map: new Map([['a', '1']]) })
    doc.map = new Map([
      ['a', '1'],
      ['b', '2'],
    ])
    await doc.save()

    const [update] = await HistoryModel.find({ op: 'update', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/map'))).toBe(true)
  })

  it('should track array of strings mutation', async () => {
    const doc = await AllTypesModel.create({ arrStr: ['x', 'y'] })
    await AllTypesModel.updateOne({ _id: doc._id }, { arrStr: ['x', 'y', 'z'] }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/arrStr'))).toBe(true)
  })

  it('should track array of nested objects mutation', async () => {
    const doc = await AllTypesModel.create({ arrNested: [{ label: 'a', score: 1 }] })
    await AllTypesModel.updateOne(
      { _id: doc._id },
      {
        arrNested: [
          { label: 'a', score: 1 },
          { label: 'b', score: 2 },
        ],
      },
    ).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/arrNested'))).toBe(true)
  })

  it('should track setting a field from undefined to a value', async () => {
    const doc = await AllTypesModel.create({ str: 'exists' })
    await AllTypesModel.updateOne({ _id: doc._id }, { num: 42, bool: true, date: new Date() }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/num')
    expect(paths).toContain('/bool')
    expect(paths).toContain('/date')
  })

  it('should track setting a field to null', async () => {
    const doc = await AllTypesModel.create({ str: 'hello', num: 42 })
    await AllTypesModel.updateOne({ _id: doc._id }, { str: null, num: null }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/str')
    expect(paths).toContain('/num')
  })
})

// --- Populated documents ---

const AuthorSchema = new Schema({ name: String, email: String }, { timestamps: true })
AuthorSchema.plugin(patchHistoryPlugin, { omit: ['__v', 'createdAt', 'updatedAt'] })
const AuthorModel = model('Author', AuthorSchema)

const ArticleSchema = new Schema(
  {
    title: String,
    body: String,
    author: { type: Schema.Types.ObjectId, ref: 'Author' },
    reviewers: [{ type: Schema.Types.ObjectId, ref: 'Author' }],
  },
  { timestamps: true },
)
ArticleSchema.plugin(patchHistoryPlugin, { omit: ['__v', 'createdAt', 'updatedAt'] })
const ArticleModel = model('Article', ArticleSchema)

describe('plugin — populated documents', () => {
  const instance = server('plugin-populated')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('authors').deleteMany({})
    await mongoose.connection.collection('articles').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should store ObjectId refs not populated objects in history', async () => {
    const author = await AuthorModel.create({ name: 'Jane', email: 'jane@example.com' })
    const article = await ArticleModel.create({ title: 'Test', body: 'Content', author: author._id })

    const [entry] = await HistoryModel.find({ collectionId: article._id })
    const doc = entry?.doc as Record<string, unknown>

    expect(doc.author).toBeDefined()
    expect(JSON.stringify(doc.author)).toContain(author._id.toString())
  })

  it('should track author ref change as ObjectId diff', async () => {
    const author1 = await AuthorModel.create({ name: 'Jane', email: 'jane@example.com' })
    const author2 = await AuthorModel.create({ name: 'John', email: 'john@example.com' })
    const article = await ArticleModel.create({ title: 'Test', body: 'Content', author: author1._id })

    await ArticleModel.updateOne({ _id: article._id }, { author: author2._id }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: article._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/author')
  })

  it('should track changes to populated array refs', async () => {
    const reviewer1 = await AuthorModel.create({ name: 'R1', email: 'r1@example.com' })
    const reviewer2 = await AuthorModel.create({ name: 'R2', email: 'r2@example.com' })
    const article = await ArticleModel.create({ title: 'Reviewed', body: 'Content', reviewers: [reviewer1._id] })

    await ArticleModel.updateOne({ _id: article._id }, { $push: { reviewers: reviewer2._id } }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: article._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/reviewers'))).toBe(true)
  })
})

// --- Discriminators ---

const BaseEventSchema = new Schema({ timestamp: { type: Date, default: Date.now }, source: String }, { timestamps: true, discriminatorKey: 'kind' })
BaseEventSchema.plugin(patchHistoryPlugin, { omit: ['__v', 'createdAt', 'updatedAt'] })
const BaseEventModel = model('BaseEvent', BaseEventSchema)

const ClickEventModel = BaseEventModel.discriminator('ClickEvent', new Schema({ url: String, buttonId: String }))
const SignupEventModel = BaseEventModel.discriminator('SignupEvent', new Schema({ username: String, plan: String }))

describe('plugin — discriminators', () => {
  const instance = server('plugin-discriminators')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('baseevents').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should create history for discriminator with type-specific fields', async () => {
    const click = await ClickEventModel.create({ source: 'web', url: 'https://example.com', buttonId: 'cta-1' })

    const [entry] = await HistoryModel.find({ collectionId: click._id })
    const doc = entry?.doc as Record<string, unknown>

    expect(doc.kind).toBe('ClickEvent')
    expect(doc.url).toBe('https://example.com')
    expect(doc.buttonId).toBe('cta-1')
    expect(doc.source).toBe('web')
  })

  it('should track updates to discriminator-specific fields', async () => {
    const click = await ClickEventModel.create({ source: 'web', url: 'https://old.com', buttonId: 'btn-1' })

    await ClickEventModel.updateOne({ _id: click._id }, { url: 'https://new.com' }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: click._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/url')
  })

  it('should track different discriminator types independently', async () => {
    const click = await ClickEventModel.create({ source: 'web', url: 'https://example.com' })
    const signup = await SignupEventModel.create({ source: 'app', username: 'newuser', plan: 'free' })

    await SignupEventModel.updateOne({ _id: signup._id }, { plan: 'pro' }).exec()

    const clickHistory = await HistoryModel.find({ collectionId: click._id })
    const signupHistory = await HistoryModel.find({ collectionId: signup._id }).sort('createdAt')

    expect(clickHistory).toHaveLength(1)
    expect(clickHistory[0]?.op).toBe('create')

    expect(signupHistory).toHaveLength(2)
    expect(signupHistory[1]?.patch?.some((p) => p.path === '/plan')).toBe(true)
  })

  it('should delete discriminator and preserve type in history', async () => {
    const signup = await SignupEventModel.create({ source: 'app', username: 'todelete', plan: 'trial' })

    await SignupEventModel.deleteOne({ _id: signup._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'deleteOne', collectionId: signup._id })
    const doc = deletion?.doc as Record<string, unknown>

    expect(doc.kind).toBe('SignupEvent')
    expect(doc.username).toBe('todelete')
    expect(doc.plan).toBe('trial')
  })
})

// --- Subdocument manipulation ---

const CommentSchema = new Schema({ text: String, rating: Number }, { timestamps: false })

const PostSchema = new Schema(
  {
    title: String,
    comments: [CommentSchema],
    featured: { type: CommentSchema, default: undefined },
  },
  { timestamps: true },
)
PostSchema.plugin(patchHistoryPlugin, { omit: ['__v', 'createdAt', 'updatedAt'] })
const PostModel = model('Post', PostSchema)

describe('plugin — subdocument manipulation', () => {
  const instance = server('plugin-subdocs')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('posts').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should track pushing subdoc via mongoose array push then save', async () => {
    const post = await PostModel.create({ title: 'Hello', comments: [{ text: 'First', rating: 5 }] })

    post.comments.push({ text: 'Second', rating: 3 } as never)
    await post.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: post._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/comments'))).toBe(true)
  })

  it('should track removing subdoc from array then save', async () => {
    const post = await PostModel.create({
      title: 'Hello',
      comments: [
        { text: 'A', rating: 1 },
        { text: 'B', rating: 2 },
      ],
    })

    post.comments.splice(0, 1)
    await post.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: post._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/comments'))).toBe(true)
  })

  it('should track modifying a subdoc field then saving parent', async () => {
    const post = await PostModel.create({ title: 'Hello', comments: [{ text: 'Original', rating: 5 }] })

    post.comments[0].text = 'Edited'
    await post.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: post._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/comments') && p?.includes('/text'))).toBe(true)
  })

  it('should track setting single nested subdoc', async () => {
    const post = await PostModel.create({ title: 'Hello', comments: [] })

    post.featured = { text: 'Featured comment', rating: 10 } as never
    await post.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: post._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/featured'))).toBe(true)
  })
})

// --- Virtuals, getters, validation ---

const ProfileSchema = new Schema(
  {
    firstName: String,
    lastName: String,
    email: {
      type: String,
      get: (v: string) => v?.toLowerCase(),
      required: true,
    },
    age: { type: Number, min: 0, max: 150 },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: false } },
)

ProfileSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`
})

ProfileSchema.plugin(patchHistoryPlugin, { omit: ['__v', 'createdAt', 'updatedAt'] })
const ProfileModel = model('Profile', ProfileSchema)

describe('plugin — virtuals, getters, validation', () => {
  const instance = server('plugin-virtuals')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('profiles').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should NOT include virtual fields in history', async () => {
    const profile = await ProfileModel.create({ firstName: 'Jane', lastName: 'Doe', email: 'Jane@Example.COM' })

    const [entry] = await HistoryModel.find({ collectionId: profile._id })
    const doc = entry?.doc as Record<string, unknown>

    expect(doc).not.toHaveProperty('fullName')
    expect(doc.firstName).toBe('Jane')
    expect(doc.lastName).toBe('Doe')
  })

  it('should store raw email value not getter-transformed in history', async () => {
    const profile = await ProfileModel.create({ firstName: 'Jane', lastName: 'Doe', email: 'Jane@Example.COM' })

    const [entry] = await HistoryModel.find({ collectionId: profile._id })
    const doc = entry?.doc as Record<string, unknown>

    expect(doc.email).toBe('Jane@Example.COM')
  })

  it('should NOT create history when validation fails', async () => {
    try {
      await ProfileModel.create({ firstName: 'Bad', lastName: 'User' })
    } catch {
      // expected — email is required
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('should NOT create update history when validation fails on save', async () => {
    const profile = await ProfileModel.create({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' })

    const historyBefore = await HistoryModel.find({})
    expect(historyBefore).toHaveLength(1)

    profile.age = -5
    try {
      await profile.save()
    } catch {
      // expected — age min 0
    }

    const historyAfter = await HistoryModel.find({})
    expect(historyAfter).toHaveLength(1)
  })
})

// --- Concurrent updates & large batch ---

describe('plugin — concurrent updates', () => {
  const instance = server('plugin-concurrent')

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

  it('should handle sequential rapid updates with correct versions', async () => {
    const order = await EcomOrderModel.create({
      orderNumber: `CONCURRENT-${Date.now()}`,
      customerId,
      items: [{ productId: productIds[0], sku: 'C-1', name: 'Item', quantity: 1, price: { amount: 10 } }],
      shippingAddress: { street: '1 St', city: 'C', zip: '00000' },
      totals: { subtotal: { amount: 10 }, tax: { amount: 1 }, shipping: { amount: 5 }, total: { amount: 16 } },
    })

    for (let i = 1; i <= 5; i++) {
      await EcomOrderModel.updateOne({ _id: order._id }, { $set: { priority: i } }).exec()
    }

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history).toHaveLength(6)

    for (let i = 1; i <= 5; i++) {
      expect(history[i]?.version).toBe(i)
    }
  })

  it('should handle deleteMany with preDelete on 15 documents', async () => {
    const orders = Array.from({ length: 15 }, (_, i) => ({
      orderNumber: `BATCH-DEL-${Date.now()}-${i}`,
      customerId,
      tags: ['batch-delete'],
      items: [{ productId: productIds[0], sku: `BD-${i}`, name: `Batch ${i}`, quantity: 1, price: { amount: 5 } }],
      shippingAddress: { street: `${i} St`, city: 'BD', zip: '00000' },
      totals: { subtotal: { amount: 5 }, tax: { amount: 0 }, shipping: { amount: 0 }, total: { amount: 5 } },
    }))

    await EcomOrderModel.insertMany(orders)

    const createHistory = await HistoryModel.find({ op: 'create' })
    expect(createHistory).toHaveLength(15)

    await EcomOrderModel.deleteMany({ tags: 'batch-delete' }).exec()

    const deleteHistory = await HistoryModel.find({ op: 'deleteMany' })
    expect(deleteHistory).toHaveLength(15)

    for (const entry of deleteHistory) {
      expect(entry.doc).toHaveProperty('orderNumber')
      expect(entry.doc).not.toHaveProperty('internalNotes')
    }
  })
})

// --- Additional delete operations ---

describe('plugin — findOneAndDelete / findByIdAndDelete', () => {
  const instance = server('plugin-deletes')

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

  it('should track findOneAndDelete with full document snapshot', async () => {
    const order = await EcomOrderModel.create({
      orderNumber: `FOAD-${Date.now()}`,
      customerId,
      items: [{ productId: productIds[0], sku: 'FOAD-1', name: 'FindAndDel', quantity: 1, price: { amount: 25 } }],
      shippingAddress: { street: '1 St', city: 'FD', zip: '00000' },
      totals: { subtotal: { amount: 25 }, tax: { amount: 2 }, shipping: { amount: 5 }, total: { amount: 32 } },
      tags: ['findAndDelete'],
    })

    await EcomOrderModel.findOneAndDelete({ _id: order._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'findOneAndDelete', collectionId: order._id })
    expect(deletion).toBeDefined()
    expect(deletion?.doc).toHaveProperty('orderNumber')
    expect(deletion?.doc).toHaveProperty('items')
    expect(deletion?.doc).not.toHaveProperty('internalNotes')
  })

  it('should track findByIdAndDelete with full document snapshot', async () => {
    const order = await EcomOrderModel.create({
      orderNumber: `FBAD-${Date.now()}`,
      customerId,
      items: [{ productId: productIds[0], sku: 'FBAD-1', name: 'ByIdDel', quantity: 1, price: { amount: 15 } }],
      shippingAddress: { street: '2 St', city: 'BD', zip: '00000' },
      totals: { subtotal: { amount: 15 }, tax: { amount: 1 }, shipping: { amount: 3 }, total: { amount: 19 } },
    })

    await EcomOrderModel.findByIdAndDelete(order._id).exec()

    const history = await HistoryModel.find({ collectionId: order._id }).sort('createdAt')
    expect(history.length).toBeGreaterThanOrEqual(2)

    const deletion = history.find((h) => h.op.includes('delete') || h.op.includes('Delete'))
    expect(deletion).toBeDefined()
    expect(deletion?.doc).toHaveProperty('orderNumber')
  })
})

// --- replaceOne ---

describe('plugin — replaceOne', () => {
  const instance = server('plugin-replace')

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

  it('should track replaceOne with full document replacement', async () => {
    const order = await EcomOrderModel.create({
      orderNumber: `REPLACE-${Date.now()}`,
      customerId,
      status: 'pending',
      items: [{ productId: productIds[0], sku: 'OLD-1', name: 'Old Item', quantity: 1, price: { amount: 10 } }],
      shippingAddress: { street: '1 Old St', city: 'OldCity', zip: '00000' },
      totals: { subtotal: { amount: 10 }, tax: { amount: 1 }, shipping: { amount: 2 }, total: { amount: 13 } },
      tags: ['original'],
    })

    await EcomOrderModel.replaceOne(
      { _id: order._id },
      {
        orderNumber: order.orderNumber,
        customerId,
        status: 'replaced',
        items: [{ productId: productIds[1], sku: 'NEW-1', name: 'New Item', quantity: 5, price: { amount: 99 } }],
        shippingAddress: { street: '2 New St', city: 'NewCity', zip: '11111' },
        totals: { subtotal: { amount: 99 }, tax: { amount: 9 }, shipping: { amount: 0 }, total: { amount: 108 } },
        tags: ['replaced'],
      },
    ).exec()

    const updates = await HistoryModel.find({ op: 'replaceOne', collectionId: order._id })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.patch?.length).toBeGreaterThan(0)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/status'))).toBe(true)
    expect(paths.some((p) => p?.includes('/items'))).toBe(true)
    expect(paths.some((p) => p?.includes('/shippingAddress'))).toBe(true)
  })
})
