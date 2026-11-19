import Base
import ./patch.bend as P
import ./chunk.bend as C
import ./entry.bend as E
import ./ttl.bend as Tt
import ./omit.bend as O
import ./history.bend as Hs
import ./SPEC.bend as Spec
import ./LAWS.bend as Laws

# LEMMA: a key equals itself.
law is_eq_refl:
  for k: Nat
  {Nat.is_eq(k, k) == True{} : Bool}
def is_eq_refl(k):
  match k:
    case 0n:
      {==}
    case 1n+p:
      is_eq_refl(p)

# LEMMA: applying two op lists one after the other is applying them appended.
law apply_append:
  for xs: List<P.Op>
  for ys: List<P.Op>
  for d: +List<P.Entry>
  {P.apply(List.append(&1, P.Op, xs, ys), d) == P.apply(ys, P.apply(xs, d)) : +List<P.Entry>}
def apply_append(xs, ys, d):
  match xs:
    case Nil{}:
      {==}
    case Con{op, t}:
      apply_append(t, ys, P.step(d, op))

# lookup_del_same, one source entry: split on whether its key is k, as b with e telling which.
def lookup_del_entry(
  b: Bool,
  +ek: Nat,
  +v: Nat,
  t: +List<P.Entry>,
  +k: Nat,
  ih: {P.lookup(P.del(t, k), k) == {None{} : Maybe<Nat>} : Maybe<Nat>},
  e: {Nat.is_eq(ek, k) == b : Bool}
) -> {P.lookup(P.del_pick(b, P.E{ek, v}, P.del(t, k)), k) == {None{} : Maybe<Nat>} : Maybe<Nat>}:
  match b:
    case True{}:
      ih
    case False{}:
      %Equal.sym(Bool, Nat.is_eq(ek, k), False{}, e) : {P.lookup_pick(_, v, P.lookup(P.del(t, k), k)) == {None{} : Maybe<Nat>} : Maybe<Nat>}
      ih

# LEMMA: a deleted key is gone.
law lookup_del_same:
  for d: +List<P.Entry>
  for +k: Nat
  {P.lookup(P.del(d, k), k) == {None{} : Maybe<Nat>} : Maybe<Nat>}
def lookup_del_same(d, k):
  match d:
    case Nil{}:
      {==}
    case Con{P.E{+ek, +v}, +t}:
      lookup_del_entry(Nat.is_eq(ek, k), ek, v, t, k, lookup_del_same(t, k), {==})

# True and False differ: rewrite through a type that is Empty at True and Unit at False.
def bool_disc(b: Bool) -> Type:
  match b:
    case True{}:
      Empty
    case False{}:
      Unit

def false_ne_true(e: {False{} == True{} : Bool}) -> Empty:
  %e : bool_disc(_)
  Unit{}

# LEMMA: keys that compare equal are equal.
law is_eq_true_eq:
  for a: Nat
  for b: Nat
  for e: {Nat.is_eq(a, b) == True{} : Bool}
  {a == b : Nat}
def is_eq_true_eq(a, b, e):
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+bp:
      Empty.absurd({0n == 1n+bp : Nat}, false_ne_true(e))
    case 1n+ap 0n:
      Empty.absurd({1n+ap == 0n : Nat}, false_ne_true(e))
    case 1n+ap 1n+bp:
      %is_eq_true_eq(ap, bp, e) : {1n+ap == 1n+_ : Nat}
      {==}

# LEMMA: comparing keys is symmetric.
law is_eq_sym:
  for a: Nat
  for b: Nat
  {Nat.is_eq(a, b) == Nat.is_eq(b, a) : Bool}
def is_eq_sym(a, b):
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+bp:
      {==}
    case 1n+ap 0n:
      {==}
    case 1n+ap 1n+bp:
      is_eq_sym(ap, bp)

