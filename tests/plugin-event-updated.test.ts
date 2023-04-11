import mongoose, { model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { USER_UPDATED } from './constants/events'

jest.mock('../src/em', () => {
  return {
    emit: jest.fn()
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
    await User.create({ name: 'Bob', role: 'user' })
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
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' }
      ])
    })
  })

  it('should findOneAndReplace and emit one update event', async () => {
    await User.create({ name: 'Bob', role: 'user' })
    const created = await User.create({ name: 'John', role: 'user' })
    await User.findOneAndReplace({ _id: created._id }, { name: 'John Doe', role: 'manager' })
    const updated = await User.findById(created._id).exec()
    expect(updated).not.toBeNull()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt,
        updatedAt: created.createdAt
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated?._id,
        name: updated?.name,
        role: updated?.role,
        createdAt: updated?.createdAt,
        updatedAt: updated?.updatedAt
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' },
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' }
      ])
    })
  })

  it('should findOneAndUpdate and emit one update event', async () => {
    await User.create({ name: 'Bob', role: 'user' })
    const created = await User.create({ name: 'John', role: 'user' })
    await User.findOneAndUpdate({ _id: created._id }, { name: 'John Doe', role: 'manager' })
    const updated = await User.findById(created._id).exec()
    expect(updated).not.toBeNull()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated?._id,
        name: updated?.name,
        role: updated?.role,
        createdAt: created.createdAt
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' }
      ])
    })
  })

  it('should update and emit one update event', async () => {
    await User.create({ name: 'Bob', role: 'user' })
    const created = await User.create({ name: 'John', role: 'user' })
    await User.updateOne({ _id: created._id }, { name: 'John Doe', role: 'manager' })
    const updated = await User.findById(created._id).exec()
    expect(updated).not.toBeNull()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated?._id,
        name: updated?.name,
        role: updated?.role,
        createdAt: created.createdAt
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' }
      ])
    })
  })

  it('should updateMany and emit two update events', async () => {
    const created1 = await User.create({ name: 'John', role: 'user' })
    const created2 = await User.create({ name: 'Bob', role: 'user' })
    await User.updateMany({}, { name: 'John Doe', role: 'manager' })
    const updated1 = await User.findById(created1._id).exec()
    expect(updated1).not.toBeNull()
    const updated2 = await User.findById(created2._id).exec()
    expect(updated2).not.toBeNull()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created1._id,
        name: created1.name,
        role: created1.role,
        createdAt: created1.createdAt
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated1?._id,
        name: updated1?.name,
        role: updated1?.role,
        createdAt: created1.createdAt
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' }
      ])
    })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created2._id,
        name: created2.name,
        role: created2.role,
        createdAt: created2.createdAt
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated2?._id,
        name: updated2?.name,
        role: updated2?.role,
        createdAt: created2.createdAt
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'Bob' },
        { op: 'replace', path: '/name', value: 'John Doe' }
      ])
    })
  })
})
