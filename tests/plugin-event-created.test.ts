import { isMongooseLessThan7 } from '../src/version'
import mongoose, { Types, model } from 'mongoose'

import UserSchema from './schemas/UserSchema'
import { patchHistoryPlugin } from '../src/plugin'
import History from '../src/models/History'

import em from '../src/em'
import { USER_CREATED } from './constants/events'

jest.mock('../src/em', () => {
  return {
    emit: jest.fn(),
  }
})

describe('plugin - event created & patch history disabled', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventCreated: USER_CREATED,
    patchHistoryDisabled: true,
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

  describe('normal cases', () => {
    it('should save() and emit one create event', async () => {
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
          updatedAt: john.updatedAt,
        }),
      })

      // Check if the document is saved
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('user')
    })

    it('should create() and emit one create event', async () => {
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
          updatedAt: user.updatedAt,
        }),
      })

      // Check if the document is saved
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('user')
    })

    it('should insertMany() and emit three create events', async () => {
      const users = await User.insertMany([
        { name: 'John', role: 'user' },
        { name: 'Alice', role: 'user' },
        { name: 'Bob', role: 'user' },
      ], { ordered: true })

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
      const found = await User.find({})
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
        await User.update(
          { name: 'John' },
          { name: 'John', role: 'admin' },
          { upsert: true },
        )
      } else {
        await User.findOneAndUpdate(
          { name: 'John' },
          { name: 'John', role: 'admin' },
          { upsert: true },
        )
      }

      const user = await User.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await History.find({})
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
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should updateOne() + upsert and emit one create event', async () => {
      await User.updateOne(
        { name: 'John' },
        { name: 'John', role: 'admin' },
        { upsert: true },
      )

      const user = await User.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await History.find({})
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
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should replaceOne() + upsert and emit one create event', async () => {
      await User.replaceOne(
        { name: 'John' },
        { name: 'John', role: 'admin' },
        { upsert: true },
      )

      const user = await User.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await History.find({})
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
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should updateMany() + upsert and emit one create event', async () => {
      await User.updateMany(
        { name: { $in: ['John', 'Alice', 'Bob'] } },
        { name: 'Steve', role: 'admin' },
        { upsert: true },
      )

      const users = await User.findOne({ name: 'Steve', role: 'admin' })

      const history = await History.find({})
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
      const found = await User.findById(users?._id)
      expect(found).not.toBeNull()
      expect(found?.name).toBe('Steve')
      expect(found?.role).toBe('admin')
    })

    it('should findOneAndUpdate() + upsert and emit one create event', async () => {
      await User.findOneAndUpdate(
        { name: 'John' },
        { name: 'John', role: 'admin' },
        { upsert: true },
      )

      const user = await User.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await History.find({})
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
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should findOneAndReplace() + upsert and emit one create event', async () => {
      await User.findOneAndReplace(
        { name: 'John' },
        { name: 'John', role: 'admin' },
        { upsert: true },
      )

      const user = await User.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await History.find({})
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
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })

    it('should findByIdAndUpdate() + upsert and emit one create event', async () => {
      const _id = new Types.ObjectId()
      await User.findByIdAndUpdate(_id, { name: 'John', role: 'admin' }, { upsert: true })

      const user = await User.findOne({ name: 'John', role: 'admin' })
      expect(user).not.toBeNull()

      const history = await History.find({})
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
      const found = await User.findOne({})
      expect(found).not.toBeNull()
      expect(found?.name).toBe('John')
      expect(found?.role).toBe('admin')
    })
  })
})
