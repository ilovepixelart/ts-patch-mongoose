import mongoose from 'mongoose'

import ProductSchema from './schemas/ProductSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { GLOBAL_CREATED, GLOBAL_UPDATED, GLOBAL_DELETED } from './constants/events'

jest.mock('../src/em', () => {
  return { emit: jest.fn() }
})

describe('plugin - global', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  mongoose.plugin(patchHistoryPlugin, {
    eventCreated: GLOBAL_CREATED,
    eventUpdated: GLOBAL_UPDATED,
    eventDeleted: GLOBAL_DELETED,
    omit: ['__v', 'createdAt', 'updatedAt'],
  })

  const Product = mongoose.model('Product', ProductSchema)

  beforeAll(async () => {
    await mongoose.connect(uri)
  })

  afterAll(async () => {
    await mongoose.connection.close()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('products').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  it('should save nested schema', async () => {
    const product = await Product.create({ name: 'paper', description: { summary: 'test1' } })
    expect(product.name).toBe('paper')

    product.description = { summary: 'test2' }
    await product.save()

    product.description.summary = 'test3'
    await product.save()

    const history = await History.find({})
    expect(history).toHaveLength(3)

    const [first, second, third] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('Product')
    expect(first.collectionName).toBe('products')
    expect(first.collectionId).toEqual(product._id)

    expect(first.doc).toHaveProperty('_id', product._id)
    expect(first.doc).toHaveProperty('name', 'paper')
    expect(first.doc).toHaveProperty('description', { summary: 'test1' })
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.op).toBe('update')
    expect(second.modelName).toBe('Product')
    expect(second.collectionName).toBe('products')
    expect(second.collectionId).toEqual(product._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(2)
    expect(second.patch).toMatchObject([
      { op: 'test', path: '/description/summary', value: 'test1' },
      { op: 'replace', path: '/description/summary', value: 'test2' },
    ])

    // 3 update
    expect(third.version).toBe(2)
    expect(third.op).toBe('update')
    expect(third.modelName).toBe('Product')
    expect(third.collectionName).toBe('products')
    expect(third.collectionId).toEqual(product._id)

    expect(third.doc).toBeUndefined()

    expect(third.patch).toHaveLength(2)
    expect(third.patch).toMatchObject([
      { op: 'test', path: '/description/summary', value: 'test2' },
      { op: 'replace', path: '/description/summary', value: 'test3' },
    ])

    expect(em.emit).toHaveBeenCalledTimes(3)
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test1' } }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test2' } }),
      patch: second.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test2' } }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test3' } }),
      patch: third.patch,
    })
  })

  it('should update nested schema', async () => {
    const product = await Product.create({ name: 'paper', description: { summary: 'test1' } })
    expect(product.name).toBe('paper')

    await product.updateOne({
      description: { summary: 'test2' },
    }).exec()

    await product.updateOne({
      $set: { 'description.summary': 'test3' },
    }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(3)

    const [first, second, third] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('Product')
    expect(first.collectionName).toBe('products')
    expect(first.collectionId).toEqual(product._id)

    expect(first.doc).toHaveProperty('_id', product._id)
    expect(first.doc).toHaveProperty('name', 'paper')
    expect(first.doc).toHaveProperty('description', { summary: 'test1' })
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.op).toBe('updateOne')
    expect(second.modelName).toBe('Product')
    expect(second.collectionName).toBe('products')
    expect(second.collectionId).toEqual(product._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(2)
    expect(second.patch).toMatchObject([
      { op: 'test', path: '/description/summary', value: 'test1' },
      { op: 'replace', path: '/description/summary', value: 'test2' },
    ])

    // 3 update
    expect(third.version).toBe(2)
    expect(third.op).toBe('updateOne')
    expect(third.modelName).toBe('Product')
    expect(third.collectionName).toBe('products')
    expect(third.collectionId).toEqual(product._id)

    expect(third.doc).toBeUndefined()

    expect(third.patch).toHaveLength(2)
    expect(third.patch).toMatchObject([
      { op: 'test', path: '/description/summary', value: 'test2' },
      { op: 'replace', path: '/description/summary', value: 'test3' },
    ])

    expect(em.emit).toHaveBeenCalledTimes(3)
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test1' } }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test2' } }),
      patch: second.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test2' } }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', description: { summary: 'test3' } }),
      patch: third.patch,
    })
  })
})
