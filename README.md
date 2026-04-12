# ts-patch-mongoose

Patch history (audit log) & events plugin for mongoose

[![npm](https://img.shields.io/npm/v/ts-patch-mongoose)](https://www.npmjs.com/package/ts-patch-mongoose)
[![npm](https://img.shields.io/npm/dt/ts-patch-mongoose)](https://www.npmjs.com/package/ts-patch-mongoose)
[![GitHub](https://img.shields.io/github/license/ilovepixelart/ts-patch-mongoose)](https://github.com/ilovepixelart/ts-patch-mongoose/blob/main/LICENSE)
\
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=coverage)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
[![Socket Badge](https://badge.socket.dev/npm/package/ts-patch-mongoose)](https://socket.dev/npm/package/ts-patch-mongoose)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/ilovepixelart/ts-patch-mongoose/badge)](https://securityscorecards.dev/viewer/?uri=github.com/ilovepixelart/ts-patch-mongoose)
\
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-patch-mongoose&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-patch-mongoose)

## Motivation

ts-patch-mongoose is a plugin for mongoose.
\
I need to track changes of mongoose models and save them as patch history (audit log) in a separate collection. Changes must also emit events that I can subscribe to and react in other parts of my application. I also want to omit some fields from patch history.

## Supports and tested with

```json
{
  "node": "20.x || 22.x || 24.x",
  "mongoose": ">=6.6.0 || 7.x || 8.x || 9.x",
}
```

## Features

- Track changes in mongoose models
- Save changes in a separate collection as a patch history
- Emit events when a model is created, updated or deleted
- Omit fields that you don't want to track in patch history
- Subscribe to one/many types of event
- Use events or patch history or both
- Supports ESM and CommonJS

## Installation

`mongoose` is a peer dependency — install it alongside `ts-patch-mongoose`.

```bash
npm install ts-patch-mongoose mongoose
pnpm add ts-patch-mongoose mongoose
yarn add ts-patch-mongoose mongoose
bun add ts-patch-mongoose mongoose
```

## Example

Works with any Node.js framework — Express, Fastify, Koa, Hono, Nest, etc.
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

  // Custom error handler for history write failures (defaults to console.error)
  onError: (error) => {
    console.error('Patch history error:', error)
  },

  // In case you just want to track changes in your models using events
  // and don't want to save changes to patch history collection
  // patchHistoryDisabled: true,
})

const Book = model('Book', BookSchema)

export default Book
```

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

## Contributing

Check [CONTRIBUTING.md](CONTRIBUTING.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Check my other projects

- [ts-migrate-mongoose](https://github.com/ilovepixelart/ts-migrate-mongoose) - Migration framework for mongoose
- [ts-cache-mongoose](https://github.com/ilovepixelart/ts-cache-mongoose) - Cache plugin for mongoose Queries and Aggregate (in-memory, redis)
