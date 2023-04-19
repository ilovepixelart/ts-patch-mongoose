import { Schema, model } from 'mongoose'

import type IHistory from '../interfaces/IHistory'

const HistorySchema = new Schema<IHistory>({
  op: {
    type: String,
    required: true
  },
  modelName: {
    type: String,
    required: true
  },
  collectionName: {
    type: String,
    required: true
  },
  collectionId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  doc: {
    type: Object
  },
  patch: {
    type: Array
  },
  user: {
    type: Object
  },
  version: {
    type: Number,
    min: 0,
    default: 0
  }
}, { timestamps: true })

HistorySchema.index({ op: 1, modelName: 1, collectionName: 1, collectionId: 1, version: 1 })

const History = model('History', HistorySchema, 'history')

export default History
