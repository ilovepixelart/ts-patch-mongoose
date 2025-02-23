import mongoose, { model } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchHistoryPlugin } from '../src/index'
import { isMongooseLessThan7 } from '../src/version'

import em from '../src/em'
import server from './mongo/server'

import { HistoryModel } from '../src/model'
import { type User, UserSchema } from './schemas/User'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

describe('plugin - patch history disabled', () => {
  const instance = server('plugin-patch-history-disabled')

  UserSchema.plugin(patchHistoryPlugin, {
    patchHistoryDisabled: true,
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

  it('should createHistory', async () => {
    const user = await UserModel.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.name = 'Alice'
    await user.save()

    user.name = 'Bob'
    await user.save()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    await UserModel.deleteMany({ role: 'user' }).exec()

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should omit update of role', async () => {
    const user = await UserModel.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.role = 'manager'
    await user.save()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should updateOne', async () => {
    const user = await UserModel.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await UserModel.updateOne({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should findOneAndUpdate', async () => {
    const user = await UserModel.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await UserModel.findOneAndUpdate({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should update deprecated', async () => {
    const user = await UserModel.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await UserModel.update({ _id: user._id }, { $set: { name: 'Alice' } }).exec()
    } else {
      await UserModel.findOneAndUpdate({ _id: user._id }, { $set: { name: 'Alice' } }).exec()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)
  })

  it('should updated deprecated with multi flag', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await UserModel.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await UserModel.update({ role: 'user' }, { $set: { name: 'Bob' } }, { multi: true }).exec()
    } else {
      await UserModel.updateMany({ role: 'user' }, { $set: { name: 'Bob' } }).exec()
    }

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should create many', async () => {
    await UserModel.create({ name: 'John', role: 'user' })
    await UserModel.create({ name: 'Alice', role: 'user' })

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should findOneAndUpdate upsert', async () => {
    await UserModel.findOneAndUpdate({ name: 'John', role: 'user' }, { name: 'Bob', role: 'user' }, { upsert: true, runValidators: true }).exec()
    const documents = await UserModel.find({})
    expect(documents).toHaveLength(1)

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should update many', async () => {
    const john = await UserModel.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await UserModel.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    await UserModel.updateMany({ role: 'user' }, { $set: { name: 'Bob' } }).exec()

    const history = await HistoryModel.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })
})
