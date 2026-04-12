import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model, Schema } from 'mongoose'
import em from '../src/em'
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

const getPatch = (entry: { patch?: { op: string; path: string; value?: unknown }[] } | null | undefined, path: string) => entry?.patch?.find((p) => p.path === path && p.op === 'replace')

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

const hasDouble = 'Double' in Schema.Types
const hasInt32 = 'Int32' in Schema.Types
const hasBigInt = 'BigInt' in Schema.Types

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

const SchemaTypes = Schema.Types as unknown as Record<string, never>
if (hasDouble) AllTypesSchema.add({ dbl: SchemaTypes.Double })
if (hasInt32) AllTypesSchema.add({ int32: SchemaTypes.Int32 })
if (hasBigInt) AllTypesSchema.add({ bigint: SchemaTypes.BigInt })

// --- Realistic SaaS Organization model (e2e) ---

const ContactSchema = new Schema(
  {
    email: { type: String, required: true },
    phone: String,
    website: String,
  },
  { _id: false },
)

const BillingSchema = new Schema(
  {
    plan: { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
    mrr: Schema.Types.Decimal128,
    currency: { type: String, default: 'USD' },
    cardLast4: String,
    nextBillingDate: Date,
  },
  { _id: false },
)

const TeamMemberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['owner', 'admin', 'member', 'viewer'], required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: true },
)

const HeadquartersSchema = new Schema(
  {
    street: String,
    city: String,
    state: String,
    zip: String,
    country: { type: String, default: 'US' },
    coords: { lat: Number, lng: Number },
    timezone: String,
  },
  { _id: false },
)

interface Contact {
  email: string
  phone?: string
  website?: string
}

interface Billing {
  plan: string
  mrr?: mongoose.Types.Decimal128
  currency: string
  cardLast4?: string
  nextBillingDate?: Date
}

interface TeamMember {
  userId: mongoose.Types.ObjectId
  role: string
  joinedAt?: Date
}

interface Headquarters {
  street?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  coords?: { lat: number; lng: number }
  timezone?: string
}

interface Organization {
  name: string
  slug: string
  externalId: mongoose.Types.UUID
  active: boolean
  contact: Contact
  billing: Billing
  headquarters: Headquarters
  team: TeamMember[]
  tags: string[]
  domains: string[]
  settings: Map<string, string>
  featureFlags: Record<string, unknown>
  logo?: Buffer
  notes: string
  seatCount: number
  createdAt?: Date
  updatedAt?: Date
}

const OrganizationSchema = new Schema<Organization>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    externalId: { type: Schema.Types.UUID, required: true },
    active: { type: Boolean, default: true },
    contact: { type: ContactSchema, required: true },
    billing: { type: BillingSchema, default: () => ({}) },
    headquarters: HeadquartersSchema,
    team: [TeamMemberSchema],
    tags: [String],
    domains: [String],
    settings: { type: Map, of: String },
    featureFlags: { type: Schema.Types.Mixed, default: {} },
    logo: Buffer,
    notes: String,
    seatCount: { type: Number, default: 1 },
  },
  { timestamps: true },
)

const ORG_CREATED = 'org-created'
const ORG_UPDATED = 'org-updated'
const ORG_DELETED = 'org-deleted'

OrganizationSchema.plugin(patchHistoryPlugin, {
  eventCreated: ORG_CREATED,
  eventUpdated: ORG_UPDATED,
  eventDeleted: ORG_DELETED,
  omit: ['__v', 'createdAt', 'updatedAt', 'notes'],
  getUser: () => ({ userId: 'system', role: 'service-account' }),
  getReason: () => 'api-call',
  getMetadata: () => ({ service: 'org-service', requestId: 'req-123' }),
})

