import mongoose, { model } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { toObjectOptions } from '../src/helpers'
import { patchHistoryPlugin } from '../src/index'
import { HistoryModel } from '../src/model'
import { isMongooseLessThan7 } from '../src/version'

import em from '../src/em'
import { USER_DELETED } from './constants/events'
import server from './mongo/server'

import { type User, UserSchema } from './schemas/User'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

describe('plugin - event delete & patch history disabled', () => {
  const instance = server('plugin-event-deleted')

  UserSchema.plugin(patchHistoryPlugin, {
    eventDeleted: USER_DELETED,
    patchHistoryDisabled: true,
  })

  const UserModel = model<User>('User', UserSchema)

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('users').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  afterEach(async () => {
    vi.resetAllMocks()
  })

  it('should remove() and emit one delete event', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await john.remove()
    } else {
      await john.deleteOne()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const user = await UserModel.findById(john._id)
    expect(user).toBeNull()
  })

  it('should remove() and emit two delete events', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john, alice] = users

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await UserModel.remove({ role: 'user' }).exec()
    } else {
      await UserModel.deleteMany({ role: 'user' }).exec()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(alice.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const deletedAlice = await UserModel.findById(alice._id)
    expect(deletedAlice).toBeNull()

    const remaining = await UserModel.find({})
    expect(remaining).toHaveLength(1)
  })

  it('should remove() and emit one delete event { single: true }', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await UserModel.remove({ role: 'user', name: 'John' }, { single: true }).exec()
    } else {
      await UserModel.deleteOne({ role: 'user', name: 'John' }).exec()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({})
    expect(remaining).toHaveLength(2)
  })

  it('should findOneAndDelete() and emit one delete event', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john] = users

    await UserModel.findOneAndDelete({ name: 'John' }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({})
    expect(remaining).toHaveLength(2)
  })

  it('should findOneAndRemove() and emit one delete event', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await UserModel.findOneAndRemove({ role: 'user' }).exec()
    } else {
      await UserModel.findOneAndDelete({ role: 'user' }).exec()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should findByIdAndDelete() and emit one delete event', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john] = users

    await UserModel.findByIdAndDelete(john._id).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should findByIdAndRemove() and emit one delete event', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await UserModel.findByIdAndRemove(john._id).exec()
    } else {
      await UserModel.findByIdAndDelete(john._id).exec()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should deleteOne() and emit one delete event', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john] = users

    await UserModel.deleteOne({ role: 'user' }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should deleteMany() and emit two delete events', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john, alice] = users

    await UserModel.deleteMany({ role: 'user' }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(alice.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const deletedAlice = await UserModel.findById(alice._id)
    expect(deletedAlice).toBeNull()

    const remaining = await UserModel.find({})
    expect(remaining).toHaveLength(1)
  })

  it('should deleteMany() and emit one delete event { single: true }', async () => {
    const users = await UserModel.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' },
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      await UserModel.deleteMany({ name: 'John' }, { single: true }).exec()
    } else {
      await UserModel.deleteOne({ name: 'John' }).exec()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({})
    expect(remaining).toHaveLength(2)
  })

  it('should create then delete and emit one delete event', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await john.delete()
    } else {
      await john.deleteOne()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions)),
    })

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({})
    expect(remaining).toHaveLength(0)
  })

  it('should ignoreHook option on deleteMany', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.deleteMany({ role: 'user' }, { ignoreHook: true }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()
  })

  it('should ignoreHook option on deleteOne', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.deleteOne({ role: 'user' }, { ignoreHook: true }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)

    // Check if data is deleted
    const deletedJohn = await UserModel.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await UserModel.find({})
    expect(remaining).toHaveLength(0)
  })
})
