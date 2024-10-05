import { Schema } from 'mongoose'

import type IDescription from '../interfaces/IDescription'

const DescriptionSchema = new Schema<IDescription>(
  {
    summary: {
      type: String,
      required: true,
    },
  },
  { timestamps: false, _id: false },
)

export default DescriptionSchema
