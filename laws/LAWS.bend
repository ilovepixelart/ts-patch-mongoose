# The laws: the proven contract of ts-patch-mongoose. A human states them; PROOF.bend must prove them,
# and `npm run laws` fails while one is open. The models they quote mirror src/; SPEC.bend holds the
# predicates they use. Claims not yet proven are in CLAIMS.bend.

import Base
import ./patch.bend as P
import ./chunk.bend as C
import ./entry.bend as E
import ./omit.bend as O
import ./history.bend as Hs
import ./SPEC.bend as Spec

# LAW: the round trip needs distinct keys: with key 1 twice in the target, it reads the last value, not the first.
law roundtrip_needs_distinct:
  {P.lookup(P.apply(P.diff({[] : +List<P.Entry>}, {[P.E{1n, 0n}, P.E{1n, 1n}] : +List<P.Entry>}), {[] : +List<P.Entry>}), 1n) != P.lookup({[P.E{1n, 0n}, P.E{1n, 1n}] : +List<P.Entry>}, 1n) : Maybe<Nat>}

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
