/* eslint-disable @typescript-eslint/no-unused-vars */
import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'

import { USER_CREATED } from './constants/events'

import em from '../src/em'

jest.mock('../src/em', () => {
  return { emit: jest.fn() }
})

describe('plugin - preSave test', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventCreated: USER_CREATED,
    omit: ['__v', 'role'],
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

  it('should create a User and execute save, and omit User role in history', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
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
