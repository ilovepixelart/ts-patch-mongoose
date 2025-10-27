import isEmpty from 'lodash/isEmpty'
import { toObjectOptions } from './helpers'
import { deleteHooksInitialize } from './hooks/delete-hooks'
import { saveHooksInitialize } from './hooks/save-hooks'
import { updateHooksInitialize } from './hooks/update-hooks'
import { createPatch, deletePatch } from './patch'
import { isMongooseLessThan7, isMongooseLessThan8 } from './version'

import type { HydratedDocument, Model, Schema } from 'mongoose'
import type { PatchContext, PluginOptions } from './types'

const remove = isMongooseLessThan7 ? 'remove' : 'deleteOne'

/**
 * @description Event emitter for patch operations.
 */
export { default as patchEventEmitter } from './em'
export { setPatchHistoryTTL } from './helpers'
export * from './types'

/**
 * @description Mongoose plugin to track and manage patch history for documents.
 * This plugin initializes hooks for save, update, and delete operations to create
 * and manage patches.
 *
 * @template T
 * @param {Schema<T>} schema - The Mongoose schema to apply the plugin to.
 * @param {PluginOptions<T>} opts - Options for configuring the plugin.
 * @returns {void}
 */
export const patchHistoryPlugin = function plugin<T>(schema: Schema<T>, opts: PluginOptions<T>): void {
  // Initialize hooks
  saveHooksInitialize(schema, opts)
  updateHooksInitialize(schema, opts)
  deleteHooksInitialize(schema, opts)

  /**
   * @description Corner case for insertMany()
   * @param {Array<HydratedDocument<T>>} docs - The documents being inserted.
   * @returns {Promise<void>}
   */
  schema.post('insertMany', async function (docs) {
    const context = {
      op: 'create',
      modelName: opts.modelName ?? this.modelName,
      collectionName: opts.collectionName ?? this.collection.collectionName,
      createdDocs: docs as unknown as HydratedDocument<T>[],
    }

    await createPatch(opts, context)
  })

  /* v8 ignore start */
  // In Mongoose 7, doc.deleteOne() returned a promise that resolved to doc.
  // In Mongoose 8, doc.deleteOne() returns a query for easier chaining, as well as consistency with doc.updateOne().
  if (isMongooseLessThan8) {
    /**
     * @description Pre-delete hook for Mongoose 7 and below
     * @returns {Promise<void>}
     */
    // @ts-expect-error - Mongoose 7 and below
    schema.pre(remove, { document: true, query: false }, async function () {
      // @ts-expect-error - Mongoose 7 and below
      const original = this.toObject(toObjectOptions) as HydratedDocument<T>

      if (opts.preDelete && !isEmpty(original)) {
        await opts.preDelete([original])
      }
    })

    /**
     * @description Post-delete hook for Mongoose 7 and below
     * @param {HydratedDocument<T>} this - The document being deleted.
     * @returns {Promise<void>}
     */
    // @ts-expect-error - Mongoose 7 and below
    schema.post(remove, { document: true, query: false }, async function (this: HydratedDocument<T>) {
      const original = this.toObject(toObjectOptions) as HydratedDocument<T>
      const model = this.constructor as Model<T>

      const context: PatchContext<T> = {
        op: 'delete',
        modelName: opts.modelName ?? model.modelName,
        collectionName: opts.collectionName ?? model.collection.collectionName,
        deletedDocs: [original],
      }

      await deletePatch(opts, context)
    })
  }
  /* v8 ignore end */
}
