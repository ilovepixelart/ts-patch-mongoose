import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose from 'mongoose'

import History from '../src/models/History'
import { patchHistoryPlugin } from '../src/plugin'
import ProductSchema from './schemas/ProductSchema'
import UserSchema from './schemas/UserSchema'

import { GLOBAL_CREATED, GLOBAL_DELETED, GLOBAL_UPDATED } from './constants/events'

import em from '../src/em'
import server from './mongo/server'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

describe('plugin - global', () => {
  const instance = server('plugin-global')

  mongoose.plugin(patchHistoryPlugin, {
    eventCreated: GLOBAL_CREATED,
    eventUpdated: GLOBAL_UPDATED,
    eventDeleted: GLOBAL_DELETED,
    omit: ['__v', 'createdAt', 'updatedAt'],
  })

  const User = mongoose.model('User', UserSchema)
  const Product = mongoose.model('Product', ProductSchema)

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('users').deleteMany({})
    await mongoose.connection.collection('products').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  it('should save array', async () => {
    const product = await Product.create({ name: 'paper', groups: [] })
    expect(product.name).toBe('paper')

    product.groups = ['office']
    await product.save()

    product.groups.push('school')
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
    expect(first.doc).toHaveProperty('groups', [])
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.op).toBe('update')
    expect(second.modelName).toBe('Product')
    expect(second.collectionName).toBe('products')
    expect(second.collectionId).toEqual(product._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(1)
    expect(second.patch).toMatchObject([{ op: 'add', path: '/groups/0', value: 'office' }])

    // 3 update
    expect(third.version).toBe(2)
    expect(third.op).toBe('update')
    expect(third.modelName).toBe('Product')
    expect(third.collectionName).toBe('products')
    expect(third.collectionId).toEqual(product._id)

    expect(third.doc).toBeUndefined()

    expect(third.patch).toHaveLength(1)
    expect(third.patch).toMatchObject([{ op: 'add', path: '/groups/1', value: 'school' }])

    expect(em.emit).toHaveBeenCalledTimes(3)
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', groups: [] }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', groups: ['office'] }),
      patch: second.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', groups: ['office'] }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', groups: ['office', 'school'] }),
      patch: third.patch,
    })
  })

  it('should update array', async () => {
    const product = await Product.create({ name: 'paper', groups: [] })
    expect(product.name).toBe('paper')

    await product
      .updateOne({
        groups: ['office'],
      })
      .exec()

    await product
      .updateOne({
        $push: { groups: 'school' },
      })
      .exec()

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
    expect(first.doc).toHaveProperty('groups', [])
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.op).toBe('updateOne')
    expect(second.modelName).toBe('Product')
    expect(second.collectionName).toBe('products')
    expect(second.collectionId).toEqual(product._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(1)
    expect(second.patch).toMatchObject([{ op: 'add', path: '/groups/0', value: 'office' }])

    // 3 update
    expect(third.version).toBe(2)
    expect(third.op).toBe('updateOne')
    expect(third.modelName).toBe('Product')
    expect(third.collectionName).toBe('products')
    expect(third.collectionId).toEqual(product._id)

    expect(third.doc).toBeUndefined()

    expect(third.patch).toHaveLength(1)
    expect(third.patch).toMatchObject([{ op: 'add', path: '/groups/1', value: 'school' }])

    expect(em.emit).toHaveBeenCalledTimes(3)
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', groups: [] }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', groups: ['office'] }),
      patch: second.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', groups: ['office'] }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', groups: ['office', 'school'] }),
      patch: third.patch,
    })
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
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

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

    await product
      .updateOne({
        description: { summary: 'test2' },
      })
      .exec()

    await product
      .updateOne({
        $set: { 'description.summary': 'test3' },
      })
      .exec()

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
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

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

  it('should save objectID', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')
    const product = await Product.create({ name: 'paper', addedBy: john })
    expect(product.name).toBe('paper')

    product.addedBy = alice._id
    await product.save()

    const history = await History.find({})
    expect(history).toHaveLength(4)

    const [first, second, third, fourth] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(john._id)

    expect(first.doc).toHaveProperty('_id', john._id)
    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 create

    expect(second.version).toBe(0)
    expect(second.op).toBe('create')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(alice._id)

    expect(second.doc).toHaveProperty('_id', alice._id)
    expect(second.doc).toHaveProperty('name', 'Alice')
    expect(second.doc).toHaveProperty('role', 'user')
    expect(second.doc).not.toHaveProperty('createdAt')
    expect(second.doc).not.toHaveProperty('updatedAt')

    expect(second.patch).toHaveLength(0)

    // 3 create
    expect(third.version).toBe(0)
    expect(third.op).toBe('create')
    expect(third.modelName).toBe('Product')
    expect(third.collectionName).toBe('products')
    expect(third.collectionId).toEqual(product._id)

    expect(third.doc).toHaveProperty('_id', product._id)
    expect(third.doc).toHaveProperty('name', 'paper')
    expect(third.doc).toHaveProperty('addedBy', john._id)
    expect(third.doc).not.toHaveProperty('createdAt')
    expect(third.doc).not.toHaveProperty('updatedAt')

    expect(third.patch).toHaveLength(0)

    // 4 update
    expect(fourth.version).toBe(1)
    expect(fourth.op).toBe('update')
    expect(fourth.modelName).toBe('Product')
    expect(fourth.collectionName).toBe('products')
    expect(fourth.collectionId).toEqual(product._id)

    expect(fourth.doc).toBeUndefined()

    expect(fourth.patch).toHaveLength(2)
    expect(fourth.patch).toMatchObject([
      { op: 'test', path: '/addedBy', value: john._id.toString() },
      { op: 'replace', path: '/addedBy', value: alice._id.toString() },
    ])

    expect(em.emit).toHaveBeenCalledTimes(4)
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: second.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: third.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', addedBy: john._id }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', addedBy: alice._id }),
      patch: fourth.patch,
    })
  })

  it('should update objectID', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')
    const product = await Product.create({ name: 'paper', addedBy: john })
    expect(product.name).toBe('paper')

    await product
      .updateOne({
        addedBy: alice,
      })
      .exec()

    await product
      .updateOne({
        addedBy: { _id: john._id, name: 'John', role: 'manager' },
      })
      .exec()

    const history = await History.find({})
    expect(history).toHaveLength(5)

    const [first, second, third, fourth, fifth] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(john._id)

    expect(first.doc).toHaveProperty('_id', john._id)
    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 create

    expect(second.version).toBe(0)
    expect(second.op).toBe('create')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(alice._id)

    expect(second.doc).toHaveProperty('_id', alice._id)
    expect(second.doc).toHaveProperty('name', 'Alice')
    expect(second.doc).toHaveProperty('role', 'user')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(second.patch).toHaveLength(0)

    // 3 create
    expect(third.version).toBe(0)
    expect(third.op).toBe('create')
    expect(third.modelName).toBe('Product')
    expect(third.collectionName).toBe('products')
    expect(third.collectionId).toEqual(product._id)

    expect(third.doc).toHaveProperty('_id', product._id)
    expect(third.doc).toHaveProperty('name', 'paper')
    expect(third.doc).toHaveProperty('addedBy', john._id)
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(third.patch).toHaveLength(0)

    // 4 update
    expect(fourth.version).toBe(1)
    expect(fourth.op).toBe('updateOne')
    expect(fourth.modelName).toBe('Product')
    expect(fourth.collectionName).toBe('products')
    expect(fourth.collectionId).toEqual(product._id)

    expect(fourth.doc).toBeUndefined()

    expect(fourth.patch).toHaveLength(2)
    expect(fourth.patch).toMatchObject([
      { op: 'test', path: '/addedBy', value: john._id.toString() },
      { op: 'replace', path: '/addedBy', value: alice._id.toString() },
    ])

    // 5 update
    expect(fifth.version).toBe(2)
    expect(fifth.op).toBe('updateOne')
    expect(fifth.modelName).toBe('Product')
    expect(fifth.collectionName).toBe('products')
    expect(fifth.collectionId).toEqual(product._id)

    expect(fifth.doc).toBeUndefined()

    expect(fifth.patch).toHaveLength(2)
    expect(fifth.patch).toMatchObject([
      { op: 'test', path: '/addedBy', value: alice._id.toString() },
      { op: 'replace', path: '/addedBy', value: john._id.toString() },
    ])

    expect(em.emit).toHaveBeenCalledTimes(5)
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: second.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_CREATED, { doc: third.doc })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', addedBy: john._id }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', addedBy: alice._id }),
      patch: fourth.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(GLOBAL_UPDATED, {
      oldDoc: expect.objectContaining({ _id: product._id, name: 'paper', addedBy: alice._id }),
      doc: expect.objectContaining({ _id: product._id, name: 'paper', addedBy: john._id }),
      patch: fifth.patch,
    })
  })
})
