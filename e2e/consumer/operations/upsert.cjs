'use strict'

// Upserts: `-insert` filters match nothing, so the plugin records a create for the inserted
// document; `-match` filters match fixture 'a', so it records a patch.

module.exports = [
  { name: 'upsert:updateOne-insert', run: ({ M, o }) => M.updateOne({ sku: 'u1' }, { $set: { n: 1 } }, { ...o, upsert: true }) },
  { name: 'upsert:updateOne-match', run: ({ M, o }) => M.updateOne({ sku: 'a' }, { $set: { n: 2 } }, { ...o, upsert: true }) },
  { name: 'upsert:findOneAndUpdate-insert', run: ({ M, o }) => M.findOneAndUpdate({ sku: 'u2' }, { $set: { n: 2 }, $push: { tags: 'x' } }, { ...o, upsert: true }) },
  { name: 'upsert:replaceOne-insert', run: ({ M, o }) => M.replaceOne({ sku: 'u3' }, { sku: 'u3', n: 3 }, { ...o, upsert: true }) },
  { name: 'upsert:updateMany-insert', run: ({ M, o }) => M.updateMany({ sku: 'u5' }, { $set: { n: 5 } }, { ...o, upsert: true }) },
  { name: 'upsert:findOneAndReplace-insert', run: ({ M, o }) => M.findOneAndReplace({ sku: 'u6' }, { sku: 'u6', n: 6 }, { ...o, upsert: true }) },
  { name: 'upsert:findByIdAndUpdate-insert', run: ({ M, o, oid }) => M.findByIdAndUpdate(oid(50), { $set: { n: 50 } }, { ...o, upsert: true }) },
  { name: 'upsert:setOnInsert-insert', run: ({ M, o }) => M.updateOne({ sku: 'u7' }, { $set: { n: 7 }, $setOnInsert: { tags: ['new'] } }, { ...o, upsert: true }) },
  { name: 'upsert:setOnInsert-match', run: ({ M, o }) => M.updateOne({ sku: 'a' }, { $set: { n: 8 }, $setOnInsert: { tags: ['new'] } }, { ...o, upsert: true }) },
  // The implicit $set also matches fixture 'a': the newest match is the inserted document.
  { name: 'upsert:implicit-set-duplicate-insert', run: ({ M, o }) => M.updateOne({ n: 999 }, { sku: 'a' }, { ...o, upsert: true }) },
  // An operator filter the inserted document does not match: it is found by the replayed update.
  { name: 'upsert:operator-filter-insert', run: ({ M, o }) => M.updateOne({ n: { $gt: 1000 } }, { $set: { sku: 'x9' } }, { ...o, upsert: true }) },
  // An empty update: the plugin finds the inserted document by the filter alone.
  { name: 'upsert:filter-only-insert', run: ({ M, o }) => M.updateOne({ sku: 'u8' }, {}, { ...o, upsert: true }) },
]
