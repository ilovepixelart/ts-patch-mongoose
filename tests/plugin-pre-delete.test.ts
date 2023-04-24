import { isMongooseLessThan7 } from '../src/version'
import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'

import { USER_DELETED } from './constants/events'

import em from '../src/em'

const preDeleteMock = jest.fn()

jest.mock('../src/em', () => {
  return { emit: jest.fn() }
})

describe('plugin - preDelete test', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventDeleted: USER_DELETED,
    patchHistoryDisabled: true,
    preDelete: preDeleteMock
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

  it('should deleteMany and execute preDelete', async () => {
    await User.create({ name: 'John', role: 'user' })
    await User.create({ name: 'Jane', role: 'user' })
    await User.create({ name: 'Jack', role: 'user' })

    const users = await User.find({}).sort().lean().exec()
    expect(users).toHaveLength(3)

    const [john, jane, jack] = users

    await User.deleteMany({ role: 'user' })
    expect(preDeleteMock).toHaveBeenCalledTimes(1)
    expect(preDeleteMock).toHaveBeenCalledWith([john, jane, jack])

    expect(em.emit).toHaveBeenCalledTimes(3)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: jane?._id,
        name: 'Jane',
        role: 'user',
        createdAt: jane?.createdAt,
        updatedAt: jane?.updatedAt
      }
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt
      }
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: jack?._id,
        name: 'Jack',
        role: 'user',
        createdAt: jack?.createdAt,
        updatedAt: jack?.updatedAt
      }
    })
  })

  it('should deleteOne and execute preDelete', async () => {
    await User.create({ name: 'John', role: 'user' })
    await User.create({ name: 'Jane', role: 'user' })
    await User.create({ name: 'Jack', role: 'user' })

    const users = await User.find({}).sort().lean().exec()
    expect(users).toHaveLength(3)

    const [john] = users

    await User.deleteOne({ name: 'John' })
    expect(preDeleteMock).toHaveBeenCalledTimes(1)
    expect(preDeleteMock).toHaveBeenCalledWith([
      {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt
      }
    ])

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt
      }
    })
  })

  it('should remove and execute preDelete', async () => {
    const john = await User.create({ name: 'John', role: 'user' })

    if (isMongooseLessThan7) {
      await john?.remove()
    } else {
      await john?.deleteOne()
    }

    expect(preDeleteMock).toHaveBeenCalledTimes(1)
    expect(preDeleteMock).toHaveBeenCalledWith([
      {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt
      }
    ])

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt
      }
    })
  })
})
