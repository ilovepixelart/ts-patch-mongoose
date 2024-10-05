import type { Operation } from 'fast-json-patch'
import type { Types } from 'mongoose'

interface IHistory {
  op: string
  modelName: string
  collectionName: string
  collectionId: Types.ObjectId
  version: number
  doc?: object
  user?: object
  reason?: string
  metadata?: object
  patch?: Operation[]
}

export default IHistory
