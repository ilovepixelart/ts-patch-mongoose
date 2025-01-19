import { Schema, model } from 'mongoose'

export interface Description {
  summary: string
}

export const DescriptionSchema = new Schema<Description>(
  {
    summary: {
      type: String,
      required: true,
    },
  },
  { timestamps: false, _id: false },
)
