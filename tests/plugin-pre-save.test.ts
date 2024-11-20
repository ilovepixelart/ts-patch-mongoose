import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose, { model } from 'mongoose'

import { patchHistoryPlugin } from '../src/plugin'
import UserSchema from './schemas/UserSchema'

import { USER_CREATED } from './constants/events'

import em from '../src/em'
import server from './mongo/server'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() }}))

describe('plugin - preSave test', () => {
  const instance = server('plugin-pre-save')

  UserSchema.plugin(patchHistoryPlugin, {
    eventCreated: USER_CREATED,
    omit: ['__v', 'role'],
  })

  const User = model('User', UserSchema)

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

  it('should create a User and execute save, and omit User role in history', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    // @ts-expect-error __v is a hidden field in Mongoose model
    const { __v, role, ...doc } = john.toJSON()

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, { doc })

    expect(john).toMatchObject({ name: 'John', role: 'user' })

    const entry = await mongoose.connection.collection('history').findOne({ collectionId: john._id })
    expect(entry).not.toBeNull()
    expect(entry?.doc).toMatchObject({ name: 'John' })
    expect(entry?.doc.role).toBeUndefined()
    expect(entry?.patch).toEqual([])
  })
})
