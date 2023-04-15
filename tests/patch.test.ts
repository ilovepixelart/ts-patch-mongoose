import mongoose, { model } from 'mongoose'

import { getObjects, bulkPatch, updatePatch } from '../src/patch'
import { patchHistoryPlugin } from '../src/plugin'

import UserSchema from './schemas/UserSchema'

import { USER_DELETED } from './constants/events'

import type { HydratedDocument } from 'mongoose'
import type IPluginOptions from '../src/interfaces/IPluginOptions'
import type IUser from './interfaces/IUser'
import type IContext from '../src/interfaces/IContext'

import em from '../src/em'

jest.mock('../src/em', () => {
  return {
    emit: jest.fn()
  }
})

describe('patch tests', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  UserSchema.plugin(patchHistoryPlugin, {
    eventDeleted: USER_DELETED,
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
    await mongoose.connection.collection('tests').deleteMany({})
    await mongoose.connection.collection('patches').deleteMany({})
  })

  describe('getObjects', () => {
    it('should omit properties from currentObject and originalObject based on the opts', async () => {
      const original = await User.create({ name: 'John', role: 'user' })
      const current = await User.create({ name: 'John', role: 'admin' })

      const pluginOptions = {
        omit: ['createdAt']
      }

      const { currentObject, originalObject } = getObjects(pluginOptions, current, original)

      expect(currentObject.name).toBe('John')
      expect(currentObject.role).toBe('admin')
      expect(currentObject.createdAt).toBeUndefined()

      expect(originalObject.name).toBe('John')
      expect(originalObject.role).toBe('user')
      expect(originalObject.createdAt).toBeUndefined()
    })

    it('should not omit properties from currentObject and originalObject if opts is empty', async () => {
      const original = await User.create({ name: 'John', role: 'user' })
      const current = await User.create({ name: 'John', role: 'admin' })

      const { currentObject, originalObject } = getObjects({}, current, original)

      expect(currentObject.name).toBe('John')
      expect(currentObject.role).toBe('admin')
      expect(currentObject.createdAt).toBeDefined()

      expect(originalObject.name).toBe('John')
      expect(originalObject.role).toBe('user')
      expect(originalObject.createdAt).toBeDefined()
    })
  })

  describe('bulkPatch', () => {
    it('should emit eventDeleted if opts.patchHistoryDisabled is false', async () => {
      const doc = new User({ name: 'John', role: 'user' })

      const pluginOptions: IPluginOptions<IUser> = {
        eventDeleted: USER_DELETED,
        patchHistoryDisabled: false
      }

      const context: IContext<IUser> = {
        op: 'deleteOne',
        modelName: 'User',
        collectionName: 'users',
        deletedDocs: [doc]
      }

      await bulkPatch(pluginOptions, context, 'eventDeleted', 'deletedDocs')
      expect(em.emit).toHaveBeenCalled()
    })

    it('should emit eventDeleted if opts.patchHistoryDisabled is true', async () => {
      const doc = new User({ name: 'John', role: 'user' })

      const pluginOptions: IPluginOptions<IUser> = {
        eventDeleted: USER_DELETED,
        patchHistoryDisabled: true
      }

      const context: IContext<IUser> = {
        op: 'deleteOne',
        modelName: 'User',
        collectionName: 'users',
        deletedDocs: [doc]
      }

      await bulkPatch(pluginOptions, context, 'eventDeleted', 'deletedDocs')
      expect(em.emit).toHaveBeenCalled()
    })
  })

  describe('updatePatch', () => {
    it('should return if one object is empty', async () => {
      const current = await User.create({ name: 'John', role: 'user' })

      const pluginOptions: IPluginOptions<IUser> = {
        eventDeleted: USER_DELETED,
        patchHistoryDisabled: true
      }

      const context: IContext<IUser> = {
        op: 'updateOne',
        modelName: 'User',
        collectionName: 'users'
      }

      await updatePatch(pluginOptions, context, current, {} as HydratedDocument<IUser>)
      expect(em.emit).not.toHaveBeenCalled()
    })
  })
})
