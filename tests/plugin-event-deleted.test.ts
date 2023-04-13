import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { USER_DELETED } from './constants/events'

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
    await john.remove()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
  })

  it('should remove() and emit two delete events', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john, alice] = users

    await User.remove({ role: 'user' }).exec()

    const remaining = await User.find({})

    expect(remaining).toHaveLength(1)

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(alice.toObject({ depopulate: true }))
    })
  })

  it('should remove() and emit one delete event { single: true }', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.remove({ role: 'user' }, { single: true }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
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
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
  })

  it('should findOneAndRemove() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.findOneAndRemove({ role: 'user' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
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
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
  })

  it('should findByIdAndRemove() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.findByIdAndRemove(john._id).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
  })

  it('should deleteOne() and emit one delete event', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.deleteOne({ role: 'user' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
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
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(alice.toObject({ depopulate: true }))
    })
  })

  it('should deleteMany() and emit one delete event { single: true }', async () => {
    const users = await User.create([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'admin' }
    ])

    const [john] = users

    await User.deleteMany({ role: 'user' }, { single: true }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
  })

  it('should create then delete and emit one delete event', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    await john.delete()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: expect.objectContaining(john.toObject({ depopulate: true }))
    })
  })
})