# lookup_del_other, one entry: split on whether the entry's key is the deleted one.
def lookup_del_other_entry(
  b: Bool,
  +ek: Nat,
  +v: Nat,
  t: +List<P.Entry>,
  +k: Nat,
  +j: Nat,
  ne: {Nat.is_eq(k, j) == False{} : Bool},
  ih: {P.lookup(P.del(t, k), j) == P.lookup(t, j) : Maybe<Nat>},
  e: {Nat.is_eq(ek, k) == b : Bool}
) -> {P.lookup(P.del_pick(b, P.E{ek, v}, P.del(t, k)), j) == P.lookup_pick(Nat.is_eq(ek, j), v, P.lookup(t, j)) : Maybe<Nat>}:
  match b:
    case True{}:
      # the entry was the deleted key: ek is k, and k is not j
      %Equal.sym(Nat, ek, k, is_eq_true_eq(ek, k, e)) : {P.lookup(P.del(t, k), j) == P.lookup_pick(Nat.is_eq(_, j), v, P.lookup(t, j)) : Maybe<Nat>}
      %Equal.sym(Bool, Nat.is_eq(k, j), False{}, ne) : {P.lookup(P.del(t, k), j) == P.lookup_pick(_, v, P.lookup(t, j)) : Maybe<Nat>}
      ih
    case False{}:
      # the entry stays: both sides pick on the same key, over lookups the induction makes equal
      %ih : {P.lookup_pick(Nat.is_eq(ek, j), v, P.lookup(P.del(t, k), j)) == P.lookup_pick(Nat.is_eq(ek, j), v, _) : Maybe<Nat>}
      {==}

# LEMMA: deleting one key leaves the lookup of every other key unchanged.
law lookup_del_other:
  for d: +List<P.Entry>
  for +k: Nat
  for +j: Nat
  for +ne: {Nat.is_eq(k, j) == False{} : Bool}
  {P.lookup(P.del(d, k), j) == P.lookup(d, j) : Maybe<Nat>}
def lookup_del_other(d, k, j, ne):
  match d:
    case Nil{}:
      {==}
    case Con{P.E{+ek, +v}, +t}:
      lookup_del_other_entry(Nat.is_eq(ek, k), ek, v, t, k, j, ne, lookup_del_other(t, k, j, ne), {==})

# LEMMA: after putting a key, looking it up gives the value put.
law lookup_put_same:
  for d: +List<P.Entry>
  for +k: Nat
  for +v: Nat
  {P.lookup(P.step(d, P.Put{k, v}), k) == {Some{v} : Maybe<Nat>} : Maybe<Nat>}
def lookup_put_same(d, k, v):
  # the new entry comes first, and its key compares equal to itself
  %Equal.sym(Bool, Nat.is_eq(k, k), True{}, is_eq_refl(k)) : {P.lookup_pick(_, v, P.lookup(P.del(d, k), k)) == {Some{v} : Maybe<Nat>} : Maybe<Nat>}
  {==}

# LEMMA: putting one key leaves the lookup of every other key unchanged.
law lookup_put_other:
  for d: +List<P.Entry>
  for +k: Nat
  for +v: Nat
  for +j: Nat
  for +ne: {Nat.is_eq(k, j) == False{} : Bool}
  {P.lookup(P.step(d, P.Put{k, v}), j) == P.lookup(d, j) : Maybe<Nat>}
def lookup_put_other(d, k, v, j, ne):
  # the new entry's key is not j, so the lookup passes it and reads the rest, where k was deleted
  %Equal.sym(Bool, Nat.is_eq(k, j), False{}, ne) : {P.lookup_pick(_, v, P.lookup(P.del(d, k), j)) == P.lookup(d, j) : Maybe<Nat>}
  lookup_del_other(d, k, j, ne)

# Some{1n} and Some{0n} differ: Unit at Some of a successor, Empty at Some{0n}.
def nat_disc(n: Nat) -> Type:
  match n:
    case 0n:
      Empty
    case 1n+p:
      Unit

def maybe_disc(m: Maybe<Nat>) -> Type:
  match m:
    case None{}:
      Unit
    case Some{x}:
      nat_disc(x)

def Laws.roundtrip_needs_distinct(e):
  # the left side computes to Some{1n}, the right to Some{0n}
  %e : maybe_disc(_)
  Unit{}

# ---- chunk ----

# LEMMA: appending is associative.
law append_assoc:
  for +xs: +List<Nat>
  for +ys: +List<Nat>
  for +zs: +List<Nat>
  {List.append(&2, Nat, List.append(&2, Nat, xs, ys), zs) == List.append(&2, Nat, xs, List.append(&2, Nat, ys, zs)) : +List<Nat>}
def append_assoc(xs, ys, zs):
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %append_assoc(t, ys, zs) : {h <> List.append(&2, Nat, List.append(&2, Nat, t, ys), zs) == h <> _ : +List<Nat>}
      {==}

