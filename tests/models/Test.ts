import { Schema, model } from 'mongoose'

import type ITest from '../interfaces/ITest'

import patchPlugin from '../../src/plugin'

const TestSchema = new Schema<ITest>({
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true
  }
}, { timestamps: true })

TestSchema.plugin(patchPlugin, {
  collectionName: 'tests',
  omit: ['__v', 'role', 'createdAt', 'updatedAt']
})

const Test = model('Test', TestSchema)

export default Test
