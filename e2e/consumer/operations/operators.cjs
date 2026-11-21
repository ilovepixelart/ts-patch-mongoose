'use strict'

const { hasPath } = require('./gates.cjs')

// Each update operator the plugin replays to predict the updated document, with the edge cases of
// its replay: missing path, missing parent, scalar or null parent, wrong value or argument type.
// Updates the server rejects are kept: the plugin records them before the server runs the update.
// Fixture 1: n 1, tags ['t1'], labels ['l1', 'l2'], meta { color 'red', size 1 }, secret 's1',
// extra { a 1, nul null, list ['x', 'y'], empty [], obj { k 'v' }, 'sl/ash' 1, 'ti~lde' 2 }, and
// no score, note, at or items. Targets are fields the `full` profile does not omit.

const update = (name, change) => ({ name, run: ({ M, o, oid }) => M.updateOne({ _id: oid(1) }, change, o) })

module.exports = [
  update('updateOne:operators', { $set: { 'meta.color': 'green' }, $inc: { n: 2 }, $push: { tags: 't2' }, $pull: { labels: 'l1' }, $unset: { secret: 1 } }),

  update('updateOne:set-new-array-path', { $set: { 'extra.fresh.0': 'v' } }),
  // Segments that look numeric but are not array indices: the containers created for them are objects.
  update('updateOne:set-new-non-index-paths', { $set: { 'extra.inf.Infinity': 1, 'extra.nan.NaN': 2, 'extra.lead.01': 3 } }),
  update('updateOne:set-new-object-path', { $set: { 'extra.fresh.k': 'v' } }),
  update('updateOne:set-through-scalar', { $set: { 'extra.a.b': 1 } }),
  update('updateOne:set-through-null', { $set: { 'extra.nul.b': 1 } }),
  update('updateOne:set-null', { $set: { 'extra.a': null } }),
  update('updateOne:set-escaped-keys', { $set: { 'extra.sl/ash': 5, 'extra.ti~lde': 6 } }),
  update('updateOne:set-array-to-object', { $set: { 'extra.list': { k: 1 } } }),
  update('updateOne:set-object-to-array', { $set: { 'extra.obj': ['v'] } }),
  update('updateOne:set-shrink-array', { $set: { 'extra.list': ['x'] } }),
  update('updateOne:replace-subobject', { $set: { meta: { color: 'x' } } }),
  { name: 'updateOne:positional', run: ({ M, o, oid }) => M.updateOne({ _id: oid(1), labels: 'l2' }, { $set: { 'labels.$': 'L2' } }, o) },
  update('updateOne:array-index', { $set: { 'labels.1': 'L' } }),
  update('updateOne:set-null-argument', { $set: null, n: 2 }),
  update('updateOne:set-undefined-argument', { $set: undefined, n: 2 }),

  update('updateOne:unset-array-element', { $unset: { 'labels.0': 1 } }),
  update('updateOne:unset-missing', { $unset: { score: 1 } }),
  update('updateOne:unset-missing-parent', { $unset: { 'extra.none.x': 1 } }),
  update('updateOne:unset-through-scalar', { $unset: { 'extra.a.b': 1 } }),
  update('updateOne:unset-through-null', { $unset: { 'extra.nul.b': 1 } }),

  update('updateOne:inc-missing', { $inc: { score: 5 } }),
  update('updateOne:inc-through-scalar', { $inc: { 'extra.a.b': 1 } }),
  update('updateOne:inc-through-null', { $inc: { 'extra.nul.b': 1 } }),
  update('updateOne:inc-non-numeric-value', { $inc: { 'extra.obj': 1 } }),
  update('updateOne:inc-non-numeric-argument', { $inc: { 'extra.a': 'x' } }),
  update('updateOne:mul', { $mul: { n: 3, 'extra.a': 4 } }),
  update('updateOne:mul-missing', { $mul: { score: 2 } }),
  update('updateOne:mul-through-scalar', { $mul: { 'extra.a.b': 2 } }),

  update('updateOne:min-lower', { $min: { n: 0 } }),
  update('updateOne:min-higher', { $min: { n: 5 } }),
  update('updateOne:max-higher', { $max: { n: 10, 'extra.a': 5 } }),
  update('updateOne:max-lower', { $max: { n: 0 } }),
  update('updateOne:min+max-missing', { $min: { score: 3 }, $max: { 'extra.new': 7 } }),
  update('updateOne:min+max-missing-parent', { $min: { 'extra.none.lo': 1 }, $max: { 'extra.gone.hi': 2 } }),
  update('updateOne:min-undefined', { $min: { n: undefined } }),
  update('updateOne:max-undefined', { $max: { n: undefined } }),
  // Equal after coercion, different types: '1' <= 1 and '1' >= 1 hold, '1' < 1 and '1' > 1 do not.
  update('updateOne:min-equal-other-type', { $min: { 'extra.a': '1' } }),
  update('updateOne:max-equal-other-type', { $max: { 'extra.a': '1' } }),
  // The server rejects both paths in one update; the plugin replays $unset first, leaving an
  // existing array element that is undefined, which $min and $max then always replace.
  update('updateOne:unset-then-min', { $unset: { 'labels.0': 1 }, $min: { 'labels.0': 'a' } }),
  update('updateOne:unset-then-max', { $unset: { 'labels.0': 1 }, $max: { 'labels.0': 'a' } }),

  update('updateOne:rename', { $rename: { secret: 'note' } }),
  update('updateOne:rename-visible', { $rename: { sku: 'note' } }),
  update('updateOne:rename-missing', { $rename: { note: 'sku' } }),
  update('updateOne:rename-nested', { $rename: { 'extra.a': 'extra.b.c' } }),
  update('updateOne:rename-non-string', { $rename: { 'extra.a': 1 } }),
  update('updateOne:rename-through-scalar', { $rename: { 'extra.a.b': 'extra.c' } }),

  update('updateOne:currentDate', { $currentDate: { at: true } }),
  update('updateOne:currentDate-timestamp', { $currentDate: { 'extra.ts': { $type: 'timestamp' } } }),
  update('updateOne:currentDate-date-type', { $currentDate: { 'extra.day': { $type: 'date' } } }),
  update('updateOne:currentDate-null-spec', { $currentDate: { 'extra.day': null } }),
  update('updateOne:currentDate-undefined-spec', { $currentDate: { 'extra.day': undefined } }),

  update('updateOne:push', { $push: { 'extra.list': 'z' } }),
  update('updateOne:push-each', { $push: { tags: { $each: ['a', 'b'] } } }),
  update('updateOne:push-missing', { $push: { 'extra.fresh': 'v' } }),
  update('updateOne:push-null', { $push: { 'extra.list': null } }),
  update('updateOne:push-object', { $push: { 'extra.list': { k: 1 } } }),
  update('updateOne:push-each-non-array', { $push: { 'extra.list': { $each: 'xy' } } }),
  update('updateOne:push-non-array', { $push: { 'extra.a': 'v' } }),
  update('updateOne:push-through-scalar', { $push: { 'extra.a.b': 'v' } }),
  update('updateOne:addToSet', { $addToSet: { tags: 't1', labels: { $each: ['l2', 'l3'] } } }),
  update('updateOne:addToSet-each-duplicates', { $addToSet: { 'extra.list': { $each: ['x', 'z', 'z'] } } }),
  update('updateOne:addToSet-object', { $addToSet: { 'extra.list': { k: 1 } } }),
  update('updateOne:addToSet-missing', { $addToSet: { 'extra.set': 'v' } }),
  update('updateOne:addToSet-null', { $addToSet: { 'extra.list': null } }),
  update('updateOne:addToSet-each-non-array', { $addToSet: { 'extra.list': { $each: 'z' } } }),
  update('updateOne:addToSet-non-array', { $addToSet: { 'extra.a': 'v' } }),
  update('updateOne:addToSet-through-scalar', { $addToSet: { 'extra.a.b': 'v' } }),

  update('updateOne:pull', { $pull: { 'extra.list': 'x' } }),
  update('updateOne:pull-missing', { $pull: { 'extra.none': 'x' } }),
  update('updateOne:pull-non-array', { $pull: { 'extra.a': 1 } }),
  update('updateOne:pull-through-scalar', { $pull: { 'extra.a.b': 1 } }),
  update('updateOne:pullAll', { $pullAll: { labels: ['l1'] } }),
  update('updateOne:pullAll-missing', { $pullAll: { 'extra.none': ['x'] } }),
  update('updateOne:pullAll-non-array-argument', { $pullAll: { 'extra.list': 'x' } }),
  update('updateOne:pullAll-through-scalar', { $pullAll: { 'extra.a.b': ['x'] } }),
  // Two labels, so removing the first and removing the last give different arrays.
  update('updateOne:pop-last', { $pop: { labels: 1 } }),
  update('updateOne:pop-first', { $pop: { labels: -1 } }),
  update('updateOne:pop-single', { $pop: { tags: 1 } }),
  update('updateOne:pop-empty', { $pop: { 'extra.empty': 1 } }),
  update('updateOne:pop-missing', { $pop: { 'extra.none': 1 } }),
  update('updateOne:pop-through-scalar', { $pop: { 'extra.a.b': 1 } }),

  update('updateOne:subdocument-push', { $push: { items: { name: 'i1', qty: 1 } } }),
  { ...update('updateOne:bigint', { $set: { big: 9007199254740993n } }), available: hasPath('big') },
  // BigInts cannot be serialized to JSON, so these compare array entries by identity instead.
  { ...update('updateOne:addToSet-bigint', { $addToSet: { bigs: { $each: [5n, 7n] } } }), available: hasPath('bigs') },
  { ...update('updateOne:pull-bigint', { $pull: { bigs: 5n } }), available: hasPath('bigs') },
  { ...update('updateOne:pullAll-bigint', { $pullAll: { bigs: [6n] } }), available: hasPath('bigs') },
]