# LEMMA: chunking with a current piece cur gives pieces that concatenate to cur followed by the rest.
law chunk_go_concat:
  for +xs: +List<Nat>
  for +size: Nat
  for +cur: +List<Nat>
  for rem: Nat
  {List.concat(&2, Nat, C.chunk_go(xs, size, cur, rem)) == List.append(&2, Nat, cur, xs) : +List<Nat>}
def chunk_go_concat(xs, size, cur, rem):
  match xs rem:
    case Nil{} r:
      match cur:
        case Nil{}:
          {==}
        case Con{h, t}:
          {==}
    case Con{h, t} 0n:
      # the piece cur ++ [h] is emitted; the rest, chunked from an empty piece, concatenates to t
      %Equal.sym(+List<Nat>, List.concat(&2, Nat, C.chunk_go(t, size, [], size)), List.append(&2, Nat, [], t), chunk_go_concat(t, size, [], size)) : {List.append(&2, Nat, List.append(&2, Nat, cur, [h]), _) == List.append(&2, Nat, cur, h <> t) : +List<Nat>}
      append_assoc(cur, [h], t)
    case Con{h, t} 1n+0n:
      %Equal.sym(+List<Nat>, List.concat(&2, Nat, C.chunk_go(t, size, [], size)), List.append(&2, Nat, [], t), chunk_go_concat(t, size, [], size)) : {List.append(&2, Nat, List.append(&2, Nat, cur, [h]), _) == List.append(&2, Nat, cur, h <> t) : +List<Nat>}
      append_assoc(cur, [h], t)
    case Con{h, t} 2n+r:
      # h joins the current piece: the induction on the rest, then regrouping
      Equal.trans(+List<Nat>, List.concat(&2, Nat, C.chunk_go(t, size, List.append(&2, Nat, cur, [h]), 1n+r)), List.append(&2, Nat, List.append(&2, Nat, cur, [h]), t), List.append(&2, Nat, cur, h <> t), chunk_go_concat(t, size, List.append(&2, Nat, cur, [h]), 1n+r), append_assoc(cur, [h], t))

def Laws.chunk_concat(xs, size):
  chunk_go_concat(xs, size, [], size)

# ---- omitDeep ----

# LEMMA: and with False is False.
law and_false:
  for a: Bool
  {Bool.and(a, False{}) == False{} : Bool}
def and_false(a):
  match a:
    case False{}:
      {==}
    case True{}:
      {==}

# LEMMA: a path with an unsafe head contributes no nested keys under any key.
law nested_unsafe_path:
  for +u: Nat
  for +un: {O.unsafe(u) == True{} : Bool}
  for +x: Nat
  for +xs: +List<Nat>
  for +keys: +List<+List<Nat>>
  for +k: Nat
  {O.nested(O.with_path(u, x, xs, keys), k) == O.nested(keys, k) : +List<+List<Nat>>}
def nested_unsafe_path(u, un, x, xs, keys, k):
  # the head is unsafe, so the path is skipped whatever k is
  %Equal.sym(Bool, O.unsafe(u), True{}, un) : {O.nested_pick(Bool.and(Nat.is_eq(u, k), Bool.not(_)), x <> xs, O.nested(keys, k)) == O.nested(keys, k) : +List<+List<Nat>>}
  %Equal.sym(Bool, Bool.and(Nat.is_eq(u, k), False{}), False{}, and_false(Nat.is_eq(u, k))) : {O.nested_pick(_, x <> xs, O.nested(keys, k)) == O.nested(keys, k) : +List<+List<Nat>>}
  {==}

# Below a field, both key lists give the same children when the nested keys are the same.
def child_same(
  below: +List<+List<Nat>>,
  -f: Nat,
  -t: O.Tree,
  +pk: +List<+List<Nat>>,
  +keys: +List<+List<Nat>>,
  ih: {O.go(f, O.T{t}, pk) == O.go(f, O.T{t}, keys) : O.Node}
) -> {O.go(f, O.T{t}, O.child_pick(below, pk)) == O.go(f, O.T{t}, O.child_pick(below, keys)) : O.Node}:
  match below:
    case Nil{}:
      ih
    case Con{p, ps}:
      {==}

