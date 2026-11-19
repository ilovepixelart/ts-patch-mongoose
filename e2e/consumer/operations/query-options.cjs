'use strict'

// Per-query options that switch off the event, the history entry, or the hook altogether.

module.exports = [
  { name: 'updateOne:ignoreEvent', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 51 } }, { ...o, ignoreEvent: true }) },
  { name: 'updateOne:ignorePatchHistory', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 52 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'updateOne:ignoreEvent+ignorePatchHistory', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 53 } }, { ...o, ignoreEvent: true, ignorePatchHistory: true }) },
  { name: 'updateOne:ignoreHook', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 54 } }, { ...o, ignoreHook: true }) },
  { name: 'updateMany:ignorePatchHistory', run: ({ M, o }) => M.updateMany({}, { $inc: { n: 1 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'updateMany:ignoreHook', run: ({ M, o }) => M.updateMany({}, { $inc: { n: 1 } }, { ...o, ignoreHook: true }) },
  { name: 'findOneAndUpdate:ignoreEvent', run: ({ M, o, oid }) => M.findOneAndUpdate({ _id: oid(2) }, { $set: { n: 9 } }, { ...o, ignoreEvent: true }) },
  { name: 'deleteOne:ignoreHook', run: ({ M, o, oid }) => M.deleteOne({ _id: oid(1) }, { ...o, ignoreHook: true }) },
  { name: 'deleteOne:ignoreEvent+ignorePatchHistory', run: ({ M, o, oid }) => M.deleteOne({ _id: oid(1) }, { ...o, ignoreEvent: true, ignorePatchHistory: true }) },
  { name: 'deleteMany:ignoreEvent', run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, { ...o, ignoreEvent: true }) },
  { name: 'deleteMany:ignorePatchHistory', run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'deleteMany:ignoreHook', run: ({ M, o }) => M.deleteMany({}, { ...o, ignoreHook: true }) },
]
