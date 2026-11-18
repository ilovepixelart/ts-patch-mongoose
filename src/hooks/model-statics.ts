import { isArray, isObjectLike } from '../helpers'

import type { ClientSession, Model, Schema } from 'mongoose'

export type Static = (this: unknown, docs: unknown, options?: unknown, callback?: unknown) => Promise<unknown>

export type Override = (base: Static) => Static

const overrides = new WeakSet<object>()

type Statics = Record<string, Static | undefined>

const install = (model: Statics, wraps: Record<string, Override>): void => {
  for (const [name, wrap] of Object.entries(wraps)) {
    const base = model[name]
    if (!base || overrides.has(base)) continue
    const override = wrap(base)
    overrides.add(override)
    model[name] = override
  }
}

/**
 * Replaces statics on every model compiled from the schema, when mongoose initializes it. A static declared on
 * the schema would be wrapped by mongoose below 8.7 with the middleware of the same name (bulkWrite),
 * which then runs twice and passes the static a callback; a static set on the compiled model is left alone.
 * A discriminator model is compiled from a schema of its own, so it receives the overrides when it is created.
 */
export const overrideStatics = <T>(schema: Schema<T>, wraps: Record<string, Override>): void => {
  const discriminatorOf: Override = (discriminator) =>
    function (this: unknown, ...args: unknown[]) {
      const model = (discriminator as (...params: unknown[]) => unknown).apply(this, args) as Statics
      install(model, { ...wraps, discriminator: discriminatorOf })
      return model as unknown as Promise<unknown>
    }

  schema.on('init', (model: Model<T>) => {
    install(model as unknown as Statics, { ...wraps, discriminator: discriminatorOf })
  })
}

const fromBulkSave = Symbol('ts-patch-mongoose bulkSave')

const sessions = new WeakMap<object, ClientSession>()

/** Whether bulkWrite() was called by bulkSave(), whose documents the save hooks record. */
export const isFromBulkSave = (options: unknown): boolean => isObjectLike(options) && (options as Record<symbol, unknown>)[fromBulkSave] === true

/** The session a bulkSave() call was given for a document it saves: mongoose below 9.12 does not set it on the document. */
export const sessionOf = (doc: unknown): ClientSession | undefined => (isObjectLike(doc) ? sessions.get(doc) : undefined)

const withSessions = async <R>(docs: unknown, options: unknown, write: () => Promise<R>): Promise<R> => {
  const session = isObjectLike(options) ? (options.session as ClientSession | null | undefined) : undefined
  const list = session && isArray(docs) ? docs.filter(isObjectLike) : []
  for (const doc of list) sessions.set(doc, session as ClientSession)
  try {
    return await write()
  } finally {
    for (const doc of list) sessions.delete(doc)
  }
}

// bulkSave() hands its options to bulkWrite() on every supported mongoose version (6 and 7 the same object, 8+ a copy).
export const bulkSaveOverride: Override = (bulkSave) =>
  function (this: unknown, docs: unknown, options?: unknown) {
    return withSessions(docs, options, () => bulkSave.call(this, docs, { ...(isObjectLike(options) ? options : {}), [fromBulkSave]: true }))
  }
