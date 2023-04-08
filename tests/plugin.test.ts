import mongoose from 'mongoose'

import Test from './models/Test'
import History from '../src/models/History'

describe('mongoose', () => {
  const uri = `${globalThis.__MONGO_URI__}${globalThis.__MONGO_DB_NAME__}`

  beforeAll(async () => {
    await mongoose.connect(uri)
  })

  afterAll(async () => {
    await mongoose.connection.close()
  })

  beforeEach(async () => {
    await mongoose.connection.collection('tests').deleteMany({})
    await mongoose.connection.collection('history').deleteMany({})
  })

  it('should createHistory', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.name = 'Alice'
    await user.save()

    user.name = 'Bob'
    await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(3)

    expect(history[0].op).toBe('create')
    expect(history[0].doc.name).toBe('John')
    expect(history[0].version).toBe(0)

    expect(history[1].op).toBe('update')
    expect(history[1].patch).toHaveLength(2)
    expect(history[1].patch[1].value).toBe('Alice')
    expect(history[1].version).toBe(1)

    expect(history[2].op).toBe('update')
    expect(history[1].patch).toHaveLength(2)
    expect(history[2].patch[1].value).toBe('Bob')
    expect(history[2].version).toBe(2)
  })

  it('should omit update of role', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.role = 'manager'
    await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(1)

    expect(history[0].op).toBe('create')
    expect(history[0].doc.name).toBe('John')
    expect(history[0].doc.role).toBe('user')
    expect(history[0].version).toBe(0)

    expect(user.role).toBe('manager')
  })

  it('should updateOne', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await Test.updateOne({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    console.log(history[1].patch)

    expect(history[0].op).toBe('create')
    expect(history[1].patch).toHaveLength(2)
    expect(history[0].doc.name).toBe('John')
    expect(history[0].version).toBe(0)

    expect(history[1].op).toBe('updateOne')
    expect(history[1].patch).toHaveLength(2)
    expect(history[1].patch[1].value).toBe('Alice')
    expect(history[1].version).toBe(1)
  })

  it('should findOneAndUpdate', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await Test.findOneAndUpdate({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    expect(history[0].op).toBe('create')
    expect(history[1].patch).toHaveLength(2)
    expect(history[0].doc.name).toBe('John')
    expect(history[0].version).toBe(0)

    expect(history[1].op).toBe('findOneAndUpdate')
    expect(history[1].patch).toHaveLength(2)
    expect(history[1].patch[1].value).toBe('Alice')
    expect(history[1].version).toBe(1)
  })

  it('should update deprecated', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await Test.update({ _id: user._id }, { $set: { name: 'Alice' } }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    expect(history[0].op).toBe('create')
    expect(history[1].patch).toHaveLength(2)
    expect(history[0].doc.name).toBe('John')
    expect(history[0].version).toBe(0)

    expect(history[1].op).toBe('update')
    expect(history[1].patch).toHaveLength(2)
    expect(history[1].patch[1].value).toBe('Alice')
    expect(history[1].version).toBe(1)
  })
})
