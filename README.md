# ts-patch-mongoose

Patch history (audit log) & events plugin for mongoose

[![npm](https://img.shields.io/npm/v/ts-patch-mongoose)](https://www.npmjs.com/package/ts-patch-mongoose)
[![npm](https://img.shields.io/npm/dt/ts-patch-mongoose)](https://www.npmjs.com/package/ts-patch-mongoose)
[![GitHub](https://img.shields.io/github/license/ilovepixelart/ts-patch-mongoose)](https://github.com/ilovepixelart/ts-patch-mongoose/blob/main/LICENSE)
\
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=coverage)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
\
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
\
[![Socket Badge](https://badge.socket.dev/npm/package/ts-patch-mongoose)](https://socket.dev/npm/package/ts-patch-mongoose)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/ilovepixelart/ts-patch-mongoose/badge)](https://securityscorecards.dev/viewer/?uri=github.com/ilovepixelart/ts-patch-mongoose)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12473/badge)](https://www.bestpractices.dev/en/projects/12473)

## Motivation

ts-patch-mongoose is a plugin for mongoose.
\
I need to track changes of mongoose models and save them as patch history (audit log) in a separate collection. Changes must also emit events that I can subscribe to and react in other parts of my application. I also want to omit some fields from patch history.

## Supports and tested with

```json
{
  "node": ">=20",
  "mongoose": ">=6.6.0 <10"
}
```

CI tests on Node.js `22.x` and `24.x` against mongoose `6.12.2`, `7.6.4`, `8.23.0`, and `9.4.1`, and on `26.x` with the mongoose version the lockfile pins.

## Features

- Track changes in mongoose models: `save`, `insertMany`, query updates and deletes, and `bulkWrite`
- Record what MongoDB stored: each entry is the diff between the stored document before and after the write
- Save changes in a separate collection as a patch history
- Emit events when a model is created, updated or deleted
- Omit fields that you don't want to track in patch history
- Subscribe to one/many types of event
- Use events or patch history or both
- Supports ESM and CommonJS

## Installation

`mongoose` is a peer dependency: install it alongside `ts-patch-mongoose`.

```bash
npm install ts-patch-mongoose mongoose
pnpm add ts-patch-mongoose mongoose
yarn add ts-patch-mongoose mongoose
bun add ts-patch-mongoose mongoose
```

## Example

Works with any Node.js framework: Express, Fastify, Koa, Hono, Nest, etc.
\
How to use it with Express: [ts-express-tsx](https://github.com/ilovepixelart/ts-express-tsx)

Create your event constants in `events.ts`

```typescript
export const BOOK_CREATED = 'book-created'
export const BOOK_UPDATED = 'book-updated'
export const BOOK_DELETED = 'book-deleted'
```

Create your type `Book` in `types.ts`

```typescript
import type { Types } from 'mongoose'

export type Book = {
  title: string
  description?: string
  authorId: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}
```

Set up your mongoose model in `Book.ts`

```typescript
import { Schema, model } from 'mongoose'

import type { HydratedDocument } from 'mongoose'
import type { Book } from '../types'

import { patchHistoryPlugin, setPatchHistoryTTL } from 'ts-patch-mongoose'
import { BOOK_CREATED, BOOK_UPDATED, BOOK_DELETED } from '../constants/events'

// You can set patch history TTL in plain English or in milliseconds as you wish.
// This will determine how long you want to keep patch history.
// You don't need to use this global config in case you want to keep patch history forever.
// Execute this method after you connected to your database somewhere in your application.
// Optional second argument for custom error handling
setPatchHistoryTTL('1 month', (error) => console.error('TTL setup failed:', error))

const BookSchema = new Schema<Book>({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
  },
  authorId: {
    type: Schema.Types.ObjectId,
    required: true
  }
}, { timestamps: true })

BookSchema.plugin(patchHistoryPlugin, {
  // Provide your event constants to plugin
  eventCreated: BOOK_CREATED,
  eventUpdated: BOOK_UPDATED,
  eventDeleted: BOOK_DELETED,

  // You can omit some properties in case you don't want to save them to patch history
  omit: ['__v', 'createdAt', 'updatedAt'],

  // Additional options for patchHistoryPlugin
  // Everything below is optional and just shows you what you can do:

  // Code below is an abstract example, you can use any other way to get user, reason, metadata
  // These three properties will be added to patch history document automatically and gives you flexibility to track who, why and when made changes to your documents
  getUser: async (doc: HydratedDocument<Book>) => {
    // For example: get user from http context
    // You should return an object, in case you want to save user to patch history
    return httpContext.get('user') as Record<string, unknown>
  },

  // Reason for the document change (create/update/delete) like: 'Excel upload', 'Manual update', 'API call', etc.
  getReason: async (doc: HydratedDocument<Book>) => {
    // For example: get reason from http context, or any other place of your application
    // You should return a string, in case you want to save reason to patch history
    return httpContext.get('reason') as string
  },

  // You can provide any information you want to save along with patch history
  getMetadata: async (doc: HydratedDocument<Book>) => {
    // For example: get metadata from http context, or any other place of your application
    // You should return an object, in case you want to save metadata to patch history
    return httpContext.get('metadata') as Record<string, unknown>
  },

  // Do something before deleting documents
  // This method will be executed before deleting document or documents and always returns a non-empty array of documents
  preDelete: async (docs) => {
    const bookIds = docs.map((doc) => doc._id)
    await SomeOtherModel.deleteMany({ bookId: { $in: bookIds } })
  },

  // Custom error handler for failures while recording history (defaults to console.error).
  // They happen after the write succeeded, so the operation itself does not reject.
  onError: (error) => {
    console.error('Patch history error:', error)
  },

  // In case you just want to track changes in your models using events
  // and don't want to save changes to patch history collection
  // patchHistoryDisabled: true,

  // Paths declared with `select: false` (password hashes, tokens) are left out of history and events.
  // Set this to record them too
  // includeHiddenPaths: true,
})

const Book = model('Book', BookSchema)

export default Book
```

## How changes are recorded

For every write the plugin reads the stored documents the write will touch, lets the write run, reads them again by `_id`, and records the difference. History entries are written first, in one write per batch of up to 1000 documents, then the events are emitted. A write that fails records nothing and emits nothing.

- `updateOne`, `replaceOne` and the `findOneAnd*` methods touch one document: the first match of the filter, with the `sort` and `collation` of `findOneAnd*`. When a filter matches several documents, use a unique filter, or `findOneAndUpdate` with `sort`, to make the choice explicit.
- `updateMany` and `deleteMany` touch every match. Their stored state is held in memory until the write finishes.
- `bulkWrite` records the net change of each document it touched. Updates and deletes are recorded under the name of the operation that touched the document first (`updateOne`, `replaceOne`, `deleteMany`, ...), inserts as `create`. A call that fails part way records the operations that were applied, then rejects. `bulkSave` is recorded through the `save` hooks, once. Callback-style calls (mongoose 6) are not recorded.
- `bulkWrite` reads the targets of all its operations before the call, one read per update or delete operation. An operation whose filter matches a document only because an earlier operation of the same call changed it is not recorded for that document: the call is one command to the server, and splitting it would change what it returns and how it fails. Unordered calls have no defined order anyway. Write such operations in separate calls.
- Paths declared with `select: false` (password hashes, tokens), including those of subdocuments, are left out of history entries and events. An update that changes only such paths records nothing. Set `includeHiddenPaths: true` to record them.
- An update costs one read before the write and one after it; an upsert that inserts reads the new document once. A delete costs one read before the write, as in 4.x. Creating documents costs no read, and neither does a `save` of an unmodified document.

### Concurrent writes and transactions

The reads before and after a write are separate queries. Outside a transaction, a write by another client between them is part of the recorded difference, and two concurrent updates of one document can receive the same `version`. Every entry still describes states that were stored. A `deleteMany` that races with another client deleting the same documents can record those documents too.

Inside a transaction the reads use the transaction's session, and MongoDB's write-conflict retry serialises updates to one document, so patches and versions are exact. Run writes that must be audited exactly in a transaction:

```typescript
const session = await mongoose.startSession()
try {
  await session.withTransaction(async () => {
    await Book.updateOne({ _id: bookId }, { $inc: { stock: -1 } }, { session })
  })
} finally {
  await session.endSession()
}
```

History entries are written outside the transaction: an entry is written as soon as its write succeeds, and stays when the transaction aborts afterwards. A write to the history collection inside a transaction can fail that transaction with a lock timeout while mongoose is still creating the collection and its indexes. With `transactionAsyncLocalStorage` (mongoose 8+), mongoose applies the transaction's session to every operation that has none, the history writes included, as in 4.x.

## Subscribe

You can subscribe to events using patchEventEmitter anywhere in your application `handlers/BookHandler.ts`

```typescript
import { patchEventEmitter } from 'ts-patch-mongoose'
import { BOOK_CREATED, BOOK_UPDATED, BOOK_DELETED } from '../constants/events'

patchEventEmitter.on(BOOK_CREATED, ({ doc }) => {
  try {
    console.log('Event - book created', doc)
    // Do something with doc here
  } catch (error) {
    console.error(error)
  }
})

patchEventEmitter.on(BOOK_UPDATED, ({ doc, oldDoc, patch }) => {
  try {
    console.log('Event - book updated', doc, oldDoc, patch)
    // Do something with doc, oldDoc and patch here
  } catch (error) {
    console.error(error)
  }
})

patchEventEmitter.on(BOOK_DELETED, ({ oldDoc }) => {
  try {
    console.log('Event - book deleted', oldDoc)
    // Do something with oldDoc here
  } catch (error) {
    console.error(error)
  }
})
```

## NestJS

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { patchHistoryPlugin } from 'ts-patch-mongoose'

@Schema({ timestamps: true })
export class Book {
  @Prop({ type: String, required: true })
  title!: string

  @Prop({ type: String })
  description?: string
}

export const BookSchema = SchemaFactory.createForClass(Book)

BookSchema.plugin(patchHistoryPlugin, {
  eventCreated: 'book-created',
  eventUpdated: 'book-updated',
  eventDeleted: 'book-deleted',
  omit: ['__v', 'createdAt', 'updatedAt'],
})
```

## Migrating from 4.x to 5.0

4.x produced history and events in pre hooks, before the write, from a simulation of the update applied to every document matching the filter. 5.0 records the stored states before and after the write. Breaking changes first:

| Area | 4.x | 5.0 | What to do |
| --- | --- | --- | --- |
| Event timing | Create and update events were emitted before the write, and before their history entry | Emitted after the write succeeded and after the history entry was written | A listener that reads the database now sees the new state; use `oldDoc` for the previous one |
| Failed writes | A write the server rejected (duplicate key, for example) still recorded history and emitted its event | Records and emits nothing | None |
| Single-document updates | `updateOne`, `replaceOne` and `findOneAnd*` recorded every document matching the filter; `findOneAndUpdate` ignored `sort` | One entry, for the document the operation changed | None |
| Deletes | `findOneAndDelete` ignored `sort`, so history and `preDelete` got the first match; a delete that removed nothing was recorded | The removed documents; nothing when nothing was removed | None |
| Patch contents | Conditional `$pull`, positional `$`, `arrayFilters` and pipeline updates recorded nothing; `$position` was recorded at the wrong index; `replaceOne` did not record removed fields; a `$set` that strict mode dropped was recorded | The difference between the stored documents | None |
| Version key | A `save()` that changed an array did not record the `__v` increment; the `findOneAndReplace` event reported `__v: 0` for a replacement stored without one | The stored `__v` is part of the difference | Add `'__v'` to `omit` to keep it out of patches |
| `bulkWrite` | Not recorded | Recorded, see [How changes are recorded](#how-changes-are-recorded) | Remove any manual history for `bulkWrite`, or pass `ignoreHook: true` |
| Errors after the write | A failure while looking up an upserted document rejected the operation | Every failure while recording goes to `onError`; the operation resolves | None |
| Paths with `select: false` | Recorded with their values in the `doc` of create entries, in update patches when they changed, in create events, and in the `oldDoc` and `doc` of update events even when they did not change; deletes left them out | Left out of every entry and event; an update that changes only such paths records nothing | Set `includeHiddenPaths: true` to record them |
| Reads | One read before each update | One read before and one after each update | None |

Smaller corrections: `Map` paths are diffed by their entries (4.x serialized them as `{}`), with `includeHiddenPaths` changes to `select: false` paths are diffed against their stored value, and a `save()` that modifies nothing reads nothing and records nothing. Entries of different documents written in parallel (`Model.create` of an array saves in parallel) are stored in the order their writes completed.

Nothing else changes: the history entry fields, `op` names, version numbering, event payload shapes (`{ doc }`, `{ oldDoc, doc, patch }`, `{ oldDoc }`), plugin options (`includeHiddenPaths` is added), the `ignoreEvent`, `ignorePatchHistory` and `ignoreHook` query options, `preDelete` running before the delete with lean copies of the documents, and the exports.

## Contributing

Check [CONTRIBUTING.md](CONTRIBUTING.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Check my other projects

- [ts-migrate-mongoose](https://github.com/ilovepixelart/ts-migrate-mongoose) - Migration framework for mongoose
- [ts-cache-mongoose](https://github.com/ilovepixelart/ts-cache-mongoose) - Cache plugin for mongoose Queries and Aggregate (in-memory, redis)
