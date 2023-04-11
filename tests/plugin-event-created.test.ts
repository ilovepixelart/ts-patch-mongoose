import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { USER_CREATED } from './constants/events'

jest.mock('../src/em', () => {
  return {
    emit: jest.fn()
  }
})

describe('plugin - event created & patch history disabled', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventCreated: USER_CREATED,
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

  it('should save and emit one create event', async () => {
    const john = new User({ name: 'John', role: 'user' })
    await john.save()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
      doc: expect.objectContaining({
        _id: john._id,
        name: john.name,
        role: john.role,
        createdAt: john.createdAt,
        updatedAt: john.updatedAt
      })
    })
  })

  it('should create and emit one create event', async () => {
    const user = await User.create({ name: 'John', role: 'user' })

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
      doc: expect.objectContaining({
        _id: user._id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      })
    })
  })

  it('should insertMany and emit one create event', async () => {
    const [user] = await User.insertMany([{ name: 'John', role: 'user' }])

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
      doc: expect.objectContaining({
        _id: user._id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      })
    })
  })

  it('should insertMany and emit three create events', async () => {
    const users = await User.insertMany([
      { name: 'John', role: 'user' },
      { name: 'Alice', role: 'user' },
      { name: 'Bob', role: 'user' }
    ])

    const [john, alice, bob] = users

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(3)
    expect(em.emit).toHaveBeenNthCalledWith(1, USER_CREATED, {
      doc: expect.objectContaining({
        _id: john._id,
        name: john.name,
        role: john.role,
        createdAt: john.createdAt,
        updatedAt: john.updatedAt
      })
    })
    expect(em.emit).toHaveBeenNthCalledWith(2, USER_CREATED, {
      doc: expect.objectContaining({
        _id: alice._id,
        name: alice.name,
        role: alice.role,
        createdAt: alice.createdAt,
        updatedAt: alice.updatedAt
      })
    })
    expect(em.emit).toHaveBeenNthCalledWith(3, USER_CREATED, {
      doc: expect.objectContaining({
        _id: bob._id,
        name: bob.name,
        role: bob.role,
        createdAt: bob.createdAt,
        updatedAt: bob.updatedAt
      })
    })
  })
})
