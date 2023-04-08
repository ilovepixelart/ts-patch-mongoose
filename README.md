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

## Installation

```bash
npm install ts-patch-mongoose
```

## Usage example of plugin

```typescript
import { Schema, model } from 'mongoose'

import type IUser from '../interfaces/IUser'

import { patchHistoryPlugin } from 'ts-patch-mongoose'

import { USER_CREATED_EVENT, USER_DELETED_EVENT, USER_UPDATED_EVENT } from '../constants/events'

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
  eventCreated: USER_CREATED_EVENT,
  eventUpdated: USER_UPDATED_EVENT,
  eventDeleted: USER_DELETED_EVENT,
  omit: ['__v', 'role', 'createdAt', 'updatedAt']
})

const User = model('User', UserSchema)

export default User
```

## Somewhere in your code you can subscribe to events

```typescript
import { patchEventEmitter } from 'ts-patch-mongoose'

patchEventEmitter.on(USER_CREATED_EVENT, ({ doc }) => {
  console.log('User created', doc)
})
```