def Laws.omit_unsafe_path_ignored(fuel, n, u, un, x, xs, keys):
  match fuel n:
    case 0n n:
      {==}
    case 1n+f O.T{O.Leaf{v}}:
      {==}
    case 1n+f O.T{O.Obj{+fs}}:
      %Equal.sym(O.Node, O.go(f, O.Fs{fs}, O.with_path(u, x, xs, keys)), O.go(f, O.Fs{fs}, keys), Laws.omit_unsafe_path_ignored(f, O.Fs{fs}, u, un, x, xs, keys)) : {O.T{O.Obj{O.unwrap_fs(_)}} == O.T{O.Obj{O.unwrap_fs(O.go(f, O.Fs{fs}, keys))}} : O.Node}
      {==}
    case 1n+f O.T{O.Arr{+ys}}:
      %Equal.sym(O.Node, O.go(f, O.Ts{ys}, O.with_path(u, x, xs, keys)), O.go(f, O.Ts{ys}, keys), Laws.omit_unsafe_path_ignored(f, O.Ts{ys}, u, un, x, xs, keys)) : {O.T{O.Arr{O.unwrap_ts(_)}} == O.T{O.Arr{O.unwrap_ts(O.go(f, O.Ts{ys}, keys))}} : O.Node}
      {==}
    case 1n+f O.Fs{Nil{}}:
      {==}
    case 1n++f O.Fs{Con{O.F{+k, +t}, +rest}}:
      # the unsafe path is never a top-level omit (by computation); then the rest, the nested keys, the child
      %Equal.sym(O.Node, O.go(f, O.Fs{rest}, O.with_path(u, x, xs, keys)), O.go(f, O.Fs{rest}, keys), Laws.omit_unsafe_path_ignored(f, O.Fs{rest}, u, un, x, xs, keys)) : {O.Fs{O.keep_pick(O.is_top(keys, k), O.F{k, O.unwrap_t(O.go(f, O.T{t}, O.child_pick(O.nested(O.with_path(u, x, xs, keys), k), O.with_path(u, x, xs, keys))))}, O.unwrap_fs(_))} == O.Fs{O.keep_pick(O.is_top(keys, k), O.F{k, O.unwrap_t(O.go(f, O.T{t}, O.child_keys(keys, k)))}, O.unwrap_fs(O.go(f, O.Fs{rest}, keys)))} : O.Node}
      %Equal.sym(+List<+List<Nat>>, O.nested(O.with_path(u, x, xs, keys), k), O.nested(keys, k), nested_unsafe_path(u, un, x, xs, keys, k)) : {O.Fs{O.keep_pick(O.is_top(keys, k), O.F{k, O.unwrap_t(O.go(f, O.T{t}, O.child_pick(_, O.with_path(u, x, xs, keys))))}, O.unwrap_fs(O.go(f, O.Fs{rest}, keys)))} == O.Fs{O.keep_pick(O.is_top(keys, k), O.F{k, O.unwrap_t(O.go(f, O.T{t}, O.child_keys(keys, k)))}, O.unwrap_fs(O.go(f, O.Fs{rest}, keys)))} : O.Node}
      %Equal.sym(O.Node, O.go(f, O.T{t}, O.child_pick(O.nested(keys, k), O.with_path(u, x, xs, keys))), O.go(f, O.T{t}, O.child_pick(O.nested(keys, k), keys)), child_same(O.nested(keys, k), f, t, O.with_path(u, x, xs, keys), keys, Laws.omit_unsafe_path_ignored(f, O.T{t}, u, un, x, xs, keys))) : {O.Fs{O.keep_pick(O.is_top(keys, k), O.F{k, O.unwrap_t(_)}, O.unwrap_fs(O.go(f, O.Fs{rest}, keys)))} == O.Fs{O.keep_pick(O.is_top(keys, k), O.F{k, O.unwrap_t(O.go(f, O.T{t}, O.child_keys(keys, k)))}, O.unwrap_fs(O.go(f, O.Fs{rest}, keys)))} : O.Node}
      {==}
    case 1n+f O.Ts{Nil{}}:
      {==}
    case 1n++f O.Ts{Con{+t, +rest}}:
      %Equal.sym(O.Node, O.go(f, O.T{t}, O.with_path(u, x, xs, keys)), O.go(f, O.T{t}, keys), Laws.omit_unsafe_path_ignored(f, O.T{t}, u, un, x, xs, keys)) : {O.Ts{O.unwrap_t(_) <> O.unwrap_ts(O.go(f, O.Ts{rest}, O.with_path(u, x, xs, keys)))} == O.Ts{O.unwrap_t(O.go(f, O.T{t}, keys)) <> O.unwrap_ts(O.go(f, O.Ts{rest}, keys))} : O.Node}
      %Equal.sym(O.Node, O.go(f, O.Ts{rest}, O.with_path(u, x, xs, keys)), O.go(f, O.Ts{rest}, keys), Laws.omit_unsafe_path_ignored(f, O.Ts{rest}, u, un, x, xs, keys)) : {O.Ts{O.unwrap_t(O.go(f, O.T{t}, keys)) <> O.unwrap_ts(_)} == O.Ts{O.unwrap_t(O.go(f, O.T{t}, keys)) <> O.unwrap_ts(O.go(f, O.Ts{rest}, keys))} : O.Node}
      {==}

