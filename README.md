# ts-patch-mongoose

Patch history & events for mongoose models

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
  omit: ['__v', 'createdAt', 'updatedAt']
})

const User = model('User', UserSchema)

export default User
```

## Subscribe

You can subscribe to events using patchEventEmitter anywhere in your application

```typescript
import { patchEventEmitter } from 'ts-patch-mongoose'
import { USER_CREATED, USER_UPDATED, USER_DELETED } from '../constants/events'

patchEventEmitter.on(USER_CREATED, ({ doc }) => {
  console.log('User created', doc)
})

patchEventEmitter.on(USER_UPDATED, ({ doc, oldDoc, patch }) => {
  console.log('User updated', doc, oldDoc, patch)
})

patchEventEmitter.on(USER_DELETED, ({ doc }) => {
  console.log('User deleted', doc)
})
```

## Check my other projects

- [ts-migrate-mongoose](https://github.com/ilovepixelart/ts-migrate-mongoose) - Migration framework for mongoose
