'use strict'

const { has, hasDocument } = require('./gates.cjs')

// Deletes: the delete hooks read the matched documents first, pass them to preDelete, then record them.

module.exports = [
  { name: 'deleteOne', run: ({ M, o, oid }) => M.deleteOne({ _id: oid(1) }, o) },
  { name: 'deleteOne:document', run: async ({ M, o, oid }) => (await M.findById(oid(1), null, o)).deleteOne() },
  // The filter matches fixtures 2 and 3; deleteOne removes and records one of them.
  { name: 'deleteOne:many-match', run: ({ M, o }) => M.deleteOne({ n: { $gte: 2 } }, o) },
  { name: 'deleteOne:no-match', run: ({ M, o, oid }) => M.deleteOne({ _id: oid(99) }, o) },
  { name: 'deleteMany', run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, o) },
  { name: 'deleteMany:all', run: ({ M, o }) => M.deleteMany({}, o) },
  { name: 'deleteMany:no-match', run: ({ M, o }) => M.deleteMany({ n: { $gt: 1000 } }, o) },
  { name: 'findOneAndDelete', run: ({ M, o, oid }) => M.findOneAndDelete({ _id: oid(2) }, o) },
  { name: 'findOneAndDelete:no-match', run: ({ M, o, oid }) => M.findOneAndDelete({ _id: oid(99) }, o) },
  { name: 'findByIdAndDelete', run: ({ M, o, oid }) => M.findByIdAndDelete(oid(3), o) },
  { name: 'findOneAndRemove', available: has('findOneAndRemove'), run: ({ M, o, oid }) => M.findOneAndRemove({ _id: oid(2) }, o) },
  { name: 'findByIdAndRemove', available: has('findByIdAndRemove'), run: ({ M, o, oid }) => M.findByIdAndRemove(oid(3), o) },
  { name: 'remove', available: has('remove'), run: ({ M, o, oid }) => M.remove({ _id: oid(1) }, o) },
  { name: 'remove:document', available: hasDocument('remove'), run: async ({ M, o, oid }) => (await M.findById(oid(1), null, o)).remove() },
]