# ---- history contract ----

def Laws.update_missing_noop(c, store, hist, evs, id, doc, f, e):
  %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(store, id), {None{} : Maybe<+List<P.Entry>>}, e) : {Hs.update_pick(_, c, Hs.no_omit(), f, id, doc, store, hist, evs) == Hs.S{store, hist, evs} : Hs.State}
  {==}

def Laws.delete_missing_noop(c, store, hist, evs, id, f, e):
  %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(store, id), {None{} : Maybe<+List<P.Entry>>}, e) : {Hs.delete_pick(_, c, Hs.no_omit(), f, id, store, hist, evs) == Hs.S{store, hist, evs} : Hs.State}
  {==}

def Laws.create_existing_noop(c, store, hist, evs, id, doc, old, e):
  %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(store, id), {Some{old} : Maybe<+List<P.Entry>>}, e) : {Hs.create_pick(_, c, Hs.no_omit(), id, doc, store, hist, evs) == Hs.S{store, hist, evs} : Hs.State}
  {==}

# ignore_hook_silent: for an existing or missing document alike, and whatever is omitted, the hook writes nothing.
def ihs_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_pick(found, c, o, Hs.Flags{True{}, e, h}, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

def ihs_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.delete_pick(found, c, o, Hs.Flags{True{}, e, h}, id, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

def Laws.ignore_hook_silent(c, store, hist, evs, cmd, q):
  match cmd:
    case Hs.Create{id, doc}:
      Empty.absurd({Hs.hist_of(Hs.step(c, Hs.S{store, hist, evs}, Hs.Create{id, doc})) == hist : +List<Hs.Hist>}, q)
    case Hs.Update{+id, +doc, Hs.Flags{True{}, +e, +h}}:
      ihs_update(Hs.find(store, id), c, Hs.no_omit(), e, h, id, doc, store, hist, evs)
    case Hs.Update{id, doc, Hs.Flags{False{}, e, h}}:
      Empty.absurd({Hs.hist_of(Hs.step(c, Hs.S{store, hist, evs}, Hs.Update{id, doc, Hs.Flags{False{}, e, h}})) == hist : +List<Hs.Hist>}, q)
    case Hs.Delete{+id, Hs.Flags{True{}, +e, +h}}:
      ihs_delete(Hs.find(store, id), c, Hs.no_omit(), e, h, id, store, hist, evs)
    case Hs.Delete{id, Hs.Flags{False{}, e, h}}:
      Empty.absurd({Hs.hist_of(Hs.step(c, Hs.S{store, hist, evs}, Hs.Delete{id, Hs.Flags{False{}, e, h}})) == hist : +List<Hs.Hist>}, q)

# ---- bulk operations and upserts ----

def Laws.upsert_existing_is_update(c, o, store, hist, evs, id, doc, old, f, e):
  %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(store, id), {Some{old} : Maybe<+List<P.Entry>>}, e) : {Hs.upsert_pick(_, c, o, f, id, doc, store, hist, evs) == Hs.update_pick(_, c, o, f, id, doc, store, hist, evs) : Hs.State}
  {==}

# upsert_missing_is_create, per configuration: with no switch, writes and emits are the configuration's.
def umc(+h: Bool, +v: Bool, +o: Hs.Omit, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.upsert_pick(None{}, Hs.Cfg{h, v}, o, Hs.Flags{False{}, False{}, False{}}, id, doc, store, hist, evs) == Hs.create_pick(None{}, Hs.Cfg{h, v}, o, id, doc, store, hist, evs) : Hs.State}:
  match h v:
    case True{} True{}:
      {==}
    case True{} False{}:
      {==}
    case False{} True{}:
      {==}
    case False{} False{}:
      {==}

def Laws.upsert_missing_is_create(c, o, store, hist, evs, id, doc, e):
  match c:
    case Hs.Cfg{+h, +v}:
      %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(store, id), {None{} : Maybe<+List<P.Entry>>}, e) : {Hs.upsert_pick(_, Hs.Cfg{h, v}, o, Hs.Flags{False{}, False{}, False{}}, id, doc, store, hist, evs) == Hs.create_pick(_, Hs.Cfg{h, v}, o, id, doc, store, hist, evs) : Hs.State}
      umc(h, v, o, id, doc, store, hist, evs)

