import type { Operation } from 'fast-json-patch'

interface IEvent<T> {
  oldDoc?: T
  doc?: T
  patch?: Operation[]
}

export default IEvent
