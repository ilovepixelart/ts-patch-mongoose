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

    const [first, second, third] = history

    expect(first.op).toBe('create')
    expect(first.patch).toHaveLength(0)
    expect(first.doc.name).toBe('John')
    expect(first.doc.role).toBe('user')
    expect(first.version).toBe(0)

    expect(second.op).toBe('update')
    expect(second.patch).toHaveLength(2)
    expect(second.patch[1].value).toBe('Alice')
    expect(second.version).toBe(1)

    expect(third.op).toBe('update')
    expect(third.patch).toHaveLength(2)
    expect(third.patch[1].value).toBe('Bob')
    expect(third.version).toBe(2)
  })

  it('should omit update of role', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    user.role = 'manager'
    await user.save()

    const history = await History.find({})
    expect(history).toHaveLength(1)

    const [first] = history

    expect(first.op).toBe('create')
    expect(first.patch).toHaveLength(0)
    expect(first.doc.name).toBe('John')
    expect(first.doc.role).toBe('user')
    expect(first.version).toBe(0)

    expect(user.role).toBe('manager')
  })

  it('should updateOne', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await Test.updateOne({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    expect(first.op).toBe('create')
    expect(first.patch).toHaveLength(0)
    expect(first.doc.name).toBe('John')
    expect(first.doc.role).toBe('user')
    expect(first.version).toBe(0)

    expect(second.op).toBe('updateOne')
    expect(second.patch).toHaveLength(2)
    expect(second.patch[1].value).toBe('Alice')
    expect(second.version).toBe(1)
  })

  it('should findOneAndUpdate', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await Test.findOneAndUpdate({ _id: user._id }, { name: 'Alice' }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    expect(first.op).toBe('create')
    expect(second.patch).toHaveLength(2)
    expect(first.doc.name).toBe('John')
    expect(first.version).toBe(0)

    expect(second.op).toBe('findOneAndUpdate')
    expect(second.patch).toHaveLength(2)
    expect(second.patch[1].value).toBe('Alice')
    expect(second.version).toBe(1)
  })

  it('should update deprecated', async () => {
    const user = await Test.create({ name: 'John', role: 'user' })
    expect(user.name).toBe('John')

    await Test.update({ _id: user._id }, { $set: { name: 'Alice' } }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(2)

    const [first, second] = history

    expect(first.op).toBe('create')
    expect(second.patch).toHaveLength(2)
    expect(first.doc.name).toBe('John')
    expect(first.version).toBe(0)

    expect(second.op).toBe('update')
    expect(second.patch).toHaveLength(2)
    expect(second.patch[1].value).toBe('Alice')
    expect(second.version).toBe(1)
  })

  it('should updated deprecated with multi flag', async () => {
    const john = await Test.create({ name: 'John', role: 'user' })
    expect(john.name).toBe('John')
    const alice = await Test.create({ name: 'Alice', role: 'user' })
    expect(alice.name).toBe('Alice')

    await Test.update({ role: 'user' }, { $set: { name: 'Bob' } }, { multi: true }).exec()

    const history = await History.find({})
    expect(history).toHaveLength(4)

    const [first, second, third, fourth] = history

    expect(first.op).toBe('create')
    expect(second.patch).toHaveLength(0)
    expect(first.doc.name).toBe('John')
    expect(first.doc.role).toBe('user')
    expect(first.version).toBe(0)

    expect(second.op).toBe('create')
    expect(second.patch).toHaveLength(0)
    expect(second.doc.name).toBe('Alice')
    expect(first.doc.role).toBe('user')
    expect(second.version).toBe(0)

    expect(third.op).toBe('update')
    expect(third.patch).toHaveLength(2)
    expect(third.patch[1].value).toBe('Bob')
    expect(third.version).toBe(1)

    expect(fourth.op).toBe('update')
    expect(fourth.patch).toHaveLength(2)
    expect(fourth.patch[1].value).toBe('Bob')
    expect(fourth.version).toBe(1)
  })
})
