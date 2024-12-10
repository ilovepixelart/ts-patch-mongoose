import _ from 'lodash'
import ms from 'ms'
import em from './em'

import History from './models/History'

import { toObjectOptions } from './helpers'
import { createPatch, deletePatch } from './patch'
import { isMongooseLessThan7, isMongooseLessThan8 } from './version'

import { deleteHooksInitialize } from './hooks/delete-hooks'
import { saveHooksInitialize } from './hooks/save-hooks'
import { updateHooksInitialize } from './hooks/update-hooks'

import type { HydratedDocument, Model, Schema } from 'mongoose'
import type IContext from './interfaces/IContext'
import type IPluginOptions from './interfaces/IPluginOptions'

const remove = isMongooseLessThan7 ? 'remove' : 'deleteOne'

/**
 * @description Patch patch event emitter
 */
export const patchEventEmitter = em

/**
 * @description Patch history plugin
 * @param {Schema} schema
 * @param {IPluginOptions} opts
 * @returns {void}
 */
export const patchHistoryPlugin = function plugin<T>(schema: Schema<T>, opts: IPluginOptions<T>): void {
  // If opts historyTTL is set than index is created
  const name = 'createdAt_1_TTL' // To avoid collision with user defined index / manually created index
  if (opts.historyTTL != null) {
    const expireAfterSeconds = ms(opts.historyTTL as string) / 1000
    History.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds, name }).catch((err) => {
      console.error("Couldn't create index for history collection", err)
    })
  } else {
    // Lets remove the index if it exists and we changed the mind about historyTTL
    History.collection.dropIndex(name).catch((err) => {
      console.error("Couldn't drop index for history collection", err)
    })
  }

  // Initialize hooks
  saveHooksInitialize(schema, opts)
  updateHooksInitialize(schema, opts)
  deleteHooksInitialize(schema, opts)

  // Corner case for insertMany()
  schema.post('insertMany', async function (docs) {
    const context = {
      op: 'create',
      modelName: opts.modelName ?? this.modelName,
      collectionName: opts.collectionName ?? this.collection.collectionName,
      createdDocs: docs as unknown as HydratedDocument<T>[],
    }

    await createPatch(opts, context)
  })

  // In Mongoose 7, doc.deleteOne() returned a promise that resolved to doc.
  // In Mongoose 8, doc.deleteOne() returns a query for easier chaining, as well as consistency with doc.updateOne().
  if (isMongooseLessThan8) {
    // @ts-expect-error - Mongoose 7 and below
    schema.pre(remove, { document: true, query: false }, async function () {
      // @ts-expect-error - Mongoose 7 and below
      const original = this.toObject(toObjectOptions) as HydratedDocument<T>

      if (opts.preDelete && !_.isEmpty(original)) {
        await opts.preDelete([original])
      }
    })

    // @ts-expect-error - Mongoose 7 and below
    schema.post(remove, { document: true, query: false }, async function (this: HydratedDocument<T>) {
      const original = this.toObject(toObjectOptions) as HydratedDocument<T>
      const model = this.constructor as Model<T>

      const context: IContext<T> = {
        op: 'delete',
        modelName: opts.modelName ?? model.modelName,
        collectionName: opts.collectionName ?? model.collection.collectionName,
        deletedDocs: [original],
      }

      await deletePatch(opts, context)
    })
  }
}
