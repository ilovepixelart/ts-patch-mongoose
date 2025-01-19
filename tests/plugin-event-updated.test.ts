import mongoose, { Types, model } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchHistoryPlugin } from '../src/plugin'
import { isMongooseLessThan7 } from '../src/version'

import em from '../src/em'
import { USER_UPDATED } from './constants/events'
import server from './mongo/server'

import { HistoryModel } from '../src/models/History'
import { type User, UserSchema } from './schemas/User'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

describe('plugin - event updated & patch history disabled', () => {
  const instance = server('plugin-event-updated')

  UserSchema.plugin(patchHistoryPlugin, {
    eventUpdated: USER_UPDATED,
    patchHistoryDisabled: true,
    omit: ['createdAt', 'updatedAt'],
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

  it('should save() and emit one update event', async () => {
    await UserModel.create({ name: 'Bob', role: 'user' })
    const user = new UserModel({ name: 'John', role: 'user' })
    const created = await user.save()

    user.name = 'John Doe'
    const updated = await user.save()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)

    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: 'John',
        role: 'user',
        createdAt: created.createdAt,
        updatedAt: created.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated._id,
        name: 'John Doe',
        role: 'user',
        createdAt: created.createdAt,
        updatedAt: updated.updatedAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' },
      ]),
    })

    // Confirm that the document is updated
    const users = await UserModel.find({})
    expect(users).toHaveLength(2)
    const [bob, john] = users
    expect(bob.name).toBe('Bob')
    expect(john.name).toBe('John Doe')
  })

  it('should update() and emit three update event', async () => {
    await UserModel.create(
      [
        { name: 'Alice', role: 'user' },
        { name: 'Bob', role: 'user' },
        { name: 'John', role: 'user' },
      ],
      { ordered: true },
    )

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await UserModel.update({ role: 'user' }, { role: 'manager' })
    } else {
      await UserModel.updateMany({ role: 'user' }, { role: 'manager' })
    }

    const users = await UserModel.find({ role: 'manager' })
    expect(users).toHaveLength(3)

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(3)

    // Confirm that the document is updated
    const updated = await UserModel.find({}).sort({ name: 1 })
    expect(updated).toHaveLength(3)
    const [alice, bob, john] = updated
    expect(alice.role).toBe('manager')
    expect(bob.role).toBe('manager')
    expect(john.role).toBe('manager')
  })

  it('should updateOne() and emit one update event', async () => {
    await UserModel.create(
      [
        { name: 'Alice', role: 'user' },
        { name: 'Bob', role: 'user' },
        { name: 'John', role: 'user' },
      ],
      { ordered: true },
    )

    await UserModel.updateOne({ name: 'Bob' }, { role: 'manager' })
    const users = await UserModel.find({ role: 'manager' })
    expect(users).toHaveLength(1)

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)

    // Confirm that the document is updated
    const updated = await UserModel.find({}).sort({ name: 1 })
    expect(updated).toHaveLength(3)
    const [alice, bob, john] = updated
    expect(alice.role).toBe('user')
    expect(bob.role).toBe('manager')
    expect(john.role).toBe('user')
  })

  it('should replaceOne() and emit two update event', async () => {
    await UserModel.create(
      [
        { name: 'Alice', role: 'user' },
        { name: 'Bob', role: 'user' },
        { name: 'John', role: 'user' },
      ],
      { ordered: true },
    )

    await UserModel.replaceOne({ name: 'Bob' }, { name: 'Bob Doe', role: 'manager' })
    const users = await UserModel.find({ role: 'manager' })
    expect(users).toHaveLength(1)

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: expect.any(Types.ObjectId),
        name: 'Bob',
        role: 'user',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: expect.any(Types.ObjectId),
        name: 'Bob Doe',
        role: 'manager',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/name', value: 'Bob' },
        { op: 'replace', path: '/name', value: 'Bob Doe' },
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
      ]),
    })

    // Confirm that the document is updated
    const updated = await UserModel.find({}).sort({ name: 1 })
    expect(updated).toHaveLength(3)
    const [alice, bob, john] = updated
    expect(alice.role).toBe('user')
    expect(bob.role).toBe('manager')
    expect(john.role).toBe('user')
  })

  it('should updateMany() and emit two update event', async () => {
    await UserModel.create(
      [
        { name: 'Alice', role: 'user' },
        { name: 'Bob', role: 'user' },
        { name: 'John', role: 'user' },
      ],
      { ordered: true },
    )

    await UserModel.updateMany({ role: 'user' }, { role: 'manager' })
    const users = await UserModel.find({ role: 'manager' })
    expect(users).toHaveLength(3)

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(3)

    // Confirm that the document is updated
    const updated = await UserModel.find({}).sort({ name: 1 })
    expect(updated).toHaveLength(3)
    const [alice, bob, john] = updated
    expect(alice.role).toBe('manager')
    expect(bob.role).toBe('manager')
    expect(john.role).toBe('manager')
  })

  it('should findOneAndUpdate() and emit one update event', async () => {
    await UserModel.create({ name: 'Bob', role: 'user' })
    const created = await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.findOneAndUpdate({ _id: created._id }, { name: 'John Doe', role: 'manager' })
    const updated = await UserModel.findById(created._id).exec()
    expect(updated).not.toBeNull()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated?._id,
        name: updated?.name,
        role: updated?.role,
        createdAt: created.createdAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' },
      ]),
    })

    // Confirm that the document is updated
    expect(updated?.name).toBe('John Doe')
    expect(updated?.role).toBe('manager')
  })

  it('should findOneAndReplace() and emit one update event', async () => {
    await UserModel.create({ name: 'Bob', role: 'user' })
    const created = await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.findOneAndReplace({ _id: created._id }, { name: 'John Doe', role: 'manager' })
    const updated = await UserModel.findById(created._id).exec()
    expect(updated).not.toBeNull()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt,
        updatedAt: created.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated?._id,
        name: updated?.name,
        role: updated?.role,
        createdAt: updated?.createdAt,
        updatedAt: updated?.updatedAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' },
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
      ]),
    })

    // Confirm that the document is updated
    expect(updated?.name).toBe('John Doe')
    expect(updated?.role).toBe('manager')
  })

  it('should findByIdAndUpdate() and emit one update event', async () => {
    const created = await UserModel.create({ name: 'Bob', role: 'user' })
    await UserModel.findByIdAndUpdate(created._id, { name: 'John Doe', role: 'manager' })

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: 'John Doe',
        role: 'manager',
        createdAt: created.createdAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/name', value: 'Bob' },
        { op: 'replace', path: '/name', value: 'John Doe' },
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
      ]),
    })

    // Confirm that the document is updated
    const updated = await UserModel.findById(created._id).exec()
    expect(updated?.name).toBe('John Doe')
    expect(updated?.role).toBe('manager')
  })

  it('should update and emit one update event', async () => {
    await UserModel.create({ name: 'Bob', role: 'user' })
    const created = await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.updateOne({ _id: created._id }, { name: 'John Doe', role: 'manager' })
    const updated = await UserModel.findById(created._id).exec()
    expect(updated).not.toBeNull()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated?._id,
        name: updated?.name,
        role: updated?.role,
        createdAt: created.createdAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' },
      ]),
    })

    // Confirm that the document is updated
    expect(updated?.name).toBe('John Doe')
    expect(updated?.role).toBe('manager')
  })

  it('should updateMany and emit two update events', async () => {
    const created1 = await UserModel.create({ name: 'John', role: 'user' })
    const created2 = await UserModel.create({ name: 'Bob', role: 'user' })
    await UserModel.updateMany({}, { name: 'John Doe', role: 'manager' })
    const updated1 = await UserModel.findById(created1._id).exec()
    expect(updated1).not.toBeNull()
    const updated2 = await UserModel.findById(created2._id).exec()
    expect(updated2).not.toBeNull()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(2)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created1._id,
        name: created1.name,
        role: created1.role,
        createdAt: created1.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated1?._id,
        name: updated1?.name,
        role: updated1?.role,
        createdAt: created1.createdAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'John' },
        { op: 'replace', path: '/name', value: 'John Doe' },
      ]),
    })
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created2._id,
        name: created2.name,
        role: created2.role,
        createdAt: created2.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated2?._id,
        name: updated2?.name,
        role: updated2?.role,
        createdAt: created2.createdAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
        { op: 'test', path: '/name', value: 'Bob' },
        { op: 'replace', path: '/name', value: 'John Doe' },
      ]),
    })

    // Confirm that the documents are updated
    expect(updated1?.name).toBe('John Doe')
    expect(updated1?.role).toBe('manager')

    expect(updated2?.name).toBe('John Doe')
    expect(updated2?.role).toBe('manager')
  })

  it('should findOneAndUpdate $set and emit one update event', async () => {
    const created = await UserModel.create({ name: 'Bob', role: 'user' })
    await UserModel.findOneAndUpdate({ _id: created._id }, { $set: { name: 'John Doe', role: 'manager' } })
    const updated = await UserModel.findById(created._id).exec()
    expect(updated).not.toBeNull()
    expect(updated?.name).toBe('John Doe')
    expect(updated?.role).toBe('manager')

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(1)
    expect(em.emit).toHaveBeenCalledWith(USER_UPDATED, {
      oldDoc: expect.objectContaining({
        __v: 0,
        _id: created._id,
        name: created.name,
        role: created.role,
        createdAt: created.createdAt,
      }),
      doc: expect.objectContaining({
        __v: 0,
        _id: updated?._id,
        name: updated?.name,
        role: updated?.role,
        createdAt: created.createdAt,
      }),
      patch: expect.arrayContaining([
        { op: 'test', path: '/name', value: 'Bob' },
        { op: 'replace', path: '/name', value: 'John Doe' },
        { op: 'test', path: '/role', value: 'user' },
        { op: 'replace', path: '/role', value: 'manager' },
      ]),
    })

    // Confirm that the document is updated
    expect(updated?.name).toBe('John Doe')
    expect(updated?.role).toBe('manager')
  })

  it('should ignoreHook option on updateMany', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.updateMany({ role: 'user' }, { role: 'admin' }, { ignoreHook: true }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)

    // Confirm that the document is updated
    const updated = await UserModel.findById(john._id).exec()
    expect(updated?.role).toBe('admin')
  })
})
