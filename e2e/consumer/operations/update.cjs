'use strict'

const { has } = require('./gates.cjs')

// Query updates and replacements without upsert: the update hooks patch every matched document.
// bulkWrite is not hooked; it shows what the plugin does not see, so the store oracles expect no record of it.

module.exports = [
  { name: 'updateOne', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 50 } }, o) },
  { name: 'updateOne:implicit-set', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { n: 60, sku: 'a2' }, o) },
  { name: 'updateOne:unchanged', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 1 } }, o) },
  // Matches nothing and has no upsert, while its implicit $set matches fixture 'b': nothing is recorded.
  { name: 'updateOne:implicit-set-no-match', run: ({ M, o, oid }) => M.updateOne({ _id: oid(99) }, { sku: 'b' }, o) },
  { name: 'updateOne:set-unknown-field', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { unknown: 1 } }, o) },
  // Values the plugin clones from the update before replaying it: a Map, and into Mixed a Date, a RegExp and a Buffer.
  { name: 'updateOne:set-map', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { dict: new Map([['b', 2]]) } }, o) },
  { name: 'updateOne:set-mixed-date', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { 'extra.when': new Date(Date.UTC(2021, 5, 1)) } }, o) },
  { name: 'updateOne:set-mixed-regexp', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { 'extra.re': /a+b/gi } }, o) },
  { name: 'updateOne:set-mixed-buffer', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { 'extra.bin': Buffer.from('ab') } }, o) },
  // A filter on a path the schema lacks: whether it is kept or stripped decides what matches (strictQuery).
  { name: 'updateOne:unknown-field-filter', run: ({ M, o }) => M.updateOne({ notInSchema: 'x' }, { $set: { n: 7 } }, o) },
  { name: 'updateOne:no-match', run: ({ M, o, oid }) => M.updateOne({ _id: oid(99) }, { $set: { n: 1 } }, o) },
  { name: 'updateOne:pipeline', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, [{ $set: { n: { $add: ['$n', 10] } } }], { ...o, updatePipeline: true }) },
  { name: 'updateOne:document', run: async ({ M, o, oid }) => (await M.findById(oid(1), null, o)).updateOne({ $set: { n: 5 } }, o) },
  // Successive updates of one document: the history version counts up from 0.
  {
    name: 'updateOne:repeated',
    run: async ({ M, o, oid }) => {
      for (const n of [11, 12, 13]) await M.updateOne({ _id: oid(1) }, { $set: { n } }, o)
    },
  },
  { name: 'updateMany', run: ({ M, o }) => M.updateMany({}, { $inc: { n: 1 }, $push: { tags: 'm' } }, o) },
  { name: 'updateMany:no-match', run: ({ M, o }) => M.updateMany({ n: { $gt: 1000 } }, { $inc: { n: 1 } }, o) },
  { name: 'update', available: has('update'), run: ({ M, o, oid }) => M.update({ _id: oid(1) }, { $set: { n: 70 } }, o) },
  { name: 'findOneAndUpdate', run: ({ M, o, oid }) => M.findOneAndUpdate({ _id: oid(2) }, { $set: { sku: 'b2' } }, o) },
  { name: 'findOneAndUpdate:returnDocument-after', run: ({ M, o, oid }) => M.findOneAndUpdate({ _id: oid(2) }, { $set: { sku: 'b3' } }, { ...o, returnDocument: 'after' }) },
  { name: 'findOneAndUpdate:no-match', run: ({ M, o, oid }) => M.findOneAndUpdate({ _id: oid(99) }, { $set: { n: 1 } }, o) },
  { name: 'findByIdAndUpdate', run: ({ M, o, oid }) => M.findByIdAndUpdate(oid(3), { $inc: { n: 5 } }, o) },
  { name: 'replaceOne', run: ({ M, o, oid }) => M.replaceOne({ _id: oid(1) }, { sku: 'a-replaced', n: 100, tags: [] }, o) },
  { name: 'findOneAndReplace', run: ({ M, o, oid }) => M.findOneAndReplace({ _id: oid(2) }, { sku: 'b-replaced', n: 200 }, o) },
  {
    name: 'bulkWrite',
    silent: true,
    history: false,
    run: ({ M, o, oid }) => M.bulkWrite([{ updateOne: { filter: { _id: oid(1) }, update: { $set: { n: 80 } } } }, { deleteOne: { filter: { _id: oid(2) } } }], o),
  },
]
