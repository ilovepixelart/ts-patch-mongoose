import { isMongooseLessThan7 } from '../src/version'

import mongoose from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { USER_CREATED, USER_UPDATED, USER_DELETED } from './constants/events'

jest.mock('../src/em', () => {
  return { emit: jest.fn() }
})

describe('plugin', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventCreated: USER_CREATED,
    eventUpdated: USER_UPDATED,
    eventDeleted: USER_DELETED,
    omit: ['__v', 'role', 'createdAt', 'updatedAt'],
  })

  const User = mongoose.model('User', UserSchema)

  beforeAll(async () => {
    await mongoose.connect(uri)
  })

  afterAll(async () => {
    await mongoose.connection.close()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('users').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  it('should createHistory', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.name = 'Alice'
    await user.save()

    user.name = 'Bob'
    await user.save()

    await User.deleteMany({ role: 'user' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(4)

    const [first, second, third, fourth] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)

    expect(first.doc).toHaveProperty('_id', user._id)
    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).not.toHaveProperty('role')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.op).toBe('update')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(user._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(2)
    expect(second.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'John' },
      { op: 'replace', path: '/name', value: 'Alice' },
    ])

    // 3 update
    expect(third.version).toBe(2)
    expect(third.op).toBe('update')
    expect(third.modelName).toBe('User')
    expect(third.collectionName).toBe('users')
    expect(third.collectionId).toEqual(user._id)

    expect(third.doc).toBeUndefined()

    expect(third.patch).toHaveLength(2)
    expect(third.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'Alice' },
      { op: 'replace', path: '/name', value: 'Bob' },
    ])

    // 4 delete
    expect(fourth.version).toBe(0)
    expect(fourth.op).toBe('deleteMany')
    expect(fourth.modelName).toBe('User')
    expect(fourth.collectionName).toBe('users')
    expect(fourth.collectionId).toEqual(user._id)

    expect(fourth.doc).toHaveProperty('_id', user._id)
    expect(fourth.doc).toHaveProperty('name', 'Bob')
    expect(fourth.doc).not.toHaveProperty('role')
    expect(fourth.doc).not.toHaveProperty('createdAt')
    expect(fourth.doc).not.toHaveProperty('updatedAt')

    expect(fourth.patch).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(4)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: user._id, name: 'John' }),
      doc: expect.objectContaining({ _id: user._id, name: 'Alice' }),
      patch: second.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: user._id, name: 'Alice' }),
      doc: expect.objectContaining({ _id: user._id, name: 'Bob' }),
      patch: third.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining({ _id: user._id, name: 'Bob' }),
    })
  })

  it('should omit update of role', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.role = 'manager'
    await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(1)

    const [first] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)

    expect(first.doc).toHaveProperty('_id', user._id)
    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).not.toHaveProperty('role')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    // no update event emitted because role is omitted
  })

  it('should updateOne', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await User.updateOne({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)

    expect(first.doc).toHaveProperty('_id', user._id)
    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).not.toHaveProperty('role')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.op).toBe('updateOne')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(user._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(2)
    expect(second.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'John' },
      { op: 'replace', path: '/name', value: 'Alice' },
    ])

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: user._id, name: 'John', role: 'user' }),
      doc: expect.objectContaining({ _id: user._id, name: 'Alice', role: 'user' }),
      patch: second.patch,
    })
  })

  it('should findOneAndUpdate', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await User.findOneAndUpdate({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)

    expect(first.doc).toHaveProperty('_id', user._id)
    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).not.toHaveProperty('role')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.op).toBe('findOneAndUpdate')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(user._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(2)
    expect(second.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'John' },
      { op: 'replace', path: '/name', value: 'Alice' },
    ])

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: user._id, name: 'John', role: 'user' }),
      doc: expect.objectContaining({ _id: user._id, name: 'Alice', role: 'user' }),
      patch: second.patch,
    })
  })

  it('should update deprecated', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    if (isMongooseLessThan7) {
      await User.update({ _id: user._id }, { $set: { name: 'Alice' } }).exec()
    } else {
      await User.findOneAndUpdate({ _id: user._id }, { $set: { name: 'Alice' } }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)

    expect(first.doc).toHaveProperty('_id', user._id)
    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).not.toHaveProperty('role')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 update
    expect(second.version).toBe(1)
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(user._id)

    expect(second.doc).toBeUndefined()

    expect(second.patch).toHaveLength(2)
    expect(second.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'John' },
      { op: 'replace', path: '/name', value: 'Alice' },
    ])

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: user._id, name: 'John', role: 'user' }),
      doc: expect.objectContaining({ _id: user._id, name: 'Alice', role: 'user' }),
      patch: second.patch,
    })
  })

  it('should updated deprecated with multi flag', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    if (isMongooseLessThan7) {
      await User.update({ role: 'user' }, { $set: { name: 'Bob' } }, { multi: true }).exec()
    } else {
      await User.findOneAndUpdate({ role: 'user' }, { $set: { name: 'Bob' } }).exec()
    }

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
    expect(first.doc).not.toHaveProperty('role')
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
    expect(second.doc).not.toHaveProperty('role')
    expect(second.doc).not.toHaveProperty('createdAt')
    expect(second.doc).not.toHaveProperty('updatedAt')

    expect(second.patch).toHaveLength(0)

    // 3 update
    expect(third.version).toBe(1)
    expect(third.modelName).toBe('User')
    expect(third.collectionName).toBe('users')
    expect(third.collectionId).toEqual(john._id)

    expect(third.doc).toBeUndefined()

    expect(third.patch).toHaveLength(2)
    expect(third.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'John' },
      { op: 'replace', path: '/name', value: 'Bob' },
    ])

    // 4 update
    expect(fourth.version).toBe(1)
    expect(fourth.modelName).toBe('User')
    expect(fourth.collectionName).toBe('users')
    expect(fourth.collectionId).toEqual(alice._id)

    expect(fourth.doc).toBeUndefined()

    expect(fourth.patch).toHaveLength(2)
    expect(fourth.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'Alice' },
      { op: 'replace', path: '/name', value: 'Bob' },
    ])

    expect(em.emit).toHaveBeenCalledTimes(4)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: second.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: john._id, name: 'John', role: 'user' }),
      doc: expect.objectContaining({ _id: john._id, name: 'Bob', role: 'user' }),
      patch: third.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: alice._id, name: 'Alice', role: 'user' }),
      doc: expect.objectContaining({ _id: alice._id, name: 'Bob', role: 'user' }),
      patch: fourth.patch,
    })
  })

  it('should create many', async () => {
    await User.create({ name: 'John', role: 'user' })
    await User.create({ name: 'Alice', role: 'user' })

    const history = await History.find({}).sort('doc.name')
    expect(history).toHaveLength(2)

    const [first, second] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')

    expect(first.doc).toHaveProperty('_id')
    expect(first.doc).toHaveProperty('name', 'Alice')
    expect(first.doc).not.toHaveProperty('role')
    expect(first.doc).not.toHaveProperty('createdAt')
    expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    // 2 create
    expect(second.version).toBe(0)
    expect(second.op).toBe('create')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')

    expect(second.doc).toHaveProperty('_id')
    expect(second.doc).toHaveProperty('name', 'John')
    expect(second.doc).not.toHaveProperty('role')
    expect(second.doc).not.toHaveProperty('createdAt')
    expect(second.doc).not.toHaveProperty('updatedAt')

    expect(second.patch).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: second.doc })
  })

  it('should findOneAndUpdate upsert', async () => {
    await User.findOneAndUpdate({ name: 'John', role: 'user' }, { name: 'Bob', role: 'user' }, { upsert: true, runValidators: true }).exec()
    const documents = await User.find({})
    expect(documents).toHaveLength(1)

    const history = await History.find({})
    expect(history).toHaveLength(1)

    const [first] = history

    // 1 create
    expect(first.version).toBe(0)
    expect(first.op).toBe('findOneAndUpdate')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')

    expect(first.doc).toHaveProperty('_id')
    expect(first.doc).toHaveProperty('name', 'Bob')
    expect(first.doc).not.toHaveProperty('role')

    // Upsert don't have createdAt and updatedAt and validation errors
    // Investigate this case later
    // expect(first.doc).not.toHaveProperty('createdAt')
    // expect(first.doc).not.toHaveProperty('updatedAt')

    expect(first.patch).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    // updated event is not emitted because it's an upsert
  })

  it('should update many', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    await User.updateMany({ role: 'user' }, { $set: { name: 'Bob' } }).exec()

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
    expect(first.doc).not.toHaveProperty('role')
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
    expect(second.doc).not.toHaveProperty('role')
    expect(second.doc).not.toHaveProperty('createdAt')
    expect(second.doc).not.toHaveProperty('updatedAt')

    expect(second.patch).toHaveLength(0)

    // 3 update
    expect(third.version).toBe(1)
    expect(third.op).toBe('updateMany')
    expect(third.modelName).toBe('User')
    expect(third.collectionName).toBe('users')
    expect(third.collectionId).toEqual(john._id)

    expect(third.doc).toBeUndefined()

    expect(third.patch).toHaveLength(2)
    expect(third.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'John' },
      { op: 'replace', path: '/name', value: 'Bob' },
    ])

    // 4 update
    expect(fourth.version).toBe(1)
    expect(fourth.op).toBe('updateMany')
    expect(fourth.modelName).toBe('User')
    expect(fourth.collectionName).toBe('users')
    expect(fourth.collectionId).toEqual(alice._id)

    expect(fourth.doc).toBeUndefined()

    expect(fourth.patch).toHaveLength(2)
    expect(fourth.patch).toMatchObject([
      { op: 'test', path: '/name', value: 'Alice' },
      { op: 'replace', path: '/name', value: 'Bob' },
    ])

    expect(em.emit).toHaveBeenCalledTimes(4)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: first.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc: second.doc })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: john._id, name: 'John', role: 'user' }),
      doc: expect.objectContaining({ _id: john._id, name: 'Bob', role: 'user' }),
      patch: third.patch,
    })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({ _id: alice._id, name: 'Alice', role: 'user' }),
      doc: expect.objectContaining({ _id: alice._id, name: 'Bob', role: 'user' }),
      patch: fourth.patch,
    })
  })
})
