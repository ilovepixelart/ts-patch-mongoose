import _ from 'lodash'
import em from './em'

import { createPatch, deletePatch } from './patch'
import { isMongooseLessThan7, isMongooseLessThan8 } from './version'
import { toObjectOptions } from './helpers'

import { saveHooksInitialize } from './hooks/save-hooks'
import { updateHooksInitialize } from './hooks/update-hooks'
import { deleteHooksInitialize } from './hooks/delete-hooks'

import type { HydratedDocument, Model, Schema } from 'mongoose'
import type IPluginOptions from './interfaces/IPluginOptions'
import type IContext from './interfaces/IContext'

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
export const patchHistoryPlugin = function plugin<T> (schema: Schema<T>, opts: IPluginOptions<T>): void {
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
      createdDocs: docs as unknown as HydratedDocument<T>[]
    }

    await createPatch(opts, context)
  })

  // In Mongoose 7, doc.deleteOne() returned a promise that resolved to doc.
  // In Mongoose 8, doc.deleteOne() returns a query for easier chaining, as well as consistency with doc.updateOne().
  if (isMongooseLessThan8) {
    schema.pre(remove, { document: true, query: false }, async function () {
      const original = this.toObject(toObjectOptions) as HydratedDocument<T>
  
      if (opts.preDelete && !_.isEmpty(original)) {
        await opts.preDelete([original])
      }
    })
  
    schema.post(remove, { document: true, query: false }, async function (this: HydratedDocument<T>) {
      const original = this.toObject(toObjectOptions) as HydratedDocument<T>
      const model = this.constructor as Model<T>
  
      const context: IContext<T> = {
        op: 'delete',
        modelName: opts.modelName ?? model.modelName,
        collectionName: opts.collectionName ?? model.collection.collectionName,
        deletedDocs: [original]
      }
  
      await deletePatch(opts, context)
    })
  }
}
