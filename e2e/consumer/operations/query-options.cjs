'use strict'

// Per-query options that switch off the event, the history entry, or the hook altogether. `history:
// false` marks the ones that write no history, and `silent` the ones that record nothing at all, so
// the store oracles (e2e/store-oracle.mjs) expect neither.

module.exports = [
  { name: 'updateOne:ignoreEvent', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 51 } }, { ...o, ignoreEvent: true }) },
  { name: 'updateOne:ignorePatchHistory', history: false, run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 52 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'updateOne:ignoreEvent+ignorePatchHistory', history: false, silent: true, run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 53 } }, { ...o, ignoreEvent: true, ignorePatchHistory: true }) },
  { name: 'updateOne:ignoreHook', history: false, silent: true, run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 54 } }, { ...o, ignoreHook: true }) },
  { name: 'updateMany:ignorePatchHistory', history: false, run: ({ M, o }) => M.updateMany({}, { $inc: { n: 1 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'updateMany:ignoreHook', history: false, silent: true, run: ({ M, o }) => M.updateMany({}, { $inc: { n: 1 } }, { ...o, ignoreHook: true }) },
  { name: 'findOneAndUpdate:ignoreEvent', run: ({ M, o, oid }) => M.findOneAndUpdate({ _id: oid(2) }, { $set: { n: 9 } }, { ...o, ignoreEvent: true }) },
  { name: 'deleteOne:ignoreHook', history: false, silent: true, run: ({ M, o, oid }) => M.deleteOne({ _id: oid(1) }, { ...o, ignoreHook: true }) },
  { name: 'deleteOne:ignoreEvent+ignorePatchHistory', history: false, silent: true, run: ({ M, o, oid }) => M.deleteOne({ _id: oid(1) }, { ...o, ignoreEvent: true, ignorePatchHistory: true }) },
  { name: 'deleteMany:ignoreEvent', run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, { ...o, ignoreEvent: true }) },
  { name: 'deleteMany:ignorePatchHistory', history: false, run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'deleteMany:ignoreHook', history: false, silent: true, run: ({ M, o }) => M.deleteMany({}, { ...o, ignoreHook: true }) },
]
