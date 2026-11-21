# The laws: the proven contract of ts-patch-mongoose. A human states them; PROOF.bend must prove them,
# and `npm run laws` fails while one is open. The models they quote mirror src/; SPEC.bend holds the
# predicates they use. Claims not yet proven are in CLAIMS.bend.

import Base
import ./patch.bend as P
import ./chunk.bend as C
import ./entry.bend as E
import ./ttl.bend as Tt
import ./omit.bend as O
import ./history.bend as Hs
import ./SPEC.bend as Spec

# LAW (the contract): applying the diff of a and b to a gives a document that agrees with b on every key.
law apply_diff_roundtrip:
  for +a: +List<P.Entry>
  for +b: +List<P.Entry>
  for db: Spec.Distinct(b)
  for +j: Nat
  {P.lookup(P.apply(P.diff(a, b), a), j) == P.lookup(b, j) : Maybe<Nat>}

# LAW: the round trip needs distinct keys: with key 1 twice in the target, it reads the last value, not the first.
law roundtrip_needs_distinct:
  {P.lookup(P.apply(P.diff({[] : +List<P.Entry>}, {[P.E{1n, 0n}, P.E{1n, 1n}] : +List<P.Entry>}), {[] : +List<P.Entry>}), 1n) != P.lookup({[P.E{1n, 0n}, P.E{1n, 1n}] : +List<P.Entry>}, 1n) : Maybe<Nat>}

# LAW: a document diffed against itself gives no operations.
law diff_self_empty:
  for +a: +List<P.Entry>
  for da: Spec.Distinct(a)
  {P.diff(a, a) == {[] : List<P.Op>} : List<P.Op>}

# ---- chunk ----

# LAW: the chunks of a list, concatenated, are the list: no element lost, repeated or moved.
law chunk_concat:
  for +xs: +List<Nat>
  for +size: Nat
  {List.concat(&2, Nat, C.chunk(xs, size)) == xs : +List<Nat>}

# ---- omitDeep ----

# LAW: a dotted omit path whose head is unsafe (constructor, prototype) changes nothing, at any depth.
law omit_unsafe_path_ignored:
  for fuel: Nat
  for n: O.Node
  for +u: Nat
  for +un: {O.unsafe(u) == True{} : Bool}
  for +x: Nat
  for +xs: +List<Nat>
  for +keys: +List<+List<Nat>>
  {O.go(fuel, n, O.with_path(u, x, xs, keys)) == O.go(fuel, n, keys) : O.Node}

# ---- history contract ----

# LAW: an update or delete with ignoreHook writes no history and emits no event.
law ignore_hook_silent:
  for +c: Hs.Cfg
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for cmd: Hs.Cmd
  for q: Spec.IgnoresHook(cmd)
  {Hs.hist_of(Hs.step(c, Hs.S{store, hist, evs}, cmd)) == hist : +List<Hs.Hist>}

