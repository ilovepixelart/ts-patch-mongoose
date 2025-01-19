import mongoose, { Types, model } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchHistoryPlugin } from '../src/plugin'
import { isMongooseLessThan7 } from '../src/version'

import em from '../src/em'
import { USER_CREATED } from './constants/events'
import server from './mongo/server'

import { HistoryModel } from '../src/models/History'
import { type User, UserSchema } from './schemas/User'

vi.mock('../src/em', () => ({ default: { emit: vi.fn((event: string, data: Record<string, unknown>) => console.log(event, data)) } }))

describe('plugin - event created & patch history disabled', () => {
  const instance = server('plugin-event-created')

  UserSchema.plugin(patchHistoryPlugin, {
    eventCreated: USER_CREATED,
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('normal cases', () => {
    it('should save() and emit one create event', async () => {
      const john = new UserModel({ name: 'John', role: 'user' })
      await john.save()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: john._id,
          name: john.name,
          role: john.role,
          createdAt: john.createdAt,
          updatedAt: john.updatedAt,
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('user')
    })

    it('should create() and emit one create event', async () => {
      const user = await UserModel.create({ name: 'John', role: 'user' })

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: user._id,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('user')
    })

    it('should insertMany() and emit three create events', async () => {
      const users = await UserModel.insertMany(
        [
          { name: 'John', role: 'user' },
          { name: 'Alice', role: 'user' },
          { name: 'Bob', role: 'user' },
        ],
        { ordered: true },
      )

      const [john, alice, bob] = users

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(3)
      expect(em.emit).toHaveBeenNthCalledWith(1, USER_CREATED, {
        doc: expect.objectContaining({
          _id: john._id,
          name: john.name,
          role: john.role,
          createdAt: john.createdAt,
          updatedAt: john.updatedAt,
        }),
      })
      expect(em.emit).toHaveBeenNthCalledWith(2, USER_CREATED, {
        doc: expect.objectContaining({
          _id: alice._id,
          name: alice.name,
          role: alice.role,
          createdAt: alice.createdAt,
          updatedAt: alice.updatedAt,
        }),
      })
      expect(em.emit).toHaveBeenNthCalledWith(3, USER_CREATED, {
        doc: expect.objectContaining({
          _id: bob._id,
          name: bob.name,
          role: bob.role,
          createdAt: bob.createdAt,
          updatedAt: bob.updatedAt,
        }),
      })

      // Check if the documents are saved
      const found = await UserModel.find({})
      expect(found).toHaveLength(3)

      const [foundJohn, foundAlice, foundBob] = found

      expect(foundJohn.name).toBe('John')
      expect(foundJohn.role).toBe('user')

      expect(foundAlice.name).toBe('Alice')
      expect(foundAlice.role).toBe('user')

      expect(foundBob.name).toBe('Bob')
      expect(foundBob.role).toBe('user')
    })
  })

  describe('upsert cases', () => {
    it('should update() + upsert and emit one create event', async () => {
      if (isMongooseLessThan7) {
        // @ts-expect-error update() not available in Mongoose v6 and below
        await UserModel.update({ name: 'John' }, { name: 'John', role: 'admin' }, { upsert: true })
      } else {
        await UserModel.findOneAndUpdate({ name: 'John' }, { name: 'John', role: 'admin' }, { upsert: true })
      }

      const user = await UserModel.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: user?._id,
          name: user?.name,
          role: user?.role,
          // Upsert does not set createdAt and updatedAt
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should updateOne() + upsert and emit one create event', async () => {
      await UserModel.updateOne({ name: 'John' }, { name: 'John', role: 'admin' }, { upsert: true })

      const user = await UserModel.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: user?._id,
          name: user?.name,
          role: user?.role,
          // Upsert does not set createdAt and updatedAt
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should replaceOne() + upsert and emit one create event', async () => {
      await UserModel.replaceOne({ name: 'John' }, { name: 'John', role: 'admin' }, { upsert: true })

      const user = await UserModel.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: user?._id,
          name: user?.name,
          role: user?.role,
          // Upsert does not set createdAt and updatedAt
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should updateMany() + upsert and emit one create event', async () => {
      await UserModel.updateMany({ name: { $in: ['John', 'Alice', 'Bob'] } }, { name: 'Steve', role: 'admin' }, { upsert: true })

      const users = await UserModel.findOne({ name: 'Steve', role: 'admin' })

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenNthCalledWith(1, USER_CREATED, {
        doc: expect.objectContaining({
          _id: users?._id,
          name: users?.name,
          role: users?.role,
          // Upsert does not set createdAt and updatedAt
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findById(users?._id)
      expect(found).not.toBeNull()
      expect(found?.name).toBe('Steve')
      expect(found?.role).toBe('admin')
    })

    it('should findOneAndUpdate() + upsert and emit one create event', async () => {
      await UserModel.findOneAndUpdate({ name: 'John' }, { name: 'John', role: 'admin' }, { upsert: true })

      const user = await UserModel.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: user?._id,
          name: user?.name,
          role: user?.role,
          // Upsert does not set createdAt and updatedAt
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should findOneAndReplace() + upsert and emit one create event', async () => {
      await UserModel.findOneAndReplace({ name: 'John' }, { name: 'John', role: 'admin' }, { upsert: true })

      const user = await UserModel.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: user?._id,
          name: user?.name,
          role: user?.role,
          // Upsert does not set createdAt and updatedAt
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should findByIdAndUpdate() + upsert and emit one create event', async () => {
      const _id = new Types.ObjectId()
      await UserModel.findByIdAndUpdate(_id, { name: 'John', role: 'admin' }, { upsert: true })

      const user = await UserModel.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(1)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          _id: user?._id,
          name: user?.name,
          role: user?.role,
        }),
      })

      // Check if the document is saved
      const found = await UserModel.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should findOneAndUpdate() with $set + upsert and emit one create event', async () => {
      const _id = new Types.ObjectId()
      const john = await UserModel.create({ _id, name: 'John', role: 'admin' })

      if (isMongooseLessThan7) {
        // @ts-expect-error update() not available in Mongoose v6 and below
        await UserModel.update({ name: 'Alex', role: 'user' }, { $set: { name: 'Alex', role: 'user' } }, { upsert: true, setDefaultsOnInsert: false, overwriteDiscriminatorKey: true }).exec()
      } else {
        await UserModel.findOneAndUpdate({ name: 'Alex', role: 'user' }, { $set: { name: 'Alex', role: 'user' } }, { upsert: true, setDefaultsOnInsert: false, overwriteDiscriminatorKey: true }).exec()
      }

      const alex = await UserModel.findOne({ name: 'Alex', role: 'user' })
      expect(alex).not.toBeNull()

      const history = await HistoryModel.find({})
      expect(history).toHaveLength(0)

      expect(em.emit).toHaveBeenCalledTimes(2)
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          name: john?.name,
          role: john?.role,
        }),
      })
      expect(em.emit).toHaveBeenCalledWith(USER_CREATED, {
        doc: expect.objectContaining({
          name: alex?.name,
          role: alex?.role,
        }),
      })
    })
  })
})
