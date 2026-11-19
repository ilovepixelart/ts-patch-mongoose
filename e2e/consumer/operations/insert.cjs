'use strict'

const { fromMajor } = require('./gates.cjs')

// Model-level inserts: create runs the save hooks per document, insertMany its own post hook.

module.exports = [
  { name: 'create', run: ({ M, o, fresh }) => M.create([fresh(10, 'new')], o) },
  // `ordered` (mongoose 7+) saves in series; mongoose 8+ requires it with a session. Mongoose 6
  // saves in parallel, and parallel operations in one transaction fail at random.
  { name: 'create:many', available: fromMajor(7), run: ({ M, o, fresh }) => M.create([fresh(10, 'new1'), fresh(11, 'new2')], { ...o, ordered: true }) },
  { name: 'insertMany', run: ({ M, o, fresh }) => M.insertMany([fresh(10, 'new1'), fresh(11, 'new2')], o) },
  { name: 'insertMany:lean', run: ({ M, o, fresh }) => M.insertMany([fresh(10, 'new1'), fresh(11, 'new2')], { ...o, lean: true }) },
  // A lean insert passes the given objects to the hook as they are, an undefined field included.
  { name: 'insertMany:lean-undefined-field', run: ({ M, o, fresh }) => M.insertMany([{ ...fresh(10, 'new'), note: undefined }], { ...o, lean: true }) },
  { name: 'insertMany:duplicate-unordered', run: ({ M, o, fresh }) => M.insertMany([fresh(1, 'dup'), fresh(12, 'new3')], { ...o, ordered: false }) },
]
