import type { Types } from 'mongoose'

import type IDescription from './IDescription'

interface IProduct {
  name: string
  groups: [string]
  description: IDescription
  addedBy: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

export default IProduct