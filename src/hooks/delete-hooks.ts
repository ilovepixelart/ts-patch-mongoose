import _ from 'lodash'
import { isHookIgnored } from '../helpers'
import { deletePatch } from '../patch'

import type { HydratedDocument, Model, MongooseQueryMiddleware, Schema } from 'mongoose'
import type { HookContext, PluginOptions } from '../types'

const deleteMethods = ['remove', 'findOneAndDelete', 'findOneAndRemove', 'findByIdAndDelete', 'findByIdAndRemove', 'deleteOne', 'deleteMany']

export const deleteHooksInitialize = <T>(schema: Schema<T>, opts: PluginOptions<T>): void => {
  schema.pre(deleteMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: HookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    const model = this.model as Model<T>
    const filter = this.getFilter()

    this._context = {
      op: this.op,
      modelName: opts.modelName ?? this.model.modelName,
      collectionName: opts.collectionName ?? this.model.collection.collectionName,
      ignoreEvent: options.ignoreEvent as boolean,
      ignorePatchHistory: options.ignorePatchHistory as boolean,
    }

    if (['remove', 'deleteMany'].includes(this._context.op) && !options.single) {
      const docs = await model.find<T>(filter).lean().exec()
      if (!_.isEmpty(docs)) {
        this._context.deletedDocs = docs as HydratedDocument<T>[]
      }
    } else {
      const doc = await model.findOne<T>(filter).lean().exec()
      if (!_.isEmpty(doc)) {
        this._context.deletedDocs = [doc] as HydratedDocument<T>[]
      }
    }

    if (opts.preDelete && _.isArray(this._context.deletedDocs) && !_.isEmpty(this._context.deletedDocs)) {
      await opts.preDelete(this._context.deletedDocs)
    }
  })

  schema.post(deleteMethods as MongooseQueryMiddleware[], { document: false, query: true }, async function (this: HookContext<T>) {
    const options = this.getOptions()
    if (isHookIgnored(options)) return

    await deletePatch(opts, this._context)
  })
}
