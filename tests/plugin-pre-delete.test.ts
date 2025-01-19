import mongoose, { model } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchHistoryPlugin } from '../src/plugin'
import { isMongooseLessThan7 } from '../src/version'

import em from '../src/em'
import { USER_DELETED } from './constants/events'
import server from './mongo/server'

import { type User, UserSchema } from './schemas/User'

const preDeleteMock = vi.fn()

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

describe('plugin - preDelete test', () => {
  const instance = server('plugin-pre-delete')

  UserSchema.plugin(patchHistoryPlugin, {
    eventDeleted: USER_DELETED,
    patchHistoryDisabled: true,
    preDelete: preDeleteMock,
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

  it('should deleteMany and execute preDelete', async () => {
    await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.create({ name: 'Jane', role: 'user' })
    await UserModel.create({ name: 'Jack', role: 'user' })

    const users = await UserModel.find({}).sort().lean().exec()
    expect(users).toHaveLength(3)

    const [john, jane, jack] = users

    await UserModel.deleteMany({ role: 'user' })
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
        updatedAt: jane?.updatedAt,
      },
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt,
      },
    })
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: jack?._id,
        name: 'Jack',
        role: 'user',
        createdAt: jack?.createdAt,
        updatedAt: jack?.updatedAt,
      },
    })
  })

  it('should deleteOne and execute preDelete', async () => {
    await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.create({ name: 'Jane', role: 'user' })
    await UserModel.create({ name: 'Jack', role: 'user' })

    const users = await UserModel.find({}).sort().lean().exec()
    expect(users).toHaveLength(3)

    const [john] = users

    await UserModel.deleteOne({ name: 'John' })
    expect(preDeleteMock).toHaveBeenCalledTimes(1)
    expect(preDeleteMock).toHaveBeenCalledWith([
      {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt,
      },
    ])

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt,
      },
    })
  })

  it('should remove and execute preDelete', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
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
        updatedAt: john?.updatedAt,
      },
    ])

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_DELETED, {
      oldDoc: {
        __v: 0,
        _id: john?._id,
        name: 'John',
        role: 'user',
        createdAt: john?.createdAt,
        updatedAt: john?.updatedAt,
      },
    })
  })
})
