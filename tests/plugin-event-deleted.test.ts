import { isMongooseLessThan7 } from '../src/version'
import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { USER_DELETED } from './constants/events'
import { toObjectOptions } from '../src/helpers'

jest.mock('../src/em', () => {
  return {
    emit: jest.fn()
  }
})


describe('plugin - event delete & patch history disabled', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventDeleted: USER_DELETED,
    patchHistoryDisabled: true
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

  it('should remove() and emit one delete event', async () => {
    const john = await User.create({ name: 'John', role: 'user' })

    if (isMongooseLessThan7) {
      await john.remove()
    } else {
      await john.deleteOne()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const user = await User.findById(john._id)
    expect(user).toBeNull()
  })

  it('should remove() and emit two delete events', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john, alice] = users

    if (isMongooseLessThan7) {
      await User.remove({ role: 'user' }).exec()
    } else {
      await User.deleteMany({ role: 'user' }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(alice.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const deletedAlice = await User.findById(alice._id)
    expect(deletedAlice).toBeNull()

    const remaining = await User.find({})
    expect(remaining).toHaveLength(1)
  })

  it('should remove() and emit one delete event { single: true }', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      await User.remove({ role: 'user' }, { single: true }).exec()
    } else {
      await User.deleteOne({ role: 'user' }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({})
    expect(remaining).toHaveLength(2)
  })

  it('should findOneAndDelete() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.findOneAndDelete({ role: 'user' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({})
    expect(remaining).toHaveLength(2)
  })

  it('should findOneAndRemove() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      await User.findOneAndRemove({ role: 'user' }).exec()
    } else {
      await User.findOneAndDelete({ role: 'user' }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should findByIdAndDelete() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.findByIdAndDelete(john._id).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should findByIdAndRemove() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      await User.findByIdAndRemove(john._id).exec()
    } else {
      await User.findByIdAndDelete(john._id).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should deleteOne() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.deleteOne({ role: 'user' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({ name: { $in: ['Alice', 'Bob'] } })
    expect(remaining).toHaveLength(2)
  })

  it('should deleteMany() and emit two delete events', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john, alice] = users

    await User.deleteMany({ role: 'user' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(alice.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const deletedAlice = await User.findById(alice._id)
    expect(deletedAlice).toBeNull()

    const remaining = await User.find({})
    expect(remaining).toHaveLength(1)
  })

  it('should deleteMany() and emit one delete event { single: true }', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    if (isMongooseLessThan7) {
      await User.deleteMany({ role: 'user' }, { single: true }).exec()
    } else {
      await User.deleteOne({ role: 'user' }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({})
    expect(remaining).toHaveLength(2)
  })

  it('should create then delete and emit one delete event', async () => {
    const john = await User.create({ name: 'John', role: 'user' })

    if (isMongooseLessThan7) {
      await john.delete()
    } else {
      await john.deleteOne()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject(toObjectOptions))
    })

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({})
    expect(remaining).toHaveLength(0)
  })

  it('should ignoreHook option on deleteMany', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    await User.deleteMany({ role: 'user' }, { ignoreHook: true }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()
  })

  it('should ignoreHook option on deleteOne', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    await User.deleteOne({ role: 'user' }, { ignoreHook: true }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)

    // Check if data is deleted
    const deletedJohn = await User.findById(john._id)
    expect(deletedJohn).toBeNull()

    const remaining = await User.find({})
    expect(remaining).toHaveLength(0)
  })
})