# LAW: an update of a missing document changes nothing.
law update_missing_noop:
  for +c: Hs.Cfg
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +doc: +List<P.Entry>
  for +f: Hs.Flags
  for e: {Hs.find(store, id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  {Hs.step(c, Hs.S{store, hist, evs}, Hs.Update{id, doc, f}) == Hs.S{store, hist, evs} : Hs.State}

# LAW: a delete of a missing document changes nothing.
law delete_missing_noop:
  for +c: Hs.Cfg
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +f: Hs.Flags
  for e: {Hs.find(store, id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  {Hs.step(c, Hs.S{store, hist, evs}, Hs.Delete{id, f}) == Hs.S{store, hist, evs} : Hs.State}

# LAW: creating an id that exists changes nothing.
law create_existing_noop:
  for +c: Hs.Cfg
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +doc: +List<P.Entry>
  for +old: +List<P.Entry>
  for e: {Hs.find(store, id) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  {Hs.step(c, Hs.S{store, hist, evs}, Hs.Create{id, doc}) == Hs.S{store, hist, evs} : Hs.State}

# LAW: with patch history disabled, no command writes history.
law disabled_writes_no_history:
  for cmds: List<Hs.Cmd>
  for +ev: Bool
  for st: Hs.State
  {Hs.hist_of(Hs.run(cmds, Hs.Cfg{False{}, ev}, st)) == Hs.hist_of(st) : +List<Hs.Hist>}

# LAW: with no events configured, no command emits one.
law unconfigured_emits_nothing:
  for cmds: List<Hs.Cmd>
  for +h: Bool
  for st: Hs.State
  {Hs.evs_of(Hs.run(cmds, Hs.Cfg{h, False{}}, st)) == Hs.evs_of(st) : +List<Hs.Ev>}

# LAW: the stored documents depend on the commands only: never on the configuration, the switches,
# the history or the events.
law store_independent:
  for cmds: List<Hs.Cmd>
  for +c: Hs.Cfg
  for st: Hs.State
  {Hs.store_of(Hs.run(cmds, c, st)) == Spec.store_run(cmds, Hs.store_of(st)) : +List<Hs.Rec>}

# LAW: a key the omit option lists never reaches history: no command records it in an entry's
# document or patch.
law omitted_never_recorded:
  for +c: Hs.Cfg
  for +keys: +List<Nat>
  for +i: Bool
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for cmd: Hs.Cmd
  for +k: Nat
  for +m: {Hs.mem(keys, k) == True{} : Bool}
  for q: {Spec.hist_mentions(hist, k) == False{} : Bool}
  {Spec.hist_mentions(Hs.hist_of(Hs.step_with(c, Hs.Omit{keys, i}, Hs.S{store, hist, evs}, cmd)), k) == False{} : Bool}

# LAW: an update that changes only omitted keys records no history entry and emits no event.
law omit_only_change_silent:
  for +c: Hs.Cfg
  for +keys: +List<Nat>
  for +i: Bool
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +doc: +List<P.Entry>
  for +old: +List<P.Entry>
  for +f: Hs.Flags
  for e: {Hs.find(store, id) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  for d: Spec.Distinct(Hs.strip(keys, old))
  for s: {Hs.strip(keys, old) == Hs.strip(keys, doc) : +List<P.Entry>}
  {Spec.records(Hs.step_with(c, Hs.Omit{keys, i}, Hs.S{store, hist, evs}, Hs.Update{id, doc, f})) == Hs.S{[], hist, evs} : Hs.State}

# ---- bulk operations and upserts ----

# LAW: an upsert of an existing document is an update of it.
law upsert_existing_is_update:
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +doc: +List<P.Entry>
  for +old: +List<P.Entry>
  for +f: Hs.Flags
  for e: {Hs.find(store, id) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  {Hs.call(c, o, Hs.S{store, hist, evs}, Hs.Upsert{id, doc, f}) == Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, f}) : Hs.State}

# LAW: an upsert of a missing document, with no switch set, is a create of it.
law upsert_missing_is_create:
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +doc: +List<P.Entry>
  for e: {Hs.find(store, id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  {Hs.call(c, o, Hs.S{store, hist, evs}, Hs.Upsert{id, doc, Hs.Flags{False{}, False{}, False{}}}) == Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Create{id, doc}) : Hs.State}

# LAW: unlike a create, an upsert of a missing document honours ignorePatchHistory: it writes no history.
law upsert_missing_honours_ignore_history:
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +doc: +List<P.Entry>
  for +ev: Bool
  for e: {Hs.find(store, id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  {Hs.hist_of(Hs.call(c, o, Hs.S{store, hist, evs}, Hs.Upsert{id, doc, Hs.Flags{False{}, ev, True{}}})) == hist : +List<Hs.Hist>}

# LAW: a delete whose preDelete rejects changes nothing (store, history, events) unless the hook is skipped.
law vetoed_delete_changes_nothing:
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  for +ids: +List<Nat>
  for +f: Hs.Flags
  for n: {Hs.skipped(f) == False{} : Bool}
  {Hs.call(c, o, st, Hs.DeleteVetoed{ids, f}) == st : Hs.State}

# ---- entry metadata ----

# LAW: a getter that throws or rejects stores nothing, as one that returns undefined does.
law failed_getter_is_undefined:
  {E.field(E.Failed{}) == E.field(E.Undefined{}) : Maybe<E.Field>}

# LAW: a getter that returns null stores null: only undefined, a throw or a rejection store nothing.
law null_getter_is_stored:
  {E.field(E.Null{}) != {None{} : Maybe<E.Field>} : Maybe<E.Field>}

# LAW: a name option, when set, is the entry's name, whatever the model is called.
law name_option_wins:
  for +n: Nat
  for +m: Nat
  {E.name(Some{n}, m) == n : Nat}

# ---- history TTL ----

# LAW: a TTL of one second or more in whole seconds leaves exactly that index, without an error, whatever was there.
law ttl_whole_seconds_set:
  for i: Tt.Index
  for +p: Nat
  {Tt.ttl(i, Tt.Millis{False{}, 1n+p, False{}}) == Tt.R{Tt.Ttl{1n+p}, False{}} : Tt.Outcome}

# LAW: setting the same whole-second TTL again changes nothing.
law ttl_whole_seconds_idempotent:
  for i: Tt.Index
  for +p: Nat
  {Tt.ttl(Tt.index_of(Tt.ttl(i, Tt.Millis{False{}, 1n+p, False{}})), Tt.Millis{False{}, 1n+p, False{}}) == Tt.ttl(i, Tt.Millis{False{}, 1n+p, False{}}) : Tt.Outcome}

# LAW: a TTL below one second, of either sign, drops an existing index without an error.
law ttl_below_second_drops:
  for +e: Nat
  for neg: Bool
  for frac: Bool
  {Tt.ttl(Tt.Ttl{e}, Tt.Millis{neg, 0n, frac}) == Tt.R{Tt.NoIndex{}, False{}} : Tt.Outcome}
