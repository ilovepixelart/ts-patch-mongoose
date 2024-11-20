import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { isMongooseLessThan7 } from '../src/version'

import mongoose, { model } from 'mongoose'

import History from '../src/models/History'
import { patchHistoryPlugin } from '../src/plugin'
import UserSchema from './schemas/UserSchema'

import em from '../src/em'
import server from './mongo/server'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

describe('plugin - patch history disabled', () => {
  const instance = server('plugin-patch-history-disabled')

  UserSchema.plugin(patchHistoryPlugin, {
    patchHistoryDisabled: true,
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

  it('should createHistory', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.name = 'Alice'
    await user.save()

    user.name = 'Bob'
    await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    await User.deleteMany({ role: 'user' }).exec()

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should omit update of role', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.role = 'manager'
    await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should updateOne', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await User.updateOne({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should findOneAndUpdate', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await User.findOneAndUpdate({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should update deprecated', async () => {
    const user = await User.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await User.update({ _id: user._id }, { $set: { name: 'Alice' } }).exec()
    } else {
      await User.findOneAndUpdate({ _id: user._id }, { $set: { name: 'Alice' } }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)
  })

  it('should updated deprecated with multi flag', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    if (isMongooseLessThan7) {
      // @ts-expect-error not available in Mongoose 6 and below
      await User.update({ role: 'user' }, { $set: { name: 'Bob' } }, { multi: true }).exec()
    } else {
      await User.updateMany({ role: 'user' }, { $set: { name: 'Bob' } }).exec()
    }

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should create many', async () => {
    await User.create({ name: 'John', role: 'user' })
    await User.create({ name: 'Alice', role: 'user' })

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should findOneAndUpdate upsert', async () => {
    await User.findOneAndUpdate({ name: 'John', role: 'user' }, { name: 'Bob', role: 'user' }, { upsert: true, runValidators: true }).exec()
    const documents = await User.find({})
    expect(documents).toHaveLength(1)

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })

  it('should update many', async () => {
    const john = await User.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await User.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    await User.updateMany({ role: 'user' }, { $set: { name: 'Bob' } }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(0)

    expect(em.emit).toHaveBeenCalledTimes(0)
  })
})