const OrganizationModel = model<Organization>('Organization', OrganizationSchema)

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

  it.runIf(hasDouble)('should track Double update', async () => {
    const doc = await AllTypesModel.create({ dbl: 3.14 } as Record<string, unknown>)
    await AllTypesModel.updateOne({ _id: doc._id }, { dbl: 2.71 }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/dbl')?.value).toBe(2.71)
  })

  it.runIf(hasInt32)('should track Int32 update', async () => {
    const doc = await AllTypesModel.create({ int32: 100 } as Record<string, unknown>)
    await AllTypesModel.updateOne({ _id: doc._id }, { int32: 200 }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    expect(getPatch(update, '/int32')?.value).toBe(200)
  })

  it.runIf(hasBigInt)('should track BigInt update', async () => {
    const doc = await AllTypesModel.create({ bigint: BigInt(1000) } as Record<string, unknown>)
    await AllTypesModel.updateOne({ _id: doc._id }, { bigint: BigInt(9999) }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: doc._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/bigint'))).toBe(true)
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

// --- Organization e2e lifecycle ---

describe('plugin — organization e2e lifecycle', () => {
  const instance = server('plugin-org-e2e')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('organizations').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const makeOrg = () => ({
    name: 'Acme Corp',
    slug: `acme-${Date.now()}`,
    externalId: '550e8400-e29b-41d4-a716-446655440000',
    active: true,
    contact: { email: 'admin@acme.com', phone: '+1-555-0100', website: 'https://acme.com' },
    billing: {
      plan: 'pro' as 'free' | 'starter' | 'pro' | 'enterprise',
      mrr: mongoose.Types.Decimal128.fromString('499.00'),
      currency: 'USD',
      cardLast4: '4242',
      nextBillingDate: new Date('2026-05-01'),
    },
    headquarters: {
      street: '100 Innovation Dr',
      city: 'San Francisco',
      state: 'CA',
      zip: '94105',
      country: 'US',
      coords: { lat: 37.7749, lng: -122.4194 },
      timezone: 'America/Los_Angeles',
    },
    team: [
      { userId: new mongoose.Types.ObjectId(), role: 'owner' },
      { userId: new mongoose.Types.ObjectId(), role: 'admin' },
      { userId: new mongoose.Types.ObjectId(), role: 'member' },
    ],
    tags: ['saas', 'enterprise', 'active'],
    domains: ['acme.com', 'acme.io'],
    settings: new Map([
      ['theme', 'dark'],
      ['locale', 'en-US'],
      ['notifications', 'enabled'],
    ]),
    featureFlags: { betaDashboard: true, newBilling: false, aiAssistant: { enabled: true, model: 'claude' } },
    logo: Buffer.from('fake-png-data'),
    notes: 'Internal: VIP customer, handle with care',
    seatCount: 25,
  })

  it('should create organization and record full history', async () => {
    const org = await OrganizationModel.create(makeOrg())

    const history = await HistoryModel.find({ collectionId: org._id })
    expect(history).toHaveLength(1)

    const [entry] = history
    expect(entry?.op).toBe('create')
    expect(entry?.version).toBe(0)

    const doc = entry?.doc as Record<string, unknown>
    expect(doc.name).toBe('Acme Corp')
    expect(doc.active).toBe(true)
    expect(doc.contact).toHaveProperty('email', 'admin@acme.com')
    expect(doc.billing).toHaveProperty('plan', 'pro')
    expect(doc.billing).toHaveProperty('cardLast4', '4242')
    expect(doc.headquarters).toHaveProperty('city', 'San Francisco')
    expect((doc.headquarters as Record<string, unknown>).coords).toHaveProperty('lat', 37.7749)
    expect((doc.team as unknown[]).length).toBe(3)
    expect(doc.tags).toEqual(['saas', 'enterprise', 'active'])
    expect(doc.domains).toEqual(['acme.com', 'acme.io'])
    expect(doc.settings).toBeDefined()
    expect(doc.featureFlags).toHaveProperty('betaDashboard', true)
    expect(doc.logo).toBeDefined()
    expect(doc.seatCount).toBe(25)
    expect(doc).not.toHaveProperty('notes')
    expect(doc).not.toHaveProperty('__v')
    expect(doc).not.toHaveProperty('createdAt')
  })

  it('should track billing plan upgrade via save', async () => {
    const org = await OrganizationModel.create(makeOrg())

    org.billing.plan = 'enterprise'
    org.billing.mrr = mongoose.Types.Decimal128.fromString('1299.00')
    org.seatCount = 100
    await org.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: org._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/billing'))).toBe(true)
    expect(paths).toContain('/seatCount')
  })

  it('should track team member changes via updateOne', async () => {
    const org = await OrganizationModel.create(makeOrg())
    const newMember = { userId: new mongoose.Types.ObjectId(), role: 'viewer' }

    await OrganizationModel.updateOne({ _id: org._id }, { $push: { team: newMember } }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/team'))).toBe(true)
  })

  it('should track featureFlags Mixed and settings Map changes', async () => {
    const org = await OrganizationModel.create(makeOrg())

    org.featureFlags = { betaDashboard: true, newBilling: true, aiAssistant: { enabled: true, model: 'opus' } }
    org.settings.set('theme', 'light')
    org.settings.set('newKey', 'newVal')
    await org.save()

    const updates = await HistoryModel.find({ op: 'update', collectionId: org._id })
    expect(updates).toHaveLength(1)

    const paths = (updates[0]?.patch ?? []).map((p) => p.path ?? '')
    expect(paths.some((p) => p.includes('featureFlags'))).toBe(true)
    expect(paths.some((p) => p.includes('settings'))).toBe(true)
  })

  it('should track headquarters relocation via findOneAndUpdate', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.findOneAndUpdate(
      { _id: org._id },
      {
        headquarters: {
          street: '1 Austin Blvd',
          city: 'Austin',
          state: 'TX',
          zip: '73301',
          country: 'US',
          coords: { lat: 30.2672, lng: -97.7431 },
          timezone: 'America/Chicago',
        },
      },
    ).exec()

    const updates = await HistoryModel.find({ op: 'findOneAndUpdate', collectionId: org._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/headquarters'))).toBe(true)
  })

  it('should track domain and tag array changes', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $addToSet: { domains: 'acme.dev' }, $pull: { tags: 'active' } }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/domains'))).toBe(true)
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('should track deactivation and record deletion', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { active: false }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(updates).toHaveLength(1)
    expect(getPatch(updates[0], '/active')?.value).toBe(false)

    await OrganizationModel.deleteOne({ _id: org._id }).exec()

    const allHistory = await HistoryModel.find({ collectionId: org._id }).sort('createdAt')
    expect(allHistory.length).toBe(3)
    expect(allHistory[0]?.op).toBe('create')
    expect(allHistory[1]?.op).toBe('updateOne')
    expect(allHistory[2]?.op).toBe('deleteOne')
    expect(allHistory[2]?.doc).toHaveProperty('name', 'Acme Corp')
    expect(allHistory[2]?.doc).not.toHaveProperty('notes')
  })

  it('should handle full lifecycle: create → multiple updates → delete with version tracking', async () => {
    const org = await OrganizationModel.create(makeOrg())

    org.name = 'Acme Inc'
    org.contact.email = 'hello@acme.io'
    await org.save()

    org.billing.plan = 'enterprise'
    org.seatCount = 200
    await org.save()

    await OrganizationModel.updateOne({ _id: org._id }, { $addToSet: { tags: 'flagship' } }).exec()

    await OrganizationModel.deleteOne({ _id: org._id }).exec()

    const history = await HistoryModel.find({ collectionId: org._id }).sort('createdAt')
    expect(history.length).toBe(5)

    expect(history[0]?.op).toBe('create')
    expect(history[0]?.version).toBe(0)

    expect(history[1]?.op).toBe('update')
    expect(history[1]?.version).toBe(1)

    expect(history[2]?.op).toBe('update')
    expect(history[2]?.version).toBe(2)

    expect(history[3]?.op).toBe('updateOne')
    expect(history[3]?.version).toBe(3)

    expect(history[4]?.op).toBe('deleteOne')
  })

  it('should track insertMany with history for each document', async () => {
    await OrganizationModel.insertMany([
      { ...makeOrg(), slug: `bulk-a-${Date.now()}`, name: 'Bulk A' },
      { ...makeOrg(), slug: `bulk-b-${Date.now()}`, name: 'Bulk B' },
      { ...makeOrg(), slug: `bulk-c-${Date.now()}`, name: 'Bulk C' },
    ])

    const history = await HistoryModel.find({ op: 'create' }).sort('doc.name')
    expect(history).toHaveLength(3)

    for (const entry of history) {
      expect(entry.version).toBe(0)
      expect(entry.doc).toHaveProperty('name')
      expect(entry.doc).toHaveProperty('externalId')
      expect(entry.doc).not.toHaveProperty('notes')
      expect(entry.doc).not.toHaveProperty('__v')
    }

    const names = history.map((h) => (h.doc as Record<string, unknown>).name)
    expect(names).toContain('Bulk A')
    expect(names).toContain('Bulk B')
    expect(names).toContain('Bulk C')
  })

  it('should track updateMany across multiple organizations', async () => {
    await OrganizationModel.create({ ...makeOrg(), slug: `many-a-${Date.now()}`, tags: ['region-eu'] })
    await OrganizationModel.create({ ...makeOrg(), slug: `many-b-${Date.now()}`, tags: ['region-eu'] })
    await OrganizationModel.create({ ...makeOrg(), slug: `many-c-${Date.now()}`, tags: ['region-us'] })

    await OrganizationModel.updateMany({ tags: 'region-eu' }, { $set: { active: false } }).exec()

    const updates = await HistoryModel.find({ op: 'updateMany' })
    expect(updates).toHaveLength(2)

    for (const entry of updates) {
      expect(entry.patch?.length).toBeGreaterThan(0)
      const paths = entry.patch?.map((p) => p.path) ?? []
      expect(paths).toContain('/active')
    }
  })

  it('should track findByIdAndUpdate (mongoose normalizes op to findOneAndUpdate)', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.findByIdAndUpdate(org._id, { name: 'Acme Renamed' }).exec()

    const updates = await HistoryModel.find({ collectionId: org._id, version: { $gt: 0 } })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.op).toBe('findOneAndUpdate')
    expect(getPatch(updates[0], '/name')?.value).toBe('Acme Renamed')
  })

  it('should track findOneAndReplace with full document swap', async () => {
    const org = await OrganizationModel.create(makeOrg())
    const replacement = makeOrg()
    replacement.name = 'Replaced Corp'
    replacement.slug = org.slug
    replacement.billing.plan = 'enterprise'
    replacement.seatCount = 500

    await OrganizationModel.findOneAndReplace({ _id: org._id }, replacement).exec()

    const updates = await HistoryModel.find({ op: 'findOneAndReplace', collectionId: org._id })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.patch?.length).toBeGreaterThan(0)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/name')
    expect(paths.some((p) => p?.includes('/billing'))).toBe(true)
    expect(paths).toContain('/seatCount')
  })

  it('should track replaceOne', async () => {
    const org = await OrganizationModel.create(makeOrg())
    const replacement = makeOrg()
    replacement.name = 'ReplaceOne Corp'
    replacement.slug = org.slug
    replacement.active = false

    await OrganizationModel.replaceOne({ _id: org._id }, replacement).exec()

    const updates = await HistoryModel.find({ op: 'replaceOne', collectionId: org._id })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.patch?.length).toBeGreaterThan(0)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/name')
    expect(paths).toContain('/active')
  })

  it('should track findOneAndDelete with full document snapshot', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.findOneAndDelete({ _id: org._id }).exec()

    const history = await HistoryModel.find({ collectionId: org._id }).sort('createdAt')
    expect(history).toHaveLength(2)

    const deletion = history[1]
    expect(deletion?.op).toBe('findOneAndDelete')
    expect(deletion?.doc).toHaveProperty('name', 'Acme Corp')
    expect(deletion?.doc).toHaveProperty('billing')
    expect(deletion?.doc).toHaveProperty('team')
    expect(deletion?.doc).not.toHaveProperty('notes')
  })

  it('should track findByIdAndDelete (mongoose normalizes op to findOneAndDelete)', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.findByIdAndDelete(org._id).exec()

    const history = await HistoryModel.find({ collectionId: org._id }).sort('createdAt')
    expect(history).toHaveLength(2)

    expect(history[1]?.op).toBe('findOneAndDelete')
    expect(history[1]?.doc).toHaveProperty('name', 'Acme Corp')
    expect(history[1]?.doc).toHaveProperty('contact')
    expect(history[1]?.doc).not.toHaveProperty('notes')
  })

  it('should track deleteMany with snapshots for all deleted documents', async () => {
    await OrganizationModel.create({ ...makeOrg(), slug: `del-a-${Date.now()}`, name: 'Del A', tags: ['sunset'] })
    await OrganizationModel.create({ ...makeOrg(), slug: `del-b-${Date.now()}`, name: 'Del B', tags: ['sunset'] })
    await OrganizationModel.create({ ...makeOrg(), slug: `del-c-${Date.now()}`, name: 'Del C', tags: ['keep'] })

    await OrganizationModel.deleteMany({ tags: 'sunset' }).exec()

    const deletions = await HistoryModel.find({ op: 'deleteMany' })
    expect(deletions).toHaveLength(2)

    const names = deletions.map((d) => (d.doc as Record<string, unknown>).name)
    expect(names).toContain('Del A')
    expect(names).toContain('Del B')

    for (const entry of deletions) {
      expect(entry.doc).toHaveProperty('contact')
      expect(entry.doc).toHaveProperty('billing')
      expect(entry.doc).not.toHaveProperty('notes')
    }
  })

  it('should track upsert creating a new organization', async () => {
    const slug = `upsert-new-${Date.now()}`

    await OrganizationModel.findOneAndUpdate(
      { slug },
      {
        name: 'Upserted Corp',
        slug,
        externalId: '660e8400-e29b-41d4-a716-446655440000',
        contact: { email: 'upsert@test.com' },
        seatCount: 5,
      },
      { upsert: true },
    ).exec()

    const docs = await OrganizationModel.find({ slug })
    expect(docs).toHaveLength(1)

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(1)
    expect(history[0]?.op).toBe('findOneAndUpdate')
    expect(history[0]?.doc).toHaveProperty('name', 'Upserted Corp')
  })

  it('should track upsert updating an existing organization', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.findOneAndUpdate({ slug: org.slug }, { $set: { seatCount: 999 } }, { upsert: true }).exec()

    const updates = await HistoryModel.find({ op: 'findOneAndUpdate', collectionId: org._id })
    expect(updates).toHaveLength(1)

    const paths = updates[0]?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/seatCount')
  })

  // --- $ modifier operators ---

  it('$set — should track field replacement', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $set: { name: 'Set Corp', 'contact.phone': '+1-555-9999' } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/name')
    expect(paths.some((p) => p?.includes('/contact'))).toBe(true)
  })

  it('$unset — should track field removal', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $unset: { logo: '' } }).exec()

    const current = await OrganizationModel.findById(org._id).lean().exec()
    expect(current?.logo).toBeUndefined()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(update).toBeDefined()
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/logo'))).toBe(true)
  })

  it('$inc — should track numeric increment with correct post-update value', async () => {
    const org = await OrganizationModel.create(makeOrg())
    expect(org.seatCount).toBe(25)

    await OrganizationModel.updateOne({ _id: org._id }, { $inc: { seatCount: 10 } }).exec()

    const current = await OrganizationModel.findById(org._id).lean().exec()
    expect(current?.seatCount).toBe(35)

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(update).toBeDefined()
    const seatPatch = getPatch(update, '/seatCount')
    expect(seatPatch?.value).toBe(35)
  })

  it('$mul — should track numeric multiply with correct post-update value', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $mul: { seatCount: 2 } }).exec()

    const current = await OrganizationModel.findById(org._id).lean().exec()
    expect(current?.seatCount).toBe(50)

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(update).toBeDefined()
    const seatPatch = getPatch(update, '/seatCount')
    expect(seatPatch?.value).toBe(50)
  })

  it('$min — should track conditional numeric update', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $min: { seatCount: 5 } }).exec()

    const current = await OrganizationModel.findById(org._id).lean().exec()
    expect(current?.seatCount).toBe(5)

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(update).toBeDefined()
    const seatPatch = getPatch(update, '/seatCount')
    expect(seatPatch?.value).toBe(5)
  })

  it('$pullAll — should track multiple array element removals', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $pullAll: { tags: ['saas', 'enterprise'] } }).exec()

    const current = await OrganizationModel.findById(org._id).lean().exec()
    expect(current?.tags).toEqual(['active'])

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(update).toBeDefined()
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('$push — should track array element addition', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $push: { tags: 'new-tag' } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('$push with $each — should track multiple array additions', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $push: { domains: { $each: ['acme.dev', 'acme.ai'] } } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/domains'))).toBe(true)
  })

  it('$addToSet — should track unique array addition', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $addToSet: { tags: 'unique-tag' } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('$pull — should track array element removal', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $pull: { tags: 'enterprise' } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('$pop — should track removal of last array element', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $pop: { tags: 1 } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)
  })

  it('$rename — should track field rename', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $rename: { 'contact.phone': 'contact.mobile' } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/contact'))).toBe(true)
  })

  it('$currentDate — should track date set to now', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { $currentDate: { 'billing.nextBillingDate': true } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.includes('/billing'))).toBe(true)
  })

  it('combined $set + $inc + $push — should track all operators with correct values', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne(
      { _id: org._id },
      {
        $set: { name: 'Combined Corp', active: false },
        $inc: { seatCount: 50 },
        $push: { tags: 'combined' },
      },
    ).exec()

    const current = await OrganizationModel.findById(org._id).lean().exec()
    expect(current?.name).toBe('Combined Corp')
    expect(current?.active).toBe(false)
    expect(current?.seatCount).toBe(75)
    expect(current?.tags).toContain('combined')

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/name')
    expect(paths).toContain('/active')
    expect(paths).toContain('/seatCount')
    expect(paths.some((p) => p?.startsWith('/tags'))).toBe(true)

    expect(getPatch(update, '/name')?.value).toBe('Combined Corp')
    expect(getPatch(update, '/active')?.value).toBe(false)
    expect(getPatch(update, '/seatCount')?.value).toBe(75)
  })

  it('$push subdocument into team array — should track nested array addition', async () => {
    const org = await OrganizationModel.create(makeOrg())
    const newMemberId = new mongoose.Types.ObjectId()

    await OrganizationModel.updateOne({ _id: org._id }, { $push: { team: { userId: newMemberId, role: 'viewer' } } }).exec()

    const [update] = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths.some((p) => p?.startsWith('/team'))).toBe(true)
  })

  // --- getUser / getReason / getMetadata ---

  it('create history should contain user, reason, and metadata', async () => {
    const org = await OrganizationModel.create(makeOrg())

    const [entry] = await HistoryModel.find({ collectionId: org._id })
    expect(entry?.user).toEqual({ userId: 'system', role: 'service-account' })
    expect(entry?.reason).toBe('api-call')
    expect(entry?.metadata).toEqual({ service: 'org-service', requestId: 'req-123' })
  })

  it('update history should contain user, reason, and metadata', async () => {
    const org = await OrganizationModel.create(makeOrg())

    org.name = 'Updated Corp'
    await org.save()

    const update = await HistoryModel.findOne({ op: 'update', collectionId: org._id })
    expect(update?.user).toEqual({ userId: 'system', role: 'service-account' })
    expect(update?.reason).toBe('api-call')
    expect(update?.metadata).toEqual({ service: 'org-service', requestId: 'req-123' })
  })

  it('delete history should contain user, reason, and metadata', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.deleteOne({ _id: org._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'deleteOne', collectionId: org._id })
    expect(deletion?.user).toEqual({ userId: 'system', role: 'service-account' })
    expect(deletion?.reason).toBe('api-call')
    expect(deletion?.metadata).toEqual({ service: 'org-service', requestId: 'req-123' })
  })

  it('updateOne history should contain user, reason, and metadata', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { name: 'Query Updated' }).exec()

    const update = await HistoryModel.findOne({ op: 'updateOne', collectionId: org._id })
    expect(update?.user).toEqual({ userId: 'system', role: 'service-account' })
    expect(update?.reason).toBe('api-call')
    expect(update?.metadata).toEqual({ service: 'org-service', requestId: 'req-123' })
  })

  // --- History record structure ---

  it('create history should contain doc snapshot, no patch array', async () => {
    const org = await OrganizationModel.create(makeOrg())

    const [entry] = await HistoryModel.find({ collectionId: org._id })
    expect(entry?.op).toBe('create')
    expect(entry?.modelName).toBe('Organization')
    expect(entry?.collectionName).toBe('organizations')
    expect(entry?.collectionId).toEqual(org._id)
    expect(entry?.version).toBe(0)
    expect(entry?.doc).toBeDefined()
    expect(entry?.patch).toEqual([])
    expect(entry?.createdAt).toBeDefined()
    expect(entry?.updatedAt).toBeDefined()
  })

  it('update history should contain JSON patch, no doc snapshot', async () => {
    const org = await OrganizationModel.create(makeOrg())

    org.name = 'Changed'
    await org.save()

    const update = await HistoryModel.findOne({ op: 'update', collectionId: org._id })
    expect(update?.doc).toBeUndefined()
    expect(update?.patch).toBeDefined()
    expect(update?.patch?.length).toBeGreaterThan(0)

    const nameOp = getPatch(update, '/name')
    expect(nameOp).toBeDefined()
    expect(nameOp?.value).toBe('Changed')
  })

  it('delete history should contain doc snapshot, no patch array', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.deleteOne({ _id: org._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'deleteOne', collectionId: org._id })
    expect(deletion?.doc).toBeDefined()
    expect(deletion?.doc).toHaveProperty('name', 'Acme Corp')
    expect(deletion?.patch).toEqual([])
  })

  // --- Event payloads ---

  it('create event should emit with { doc } payload', async () => {
    await OrganizationModel.create(makeOrg())

    expect(em.emit).toHaveBeenCalledWith(ORG_CREATED, expect.objectContaining({ doc: expect.objectContaining({ name: 'Acme Corp' }) }))
  })

  it('update event should emit with { doc, oldDoc, patch } payload', async () => {
    const org = await OrganizationModel.create(makeOrg())
    vi.mocked(em.emit).mockClear()

    org.name = 'New Name'
    await org.save()

    expect(em.emit).toHaveBeenCalledWith(
      ORG_UPDATED,
      expect.objectContaining({
        oldDoc: expect.objectContaining({ name: 'Acme Corp' }),
        doc: expect.objectContaining({ name: 'New Name' }),
        patch: expect.arrayContaining([expect.objectContaining({ path: '/name', op: 'replace', value: 'New Name' })]),
      }),
    )
  })

  it('delete event should emit with { oldDoc } payload', async () => {
    const org = await OrganizationModel.create(makeOrg())
    vi.mocked(em.emit).mockClear()

    await OrganizationModel.deleteOne({ _id: org._id }).exec()

    expect(em.emit).toHaveBeenCalledWith(ORG_DELETED, expect.objectContaining({ oldDoc: expect.objectContaining({ name: 'Acme Corp' }) }))
  })

  // --- Omit behavior ---

  it('omitted fields should never appear in create history doc', async () => {
    const org = await OrganizationModel.create(makeOrg())

    const [entry] = await HistoryModel.find({ collectionId: org._id })
    expect(entry?.doc).not.toHaveProperty('notes')
    expect(entry?.doc).not.toHaveProperty('__v')
    expect(entry?.doc).not.toHaveProperty('createdAt')
    expect(entry?.doc).not.toHaveProperty('updatedAt')
  })

  it('omitted fields should never appear in update patch paths', async () => {
    const org = await OrganizationModel.create(makeOrg())

    org.notes = 'changed internal note'
    org.name = 'Trigger Real Change'
    await org.save()

    const update = await HistoryModel.findOne({ op: 'update', collectionId: org._id })
    const paths = update?.patch?.map((p) => p.path) ?? []
    expect(paths).toContain('/name')
    expect(paths.every((p) => !p?.includes('notes'))).toBe(true)
    expect(paths.every((p) => !p?.includes('__v'))).toBe(true)
    expect(paths.every((p) => !p?.includes('createdAt'))).toBe(true)
    expect(paths.every((p) => !p?.includes('updatedAt'))).toBe(true)
  })

  it('omitted fields should never appear in delete history doc', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.deleteOne({ _id: org._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'deleteOne', collectionId: org._id })
    expect(deletion?.doc).not.toHaveProperty('notes')
    expect(deletion?.doc).not.toHaveProperty('__v')
    expect(deletion?.doc).not.toHaveProperty('createdAt')
    expect(deletion?.doc).not.toHaveProperty('updatedAt')
  })

  // --- Version tracking ---

  it('versions should increment sequentially per document', async () => {
    const org = await OrganizationModel.create(makeOrg())

    for (let i = 1; i <= 5; i++) {
      org.seatCount = i * 10
      await org.save()
    }

    const history = await HistoryModel.find({ collectionId: org._id }).sort('version')
    expect(history).toHaveLength(6)

    for (let i = 0; i < 6; i++) {
      expect(history[i]?.version).toBe(i)
    }
  })

  it('versions should be independent per document', async () => {
    const orgA = await OrganizationModel.create({ ...makeOrg(), slug: `a-${Date.now()}` })
    const orgB = await OrganizationModel.create({ ...makeOrg(), slug: `b-${Date.now()}` })

    orgA.name = 'A changed'
    await orgA.save()

    orgB.name = 'B changed'
    await orgB.save()

    const historyA = await HistoryModel.find({ collectionId: orgA._id }).sort('version')
    const historyB = await HistoryModel.find({ collectionId: orgB._id }).sort('version')

    expect(historyA[0]?.version).toBe(0)
    expect(historyA[1]?.version).toBe(1)
    expect(historyB[0]?.version).toBe(0)
    expect(historyB[1]?.version).toBe(1)
  })

  // --- ignoreHook / ignoreEvent / ignorePatchHistory ---

  it('ignoreHook should skip both history and events', async () => {
    const org = await OrganizationModel.create(makeOrg())
    vi.mocked(em.emit).mockClear()

    await OrganizationModel.updateOne({ _id: org._id }, { name: 'Ignored' }).setOptions({ ignoreHook: true }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(updates).toHaveLength(0)
    expect(em.emit).not.toHaveBeenCalledWith(ORG_UPDATED, expect.anything())
  })

  it('ignoreEvent should keep history but skip events', async () => {
    const org = await OrganizationModel.create(makeOrg())
    vi.mocked(em.emit).mockClear()

    await OrganizationModel.updateOne({ _id: org._id }, { name: 'EventSkipped' }).setOptions({ ignoreEvent: true }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(updates).toHaveLength(1)
    expect(em.emit).not.toHaveBeenCalledWith(ORG_UPDATED, expect.anything())
  })

  it('ignorePatchHistory should skip history but keep events', async () => {
    const org = await OrganizationModel.create(makeOrg())
    vi.mocked(em.emit).mockClear()

    await OrganizationModel.updateOne({ _id: org._id }, { name: 'HistorySkipped' }).setOptions({ ignorePatchHistory: true }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(updates).toHaveLength(0)
    expect(em.emit).toHaveBeenCalledWith(ORG_UPDATED, expect.anything())
  })

  // --- No-op safety ---

  it('update with no actual changes should not produce history', async () => {
    const org = await OrganizationModel.create(makeOrg())

    await OrganizationModel.updateOne({ _id: org._id }, { name: 'Acme Corp' }).exec()

    const updates = await HistoryModel.find({ op: 'updateOne', collectionId: org._id })
    expect(updates).toHaveLength(0)
  })

  it('update targeting non-existent document should not crash or produce history', async () => {
    const fakeId = new mongoose.Types.ObjectId()

    await OrganizationModel.updateOne({ _id: fakeId }, { name: 'Ghost' }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('delete targeting non-existent document should not crash or produce history', async () => {
    const fakeId = new mongoose.Types.ObjectId()

    await OrganizationModel.deleteOne({ _id: fakeId }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  // --- insertMany with user/reason/metadata ---

  it('insertMany should attach user, reason, and metadata to each history record', async () => {
    await OrganizationModel.insertMany([
      { ...makeOrg(), slug: `ins-a-${Date.now()}`, name: 'Ins A' },
      { ...makeOrg(), slug: `ins-b-${Date.now()}`, name: 'Ins B' },
    ])

    const history = await HistoryModel.find({ op: 'create' }).sort('doc.name')
    expect(history).toHaveLength(2)

    for (const entry of history) {
      expect(entry.user).toEqual({ userId: 'system', role: 'service-account' })
      expect(entry.reason).toBe('api-call')
      expect(entry.metadata).toEqual({ service: 'org-service', requestId: 'req-123' })
    }
  })

  // --- preDelete callback ---

  it('preDelete should receive cloned documents before deletion', async () => {
    const preDeleteDocs: unknown[][] = []

    const PreDeleteSchema = new Schema<Organization>(
      {
        name: { type: String, required: true },
        slug: { type: String, required: true },
        externalId: { type: Schema.Types.UUID, required: true },
        active: { type: Boolean, default: true },
        contact: { type: ContactSchema, required: true },
        seatCount: { type: Number, default: 1 },
      },
      { timestamps: true },
    )

    PreDeleteSchema.plugin(patchHistoryPlugin, {
      omit: ['__v', 'createdAt', 'updatedAt'],
      preDelete: async (docs) => {
        preDeleteDocs.push(docs)
      },
    })

    if (mongoose.models.PreDeleteOrg) mongoose.deleteModel('PreDeleteOrg')
    const PreDeleteModel = model<Organization>('PreDeleteOrg', PreDeleteSchema)

    const org = await PreDeleteModel.create({
      name: 'Doomed Corp',
      slug: `doomed-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'bye@doomed.com' },
    })

    await PreDeleteModel.deleteOne({ _id: org._id }).exec()

    expect(preDeleteDocs).toHaveLength(1)
    expect(preDeleteDocs[0]).toHaveLength(1)
    expect(preDeleteDocs[0]?.[0]).toHaveProperty('name', 'Doomed Corp')
  })
})

// --- patchHistoryDisabled mode ---

const EventOnlySchema = new Schema<Organization>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    externalId: { type: Schema.Types.UUID, required: true },
    active: { type: Boolean, default: true },
    contact: { type: ContactSchema, required: true },
    seatCount: { type: Number, default: 1 },
  },
  { timestamps: true },
)

const EVENT_ONLY_CREATED = 'event-only-created'
const EVENT_ONLY_UPDATED = 'event-only-updated'
const EVENT_ONLY_DELETED = 'event-only-deleted'

EventOnlySchema.plugin(patchHistoryPlugin, {
  eventCreated: EVENT_ONLY_CREATED,
  eventUpdated: EVENT_ONLY_UPDATED,
  eventDeleted: EVENT_ONLY_DELETED,
  patchHistoryDisabled: true,
  omit: ['__v', 'createdAt', 'updatedAt'],
})

const EventOnlyModel = model<Organization>('EventOnlyOrg', EventOnlySchema)

describe('plugin — patchHistoryDisabled (events only, no history)', () => {
  const instance = server('plugin-events-only')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('eventonlyorgs').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('create should emit event but not write history', async () => {
    await EventOnlyModel.create({
      name: 'EventOnly Corp',
      slug: `eo-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'eo@test.com' },
    })

    expect(em.emit).toHaveBeenCalledWith(EVENT_ONLY_CREATED, expect.objectContaining({ doc: expect.objectContaining({ name: 'EventOnly Corp' }) }))

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('update should emit event but not write history', async () => {
    const org = await EventOnlyModel.create({
      name: 'EventOnly Corp',
      slug: `eo-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'eo@test.com' },
    })

    vi.mocked(em.emit).mockClear()

    org.name = 'Updated EventOnly'
    await org.save()

    expect(em.emit).toHaveBeenCalledWith(
      EVENT_ONLY_UPDATED,
      expect.objectContaining({
        oldDoc: expect.objectContaining({ name: 'EventOnly Corp' }),
        doc: expect.objectContaining({ name: 'Updated EventOnly' }),
        patch: expect.any(Array),
      }),
    )

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('delete should emit event but not write history', async () => {
    const org = await EventOnlyModel.create({
      name: 'EventOnly Corp',
      slug: `eo-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'eo@test.com' },
    })

    vi.mocked(em.emit).mockClear()

    await EventOnlyModel.deleteOne({ _id: org._id }).exec()

    expect(em.emit).toHaveBeenCalledWith(EVENT_ONLY_DELETED, expect.objectContaining({ oldDoc: expect.objectContaining({ name: 'EventOnly Corp' }) }))

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('updateOne should emit event but not write history', async () => {
    const org = await EventOnlyModel.create({
      name: 'EventOnly Corp',
      slug: `eo-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'eo@test.com' },
    })

    vi.mocked(em.emit).mockClear()

    await EventOnlyModel.updateOne({ _id: org._id }, { name: 'Query Updated' }).exec()

    expect(em.emit).toHaveBeenCalledWith(EVENT_ONLY_UPDATED, expect.anything())

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })
})

// --- Async getUser/getReason/getMetadata ---

const AsyncCallbackSchema = new Schema<Organization>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    externalId: { type: Schema.Types.UUID, required: true },
    active: { type: Boolean, default: true },
    contact: { type: ContactSchema, required: true },
    seatCount: { type: Number, default: 1 },
  },
  { timestamps: true },
)

AsyncCallbackSchema.plugin(patchHistoryPlugin, {
  omit: ['__v', 'createdAt', 'updatedAt'],
  getUser: async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { userId: 'async-user', source: 'http-context' }
  },
  getReason: async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    return 'async-reason'
  },
  getMetadata: async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { async: true, timestamp: Date.now() }
  },
})

const AsyncCallbackModel = model<Organization>('AsyncCallbackOrg', AsyncCallbackSchema)

describe('plugin — async getUser/getReason/getMetadata', () => {
  const instance = server('plugin-async-callbacks')

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('asynccallbackorgs').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('create should resolve async getUser/getReason/getMetadata', async () => {
    const org = await AsyncCallbackModel.create({
      name: 'Async Corp',
      slug: `async-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'async@test.com' },
    })

    const [entry] = await HistoryModel.find({ collectionId: org._id })
    expect(entry?.user).toEqual({ userId: 'async-user', source: 'http-context' })
    expect(entry?.reason).toBe('async-reason')
    expect(entry?.metadata).toHaveProperty('async', true)
    expect(entry?.metadata).toHaveProperty('timestamp')
  })

  it('update should resolve async callbacks', async () => {
    const org = await AsyncCallbackModel.create({
      name: 'Async Corp',
      slug: `async-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'async@test.com' },
    })

    org.name = 'Async Updated'
    await org.save()

    const update = await HistoryModel.findOne({ op: 'update', collectionId: org._id })
    expect(update?.user).toEqual({ userId: 'async-user', source: 'http-context' })
    expect(update?.reason).toBe('async-reason')
    expect(update?.metadata).toHaveProperty('async', true)
  })

  it('delete should resolve async callbacks', async () => {
    const org = await AsyncCallbackModel.create({
      name: 'Async Corp',
      slug: `async-${Date.now()}`,
      externalId: '550e8400-e29b-41d4-a716-446655440000',
      contact: { email: 'async@test.com' },
    })

    await AsyncCallbackModel.deleteOne({ _id: org._id }).exec()

    const deletion = await HistoryModel.findOne({ op: 'deleteOne', collectionId: org._id })
    expect(deletion?.user).toEqual({ userId: 'async-user', source: 'http-context' })
    expect(deletion?.reason).toBe('async-reason')
    expect(deletion?.metadata).toHaveProperty('async', true)
  })
})
