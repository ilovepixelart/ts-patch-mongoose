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

[![npm](https://nodei.co/npm/ts-patch-mongoose.png)](https://www.npmjs.com/package/ts-patch-mongoose)

## Motivation

ts-patch-mongoose is a plugin for mongoose
\
I need to track changes of mongoose models and save them as patch history (audit log) in separate collection. Changes must also emit events that I can subscribe to and react in other parts of my application. I also want to omit some fields from patch history.

## Features

- Track changes in mongoose models
- Save changes in a separate collection as a patch history
- Emit events when a model is created, updated or deleted
- Supports typescript
- Let you omit fields that you don't want to track in patch history
- Subscribe to one/many types of event
- You can use events or patch history or both

## Installation

- Locally inside your project

```bash
npm install ts-patch-mongoose
yarn add ts-patch-mongoose
```

## Example

How to use it with express [ts-express-swc](https://github.com/ilovepixelart/ts-express-swc)

Create your event constants `events.ts`

```typescript
export const USER_CREATED = 'user-created'
export const USER_UPDATED = 'user-updated'
export const USER_DELETED = 'user-deleted'
```

Create your interface `IUser.ts`

```typescript
interface IUser {
  name: string
  role: string
  createdAt?: Date
  updatedAt?: Date
}

export default IUser
```

Setup your mongoose model `User.ts`

```typescript
import { Schema, model } from 'mongoose'

import type { HydratedDocument } from 'mongoose'
import type IUser from '../interfaces/IUser'

import { patchHistoryPlugin } from 'ts-patch-mongoose'
import { USER_CREATED, USER_UPDATED, USER_DELETED } from '../constants/events'

const UserSchema = new Schema<IUser>({
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'manager', 'user'],
    required: true
  }
}, { timestamps: true })

UserSchema.plugin(patchHistoryPlugin, { 
  // In case you just want to track changes in your models using events below.
  // And don't want to save changes to patch history collection
  patchHistoryDisabled: true,

  // Create event constants provide them to plugin and use them to subscribe to events
  eventCreated: USER_CREATED,
  eventUpdated: USER_UPDATED,
  eventDeleted: USER_DELETED,
  
  // You can omit some properties in case you don't want to save them to patch history
  omit: ['__v', 'createdAt', 'updatedAt'],

  // Addition options for ts-match-mongoose plugin

  // These three properties will be added to patch history document automatically and give you flexibility to track who, why and when made changes to your documents

  // Code bellow is abstract example, you can use any other way to get user, reason, metadata
  getUser: async () => {
    // For example: get user from http context
    // You should return an object, in case you want to save user to patch history
    return httpContext.get('user') as Record<string, unknown>
  },

  // Reason of document (create/update/delete) like: 'Excel upload', 'Manual update', 'API call', etc.
  getReason: async () => {
    // For example: get reason from http context, or any other place of your application
    // You shout return a string, in case you want to save reason to patch history
    return httpContext.get('reason') as string
  },

  // You can provide any information you want to save in along with patch history
  getMetadata: async () => {
    // For example: get metadata from http context, or any other place of your application
    // You should return an object, in case you want to save metadata to patch history
    return httpContext.get('metadata') as Record<string, unknown>
  },


  // Do something before deleting documents
  // This method will be executed before deleting document or documents and always returns a nonempty array of documents
  preDelete: async (docs: HydratedDocument<IUser>[]) => {
    const ids = docs.map((doc) => doc._id)
    await Purchase.deleteMany({ userId: { $in: ids } })
  },
})

const User = model('User', UserSchema)

export default User
```

## Subscribe

You can subscribe to events using patchEventEmitter anywhere in your application `handlers/UserHandler.ts`

```typescript
import { patchEventEmitter } from 'ts-patch-mongoose'
import { USER_CREATED, USER_UPDATED, USER_DELETED } from '../constants/events'

patchEventEmitter.on(USER_CREATED, ({ doc }) => {
  try {
    console.log('Event - user created', doc)
    // Do something with doc here
  } catch (error) {
    console.error(error)
  }
})

patchEventEmitter.on(USER_UPDATED, ({ doc, oldDoc, patch }) => {
  try {
    console.log('Event - user updated', doc, oldDoc, patch)
    // Do something with doc, oldDoc and patch here
  } catch (error) {
    console.error(error)
  }
})

patchEventEmitter.on(USER_DELETED, ({ oldDoc }) => {
  try {
    console.log('Event - user deleted', oldDoc)
    // Do something with doc here
  } catch (error) {
    console.error(error)
  }
})
```

## Check my other projects

- [ts-migrate-mongoose](https://github.com/ilovepixelart/ts-migrate-mongoose) - Migration framework for mongoose
