import type { Operation } from 'fast-json-patch'
import type { HydratedDocument } from 'mongoose'

interface IEvent<T> {
  oldDoc?: HydratedDocument<T>
  doc?: HydratedDocument<T>
  patch?: Operation[]
}

export default IEvent
