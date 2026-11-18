'use strict'

// Every model operation the plugin hooks, plus bulkWrite, which it does not. Each `run` gets the
// model, the session options of the current mode (`o`), and helpers for fixed ids and documents.
// `available` gates operations that a mongoose major no longer has.

const has = (name) => (M) => typeof M[name] === 'function'
const hasDocument = (name) => (M) => typeof M.prototype[name] === 'function'

const operations = [
  { name: 'save:new', run: ({ M, o, fresh }) => new M(fresh(10, 'new')).save(o) },
  {
    name: 'save:existing',
    run: async ({ M, o, oid }) => {
      const doc = await M.findById(oid(1), null, o)
      doc.n += 1
      doc.tags.push('t2')
      doc.meta.color = 'blue'
      return doc.save(o)
    },
  },
  { name: 'save:unchanged', run: async ({ M, o, oid }) => (await M.findById(oid(1), null, o)).save(o) },
  { name: 'create', run: ({ M, o, fresh }) => M.create([fresh(10, 'new')], o) },
  // Mongoose 7+ saves in series with `ordered`; mongoose 8+ requires it with a session.
  { name: 'create:many', run: ({ M, o, fresh }) => M.create([fresh(10, 'new1'), fresh(11, 'new2')], { ...o, ordered: true }) },
  { name: 'insertMany', run: ({ M, o, fresh }) => M.insertMany([fresh(10, 'new1'), fresh(11, 'new2')], o) },
  { name: 'insertMany:lean', run: ({ M, o, fresh }) => M.insertMany([fresh(10, 'new1'), fresh(11, 'new2')], { ...o, lean: true }) },
  { name: 'updateOne', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 50 } }, o) },
  { name: 'updateOne:operators', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { 'meta.color': 'green' }, $inc: { n: 2 }, $push: { tags: 't2' }, $pull: { labels: 'l1' }, $unset: { secret: 1 } }, o) },
  { name: 'updateOne:implicit-set', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { n: 60, sku: 'a2' }, o) },
  { name: 'updateOne:unchanged', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 1 } }, o) },
  { name: 'updateOne:no-match', run: ({ M, o, oid }) => M.updateOne({ _id: oid(99) }, { $set: { n: 1 } }, o) },
  { name: 'updateOne:pipeline', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, [{ $set: { n: { $add: ['$n', 10] } } }], { ...o, updatePipeline: true }) },
  { name: 'updateMany', run: ({ M, o }) => M.updateMany({}, { $inc: { n: 1 }, $push: { tags: 'm' } }, o) },
  { name: 'update', available: has('update'), run: ({ M, o, oid }) => M.update({ _id: oid(1) }, { $set: { n: 70 } }, o) },
  { name: 'findOneAndUpdate', run: ({ M, o, oid }) => M.findOneAndUpdate({ _id: oid(2) }, { $set: { sku: 'b2' } }, o) },
  { name: 'findByIdAndUpdate', run: ({ M, o, oid }) => M.findByIdAndUpdate(oid(3), { $inc: { n: 5 } }, o) },
  { name: 'replaceOne', run: ({ M, o, oid }) => M.replaceOne({ _id: oid(1) }, { sku: 'a-replaced', n: 100, tags: [] }, o) },
  { name: 'findOneAndReplace', run: ({ M, o, oid }) => M.findOneAndReplace({ _id: oid(2) }, { sku: 'b-replaced', n: 200 }, o) },
  { name: 'upsert:updateOne-insert', run: ({ M, o }) => M.updateOne({ sku: 'u1' }, { $set: { n: 1 } }, { ...o, upsert: true }) },
  { name: 'upsert:updateOne-match', run: ({ M, o }) => M.updateOne({ sku: 'a' }, { $set: { n: 2 } }, { ...o, upsert: true }) },
  { name: 'upsert:findOneAndUpdate-insert', run: ({ M, o }) => M.findOneAndUpdate({ sku: 'u2' }, { $set: { n: 2 }, $push: { tags: 'x' } }, { ...o, upsert: true }) },
  { name: 'upsert:replaceOne-insert', run: ({ M, o }) => M.replaceOne({ sku: 'u3' }, { sku: 'u3', n: 3 }, { ...o, upsert: true }) },
  { name: 'deleteOne', run: ({ M, o, oid }) => M.deleteOne({ _id: oid(1) }, o) },
  { name: 'deleteOne:document', run: async ({ M, o, oid }) => (await M.findById(oid(1), null, o)).deleteOne() },
  { name: 'deleteMany', run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, o) },
  { name: 'deleteMany:no-match', run: ({ M, o }) => M.deleteMany({ n: { $gt: 1000 } }, o) },
  { name: 'findOneAndDelete', run: ({ M, o, oid }) => M.findOneAndDelete({ _id: oid(2) }, o) },
  { name: 'findByIdAndDelete', run: ({ M, o, oid }) => M.findByIdAndDelete(oid(3), o) },
  { name: 'findOneAndRemove', available: has('findOneAndRemove'), run: ({ M, o, oid }) => M.findOneAndRemove({ _id: oid(2) }, o) },
  { name: 'findByIdAndRemove', available: has('findByIdAndRemove'), run: ({ M, o, oid }) => M.findByIdAndRemove(oid(3), o) },
  { name: 'remove', available: has('remove'), run: ({ M, o, oid }) => M.remove({ _id: oid(1) }, o) },
  { name: 'remove:document', available: hasDocument('remove'), run: async ({ M, o, oid }) => (await M.findById(oid(1), null, o)).remove() },
  {
    name: 'bulkWrite',
    run: ({ M, o, oid }) => M.bulkWrite([{ updateOne: { filter: { _id: oid(1) }, update: { $set: { n: 80 } } } }, { deleteOne: { filter: { _id: oid(2) } } }], o),
  },
  { name: 'updateOne:ignoreEvent', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 51 } }, { ...o, ignoreEvent: true }) },
  { name: 'updateOne:ignorePatchHistory', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 52 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'updateOne:ignoreEvent+ignorePatchHistory', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 53 } }, { ...o, ignoreEvent: true, ignorePatchHistory: true }) },
  { name: 'updateOne:ignoreHook', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, { $set: { n: 54 } }, { ...o, ignoreHook: true }) },
  { name: 'updateMany:ignorePatchHistory', run: ({ M, o }) => M.updateMany({}, { $inc: { n: 1 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'deleteMany:ignoreEvent', run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, { ...o, ignoreEvent: true }) },
  { name: 'deleteMany:ignorePatchHistory', run: ({ M, o }) => M.deleteMany({ n: { $gte: 2 } }, { ...o, ignorePatchHistory: true }) },
  { name: 'deleteOne:ignoreHook', run: ({ M, o, oid }) => M.deleteOne({ _id: oid(1) }, { ...o, ignoreHook: true }) },
]

module.exports = { operations }
