import type { Operation } from 'fast-json-patch'
import type { HydratedDocument, Query, Types } from 'mongoose'

export interface History {
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

export interface PatchEvent<T> {
  oldDoc?: HydratedDocument<T>
  doc?: HydratedDocument<T>
  patch?: Operation[]
}

export interface PatchContext<T> {
  op: string
  modelName: string
  collectionName: string
  isNew?: boolean
  createdDocs?: HydratedDocument<T>[]
  deletedDocs?: HydratedDocument<T>[]
  ignoreEvent?: boolean
  ignorePatchHistory?: boolean
}

export type HookContext<T> = Query<T, T> & { op: string; _context: PatchContext<T> }

export type User = Record<string, unknown>

export type Metadata = Record<string, unknown>

export interface PluginOptions<T> {
  modelName?: string
  collectionName?: string
  eventUpdated?: string
  eventCreated?: string
  eventDeleted?: string
  getUser?: () => Promise<User> | User
  getReason?: () => Promise<string> | string
  getMetadata?: () => Promise<Metadata> | Metadata
  omit?: string[]
  patchHistoryDisabled?: boolean
  preDelete?: (docs: HydratedDocument<T>[]) => Promise<void>
}
