import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import mongoose from 'mongoose'
import em from '../src/em'
import { patchHistoryPlugin } from '../src/index'
import { bulkPatch, getData, getJsonOmit, getMetadata, getObjectOmit, getReason, getUser, getValue, updatePatch } from '../src/patch'
import { USER_DELETED } from './constants/events'
import server from './mongo/server'
import { type User, UserSchema } from './schemas/User'

import type { HydratedDocument } from 'mongoose'
import type { PatchContext, PluginOptions } from '../src/types'

vi.mock('../src/em', () => ({ default: { emit: vi.fn() } }))

describe('patch tests', () => {
  const instance = server('patch')

  UserSchema.plugin(patchHistoryPlugin, {
    eventDeleted: USER_DELETED,
    patchHistoryDisabled: true,
  })

  const UserModel = mongoose.model<User>('User', UserSchema)

  beforeAll(async () => {
    await instance.create()
  })

  afterAll(async () => {
    await instance.destroy()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('users').deleteMany({})
    await mongoose.connection.collection('patches').deleteMany({})
  })

  describe('getObjects', () => {
    it('should omit properties from currentObject and originalObject based on the opts', async () => {
      const original = await UserModel.create({ name: 'John', role: 'user' })
      const current = await UserModel.create({ name: 'John', role: 'admin' })

      const pluginOptions = {
        omit: ['createdAt'],
      }

      const currentObject = getJsonOmit(pluginOptions, current)
      const originalObject = getJsonOmit(pluginOptions, original)

      expect(currentObject.name).toBe('John')
      expect(currentObject.role).toBe('admin')
      expect(currentObject.createdAt).toBeUndefined()

      expect(originalObject.name).toBe('John')
      expect(originalObject.role).toBe('user')
      expect(originalObject.createdAt).toBeUndefined()
    })

    it('should not omit properties from currentObject and originalObject if opts is empty', async () => {
      const original = await UserModel.create({ name: 'John', role: 'user' })
      const current = await UserModel.create({ name: 'John', role: 'admin' })

      const pluginOptions = {}

      const currentObject = getJsonOmit(pluginOptions, current)
      const originalObject = getJsonOmit(pluginOptions, original)

      expect(currentObject.name).toBe('John')
      expect(currentObject.role).toBe('admin')
      expect(currentObject.createdAt).toBeDefined()

      expect(originalObject.name).toBe('John')
      expect(originalObject.role).toBe('user')
      expect(originalObject.createdAt).toBeDefined()
    })
  })

  describe('getObjectOmit', () => {
    // Characterization: a missing document passes through instead of throwing.
    it('characterization: returns a null document as is', () => {
      expect(getObjectOmit({}, null as unknown as HydratedDocument<User>)).toBeNull()
    })
  })

  describe('bulkPatch', () => {
    it('does not call getUser, getReason or getMetadata when history is disabled', async () => {
      const doc = new UserModel({ name: 'John', role: 'user' })
      const getters = { getUser: vi.fn(), getReason: vi.fn(), getMetadata: vi.fn() }
      const context: PatchContext<User> = { op: 'deleteOne', modelName: 'User', collectionName: 'users', deletedDocs: [doc] }

      await bulkPatch({ eventDeleted: USER_DELETED, patchHistoryDisabled: true, ...getters }, context, 'eventDeleted', 'deletedDocs')

      expect(em.emit).toHaveBeenCalled()
      expect([getters.getUser, getters.getReason, getters.getMetadata].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0])
    })

    it('writes one entry per document and no user, reason or metadata keys when no getter is set', async () => {
      await mongoose.connection.collection('history').deleteMany({})
      const doc = new UserModel({ name: 'John', role: 'user' })
      const onError = vi.fn()
      const context: PatchContext<User> = { op: 'deleteOne', modelName: 'User', collectionName: 'users', deletedDocs: [doc] }

      await bulkPatch({ onError }, context, 'eventDeleted', 'deletedDocs')

      const rows = await mongoose.connection.collection('history').find({}).toArray()
      expect(onError).not.toHaveBeenCalled()
      expect(rows.map((row) => [row.op, String(row.collectionId), ['user', 'reason', 'metadata'].filter((key) => Object.hasOwn(row, key))])).toEqual([['deleteOne', String(doc._id), []]])
    })

    it('should emit eventDeleted if opts.patchHistoryDisabled is false', async () => {
      const doc = new UserModel({ name: 'John', role: 'user' })

      const pluginOptions: PluginOptions<User> = {
        eventDeleted: USER_DELETED,
        patchHistoryDisabled: false,
      }

      const context: PatchContext<User> = {
        op: 'deleteOne',
        modelName: 'User',
        collectionName: 'users',
        deletedDocs: [doc],
      }

      await bulkPatch(pluginOptions, context, 'eventDeleted', 'deletedDocs')
      expect(em.emit).toHaveBeenCalled()
    })

    it('should emit eventDeleted if opts.patchHistoryDisabled is true', async () => {
      const doc = new UserModel({ name: 'John', role: 'user' })

      const pluginOptions: PluginOptions<User> = {
        eventDeleted: USER_DELETED,
        patchHistoryDisabled: true,
      }

      const context: PatchContext<User> = {
        op: 'deleteOne',
        modelName: 'User',
        collectionName: 'users',
        deletedDocs: [doc],
      }

      await bulkPatch(pluginOptions, context, 'eventDeleted', 'deletedDocs')
      expect(em.emit).toHaveBeenCalled()
    })
  })

  describe('updatePatch', () => {
    it('should return if one object is empty', async () => {
      const current = await UserModel.create({ name: 'John', role: 'user' })

      vi.clearAllMocks()

      const pluginOptions: PluginOptions<User> = {
        eventDeleted: USER_DELETED,
        patchHistoryDisabled: true,
      }

      const context: PatchContext<User> = {
        op: 'updateOne',
        modelName: 'User',
        collectionName: 'users',
      }

      await updatePatch(pluginOptions, context, current, {} as HydratedDocument<User>)
      expect(em.emit).not.toHaveBeenCalled()
    })
  })

  describe('should getUser()', () => {
    it('should return undefined when no getter is set', async () => {
      await expect(getUser({})).resolves.toBeUndefined()
      await expect(getReason({})).resolves.toBeUndefined()
      await expect(getMetadata({})).resolves.toBeUndefined()
    })

    it('should return user, reason, metadata', async () => {
      const opts: PluginOptions<User> = {
        getUser: () => ({ name: 'test' }),
        getReason: () => 'test',
        getMetadata: () => ({ test: 'test' }),
      }

      await expect(getUser(opts)).resolves.toEqual({ name: 'test' })
      await expect(getReason(opts)).resolves.toBe('test')
      await expect(getMetadata(opts)).resolves.toEqual({ test: 'test' })
    })
  })

  describe('should getData()', () => {
    it('should return user, reason, metadata', async () => {
      const opts: PluginOptions<User> = {
        getUser: () => ({ name: 'test' }),
        getReason: () => 'test',
        getMetadata: () => ({ test: 'test' }),
      }

      await expect(getData(opts)).resolves.toEqual([{ name: 'test' }, 'test', { test: 'test' }])
    })

    it('should return user, reason, metadata undefined', async () => {
      const opts: PluginOptions<User> = {
        getUser: () => ({ name: 'test' }),
        getReason: () => 'test',
        getMetadata: () => {
          throw new Error('test')
        },
      }

      await expect(getData(opts)).resolves.toEqual([{ name: 'test' }, 'test', undefined])
    })

    it('should getValue', () => {
      const item1: PromiseSettledResult<User> = {
        status: 'fulfilled',
        value: {
          name: 'test',
          role: 'user',
        },
      }

      expect(getValue(item1)).toEqual({ name: 'test', role: 'user' })

      const item2: PromiseSettledResult<User> = {
        status: 'rejected',
        reason: new Error('test'),
      }

      expect(getValue(item2)).toBeUndefined()
    })
  })
})
