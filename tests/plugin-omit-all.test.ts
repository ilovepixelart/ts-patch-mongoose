import { isMongooseLessThan7 } from '../src/version'

import mongoose, { Types, model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'

jest.mock('../src/em', () => {
  return { emit: jest.fn() }
})

describe('plugin - omit all', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    omit: ['__v', 'name', 'role', 'createdAt', 'updatedAt']
  })

  const User = model('User', UserSchema)

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
    expect(history).toHaveLength(2)

    const [first, second] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id', user._id)

    expect(second.op).toBe('deleteMany')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(user._id)
    expect(second.version).toBe(0)
    expect(second.patch).toHaveLength(0)

    expect(second.doc).toHaveProperty('name', 'Bob')
    expect(second.doc).toHaveProperty('role', 'user')
    expect(second.doc).toHaveProperty('createdAt')
    expect(second.doc).toHaveProperty('updatedAt')
    expect(second.doc).toHaveProperty('_id', user._id)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should omit update of role', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.role = 'manager'
    await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(1)

    const [first] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id', user._id)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should updateOne', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await User.updateOne({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(1)

    const [first] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id', user._id)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should findOneAndUpdate', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await User.findOneAndUpdate({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(1)

    const [first] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id', user._id)

    expect(em.emit).toHaveBeenCalledTimes(0)
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
    expect(history).toHaveLength(1)

    const [first] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(user._id)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id', user._id)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should updated deprecated with multi flag', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    if (isMongooseLessThan7) {
      await User.update({ role: 'user' }, { $set: { name: 'Bob' } }, { multi: true }).exec()
    } else {
      await User.updateMany({ role: 'user' }, { $set: { name: 'Bob' } }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(john._id)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id', john._id)

    expect(second.op).toBe('create')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(alice._id)
    expect(second.version).toBe(0)
    expect(second.patch).toHaveLength(0)

    expect(second.doc).toHaveProperty('name', 'Alice')
    expect(second.doc).toHaveProperty('role', 'user')
    expect(second.doc).toHaveProperty('createdAt')
    expect(second.doc).toHaveProperty('updatedAt')
    expect(second.doc).toHaveProperty('_id', alice._id)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should create many', async () => {
    await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' }
    ])

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toBeInstanceOf(Types.ObjectId)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id')

    expect(second.op).toBe('create')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toBeInstanceOf(Types.ObjectId)
    expect(second.version).toBe(0)
    expect(second.patch).toHaveLength(0)

    expect(second.doc).toHaveProperty('name', 'Alice')
    expect(second.doc).toHaveProperty('role', 'user')
    expect(second.doc).toHaveProperty('createdAt')
    expect(second.doc).toHaveProperty('updatedAt')
    expect(second.doc).toHaveProperty('_id')

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should findOneAndUpdate upsert', async () => {
    await User.findOneAndUpdate({ name: 'John', role: 'user' }, { name: 'Bob', role: 'user' }, { upsert: true, runValidators: true }).exec()
    const documents = await User.find({})
    expect(documents).toHaveLength(1)

    const history = await History.find({})
    expect(history).toHaveLength(1)

    const [first] = history

    expect(first.op).toBe('findOneAndUpdate')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toBeInstanceOf(Types.ObjectId)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'Bob')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('_id')

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should update many', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    await User.updateMany({ role: 'user' }, { $set: { name: 'Bob' } }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    expect(first.op).toBe('create')
    expect(first.modelName).toBe('User')
    expect(first.collectionName).toBe('users')
    expect(first.collectionId).toEqual(john._id)
    expect(first.version).toBe(0)
    expect(first.patch).toHaveLength(0)

    expect(first.doc).toHaveProperty('name', 'John')
    expect(first.doc).toHaveProperty('role', 'user')
    expect(first.doc).toHaveProperty('createdAt')
    expect(first.doc).toHaveProperty('updatedAt')
    expect(first.doc).toHaveProperty('_id', john._id)

    expect(second.op).toBe('create')
    expect(second.modelName).toBe('User')
    expect(second.collectionName).toBe('users')
    expect(second.collectionId).toEqual(alice._id)
    expect(second.version).toBe(0)
    expect(second.patch).toHaveLength(0)

    expect(second.doc).toHaveProperty('name', 'Alice')
    expect(second.doc).toHaveProperty('role', 'user')
    expect(second.doc).toHaveProperty('createdAt')
    expect(second.doc).toHaveProperty('updatedAt')
    expect(second.doc).toHaveProperty('_id', alice._id)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })
})
