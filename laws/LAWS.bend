# The laws: the proven contract of ts-patch-mongoose. A human states them; PROOF.bend must prove them,
# and `npm run laws` fails while one is open. The models they quote mirror src/; SPEC.bend holds the
# predicates they use. Claims not yet proven are in CLAIMS.bend.

import Base
import ./patch.bend as P
import ./chunk.bend as C
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
