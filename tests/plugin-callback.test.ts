import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'

import { USER_CREATED } from './constants/events'

const preDeleteCallbackMock = jest.fn()

describe('plugin - event created & patch history disabled', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventCreated: USER_CREATED,
    patchHistoryDisabled: true,
    preDeleteCallback: preDeleteCallbackMock
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

  it('should deleteMany and execute preDeleteCallback', async () => {
    await User.create([
      { name: 'John', role: 'user' },
      { name: 'Jane', role: 'user' },
      { name: 'Jack', role: 'user' }
    ])

    const users = await User.find({})
    expect(users).toHaveLength(3)

    const [john, jane, jack] = users

    await User.deleteMany({ role: 'user' })
    expect(preDeleteCallbackMock).toHaveBeenCalledTimes(1)
    expect(preDeleteCallbackMock).toHaveBeenCalledWith([john, jane, jack])
  })
})