# upsert_missing_honours_ignore_history, per configuration and ignoreEvent.
def umh(+h: Bool, +v: Bool, +ev: Bool, +o: Hs.Omit, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.upsert_pick(None{}, Hs.Cfg{h, v}, o, Hs.Flags{False{}, ev, True{}}, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match h ev:
    case True{} True{}:
      {==}
    case True{} False{}:
      {==}
    case False{} True{}:
      {==}
    case False{} False{}:
      {==}

def Laws.upsert_missing_honours_ignore_history(c, o, store, hist, evs, id, doc, ev, e):
  match c:
    case Hs.Cfg{+h, +v}:
      %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(store, id), {None{} : Maybe<+List<P.Entry>>}, e) : {Hs.hist_of(Hs.upsert_pick(_, Hs.Cfg{h, v}, o, Hs.Flags{False{}, ev, True{}}, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}
      umh(h, v, ev, o, id, doc, store, hist, evs)

def Laws.vetoed_delete_changes_nothing(c, o, st, ids, f, n):
  match st:
    case Hs.S{+store, +hist, +evs}:
      %Equal.sym(Bool, Hs.skipped(f), False{}, n) : {Hs.vetoed(_, ids, f, c, o, Hs.S{store, hist, evs}) == Hs.S{store, hist, evs} : Hs.State}
      {==}

# ---- entry metadata ----

def Laws.failed_getter_is_undefined():
  {==}

def field_disc(m: Maybe<E.Field>) -> Type:
  match m:
    case None{}:
      Empty
    case Some{x}:
      Unit

def Laws.null_getter_is_stored(e):
  # the left side computes to Some{FNull{}}, the right is None{}
  %e : field_disc(_)
  Unit{}

def Laws.name_option_wins(n, m):
  {==}

# ---- history TTL ----

# ttl_whole_seconds_set on an existing index: kept when its seconds are the input's, replaced otherwise.
def tws_kept(b: Bool, +s: Nat, +e: Nat, q: {Nat.is_eq(s, e) == b : Bool}) -> {Tt.kept(b, s, e) == Tt.R{Tt.Ttl{s}, False{}} : Tt.Outcome}:
  match b:
    case True{}:
      %is_eq_true_eq(s, e, q) : {Tt.R{Tt.Ttl{_}, False{}} == Tt.R{Tt.Ttl{s}, False{}} : Tt.Outcome}
      {==}
    case False{}:
      {==}

def Laws.ttl_whole_seconds_set(i, p):
  match i:
    case Tt.NoIndex{}:
      {==}
    case Tt.Ttl{+e}:
      tws_kept(Nat.is_eq(1n+p, e), 1n+p, e, {==})

def Laws.ttl_whole_seconds_idempotent(i, p):
  %Equal.sym(Tt.Outcome, Tt.ttl(i, Tt.Millis{False{}, 1n+p, False{}}), Tt.R{Tt.Ttl{1n+p}, False{}}, Laws.ttl_whole_seconds_set(i, p)) : {Tt.ttl(Tt.index_of(_), Tt.Millis{False{}, 1n+p, False{}}) == _ : Tt.Outcome}
  Laws.ttl_whole_seconds_set(Tt.Ttl{1n+p}, p)

def Laws.ttl_below_second_drops(e, neg, frac):
  match neg:
    case True{}:
      {==}
    case False{}:
      {==}
