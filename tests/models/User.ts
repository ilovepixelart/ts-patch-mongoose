import { Schema, model } from 'mongoose'

import type IUser from '../interfaces/IUser'

import patchPlugin from '../../src/plugin'

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

UserSchema.plugin(patchPlugin, {
  collectionName: 'tests',
  eventCreated: USER_CREATED_EVENT,
  eventUpdated: USER_UPDATED_EVENT,
  eventDeleted: USER_DELETED_EVENT,
  omit: ['__v', 'role', 'createdAt', 'updatedAt']
})

const User = model('User', UserSchema)

export default User
