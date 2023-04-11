import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { USER_UPDATED } from './constants/events'

jest.mock('../src/em', () => {
  return {
    emit: jest.fn((name, data) => console.log('emit', name, data))
  }
})

describe('plugin - event updated & patch history disabled', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventUpdated: USER_UPDATED,
    patchHistoryDisabled: true,
    omit: ['createdAt', 'updatedAt']
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

  it('should save/save and emit one update event', async () => {
    const user = new User({ name: 'John', role: 'user' })
    const created = await user.save()

    user.name = 'John Doe'
    const updated = await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)

    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: 'John',
        role: 'user',
        createdAt: created.createdAt,
        updatedAt: created.createdAt
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated._id,
        name: 'John Doe',
        role: 'user',
        createdAt: created.createdAt,
        updatedAt: updated.updatedAt
      }),
      patch: expect.arrayContaining([
        {
          op: 'test',
          path: '/name',
          value: 'John'
        },
        {
          op: 'replace',
          path: '/name',
          value: 'John Doe'
        }
      ])
    })
  })
})
