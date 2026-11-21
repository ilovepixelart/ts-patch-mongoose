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

# ---- diff of a document with itself ----

# Every entry of a is in b: its key looks up its value.
def Sub(a: +List<P.Entry>, b: +List<P.Entry>) -> Type:
  match a:
    case Nil{}:
      Unit
    case Con{P.E{+k, +v}, +t}:
      {P.lookup(b, k) == {Some{v} : Maybe<Nat>} : Maybe<Nat>} & Sub(t, b)

# A key the lookup finds is not missing.
def some_disc(m: Maybe<Nat>) -> Type:
  match m:
    case None{}:
      Empty
    case Some{x}:
      Unit

def some_ne_none(+v: Nat, e: {{Some{v} : Maybe<Nat>} == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> Empty:
  %e : some_disc(_)
  Unit{}

# sub_cons, one entry of t: split on whether its key is the new key k, which t lacks.
def sub_cons_entry(
  bb: Bool,
  +k2: Nat,
  +v2: Nat,
  +t: +List<P.Entry>,
  +b: +List<P.Entry>,
  +k: Nat,
  +v: Nat,
  e: {P.lookup(b, k2) == {Some{v2} : Maybe<Nat>} : Maybe<Nat>},
  n: {P.lookup_pick(bb, v2, P.lookup(t, k)) == {None{} : Maybe<Nat>} : Maybe<Nat>},
  q: {Nat.is_eq(k2, k) == bb : Bool},
  ih: @n2: {P.lookup(t, k) == {None{} : Maybe<Nat>} : Maybe<Nat>} -> Sub(t, P.E{k, v} <> b)
) -> {P.lookup(P.E{k, v} <> b, k2) == {Some{v2} : Maybe<Nat>} : Maybe<Nat>} & Sub(t, P.E{k, v} <> b):
  match bb:
    case True{}:
      Empty.absurd({P.lookup(P.E{k, v} <> b, k2) == {Some{v2} : Maybe<Nat>} : Maybe<Nat>} & Sub(t, P.E{k, v} <> b), some_ne_none(v2, n))
    case False{}:
      %is_eq_sym(k2, k) : {P.lookup_pick(_, v, P.lookup(b, k2)) == {Some{v2} : Maybe<Nat>} : Maybe<Nat>} & Sub(t, P.E{k, v} <> b)
      %Equal.sym(Bool, Nat.is_eq(k2, k), False{}, q) : {P.lookup_pick(_, v, P.lookup(b, k2)) == {Some{v2} : Maybe<Nat>} : Maybe<Nat>} & Sub(t, P.E{k, v} <> b)
      (e, ih(n))

# LEMMA: an entry whose key a lacks can go in front of b, and every entry of a is still in it.
def sub_cons(a: +List<P.Entry>, +b: +List<P.Entry>, +k: Nat, +v: Nat, s: Sub(a, b), n: {P.lookup(a, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> Sub(a, P.E{k, v} <> b):
  match a:
    case Nil{}:
      Unit{}
    case Con{P.E{+k2, +v2}, +t}:
      (e, st) = s
      sub_cons_entry(Nat.is_eq(k2, k), k2, v2, t, b, k, v, e, n, {==}, n2 => sub_cons(t, b, k, v, st, n2))

# LEMMA: with distinct keys, every entry of a document is in it.
def sub_self(a: +List<P.Entry>, d: Spec.Distinct(a)) -> Sub(a, a):
  match a:
    case Nil{}:
      Unit{}
    case Con{P.E{+k, +v}, +t}:
      (n, dt) = d
      %Equal.sym(Bool, Nat.is_eq(k, k), True{}, is_eq_refl(k)) : {P.lookup_pick(_, v, P.lookup(t, k)) == {Some{v} : Maybe<Nat>} : Maybe<Nat>} & Sub(t, P.E{k, v} <> t)
      ({==}, sub_cons(t, t, k, v, sub_self(t, dt), n))

# LEMMA: diffing a against a document that holds all its entries gives no operations: no entry is
# removed or replaced, and none is added.
def diff_sub_empty(a: +List<P.Entry>, +b: +List<P.Entry>, s: Sub(a, b)) -> {List.append(&1, P.Op, P.diff_source(a, b), P.diff_added(a, b)) == {[] : List<P.Op>} : List<P.Op>}:
  match a:
    case Nil{}:
      {==}
    case Con{P.E{+k, +v}, +t}:
      (e, st) = s
      %Equal.sym(Maybe<Nat>, P.lookup(b, k), Some{v}, e) : {List.append(&1, P.Op, List.append(&1, P.Op, P.diff_one_pick(_, k, v), P.diff_source(t, b)), List.append(&1, P.Op, P.diff_added_pick(_, k, v), P.diff_added(t, b))) == {[] : List<P.Op>} : List<P.Op>}
      %Equal.sym(Bool, Nat.is_eq(v, v), True{}, is_eq_refl(v)) : {List.append(&1, P.Op, List.append(&1, P.Op, P.diff_same(_, k, v), P.diff_source(t, b)), P.diff_added(t, b)) == {[] : List<P.Op>} : List<P.Op>}
      diff_sub_empty(t, b, st)

def Laws.diff_self_empty(a, da):
  diff_sub_empty(a, a, sub_self(a, da))

# ---- the round trip ----

# The operations diff emits for the source entry E{k, v}, when the target looks k up as m.
# One entry's operations touch only its own key.
def same_other(bb: Bool, +k: Nat, +w: Nat, +j: Nat, +d: +List<P.Entry>, +ne: {Nat.is_eq(k, j) == False{} : Bool}) -> {P.lookup(P.apply(P.diff_same(bb, k, w), d), j) == P.lookup(d, j) : Maybe<Nat>}:
  match bb:
    case True{}:
      {==}
    case False{}:
      lookup_put_other(d, k, w, j, ne)

def one_other(m: Maybe<Nat>, +k: Nat, +v: Nat, +j: Nat, +d: +List<P.Entry>, +ne: {Nat.is_eq(k, j) == False{} : Bool}) -> {P.lookup(P.apply(P.diff_one_pick(m, k, v), d), j) == P.lookup(d, j) : Maybe<Nat>}:
  match m:
    case None{}:
      lookup_del_other(d, k, j, ne)
    case Some{+w}:
      same_other(Nat.is_eq(v, w), k, w, j, d, ne)

# One entry's operations on its own key leave the target's value, when the document holds it already.
def same_keep(bb: Bool, +k: Nat, +w: Nat, +d: +List<P.Entry>, h: {P.lookup(d, k) == {Some{w} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_same(bb, k, w), d), k) == {Some{w} : Maybe<Nat>} : Maybe<Nat>}:
  match bb:
    case True{}:
      h
    case False{}:
      lookup_put_same(d, k, w)

def one_keep(m: Maybe<Nat>, +k: Nat, +v: Nat, +d: +List<P.Entry>, h: {P.lookup(d, k) == m : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_one_pick(m, k, v), d), k) == m : Maybe<Nat>}:
  match m:
    case None{}:
      lookup_del_same(d, k)
    case Some{+w}:
      same_keep(Nat.is_eq(v, w), k, w, d, h)

# One entry's operations on its own key give the target's value, when the document holds the entry's.
def same_set(bb: Bool, +k: Nat, +v: Nat, +w: Nat, +d: +List<P.Entry>, h: {P.lookup(d, k) == {Some{v} : Maybe<Nat>} : Maybe<Nat>}, q: {Nat.is_eq(v, w) == bb : Bool}) -> {P.lookup(P.apply(P.diff_same(bb, k, w), d), k) == {Some{w} : Maybe<Nat>} : Maybe<Nat>}:
  match bb:
    case True{}:
      %is_eq_true_eq(v, w, q) : {P.lookup(d, k) == {Some{_} : Maybe<Nat>} : Maybe<Nat>}
      h
    case False{}:
      lookup_put_same(d, k, w)

def one_set(m: Maybe<Nat>, +k: Nat, +v: Nat, +d: +List<P.Entry>, h: {P.lookup(d, k) == {Some{v} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_one_pick(m, k, v), d), k) == m : Maybe<Nat>}:
  match m:
    case None{}:
      lookup_del_same(d, k)
    case Some{+w}:
      same_set(Nat.is_eq(v, w), k, v, w, d, h, {==})

def none_ne_some(+x: Nat, e: {{None{} : Maybe<Nat>} == {Some{x} : Maybe<Nat>} : Maybe<Nat>}) -> Empty:
  some_ne_none(x, Equal.sym(Maybe<Nat>, None{}, Some{x}, e))

# source_keep, one entry: split on whether its key is j.
def source_keep_entry(bk: Bool, +k: Nat, +v: Nat, +j: Nat, +b: +List<P.Entry>, +d: +List<P.Entry>, h: {P.lookup(d, j) == P.lookup(b, j) : Maybe<Nat>}, +q: {Nat.is_eq(k, j) == bk : Bool}) -> {P.lookup(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), j) == P.lookup(b, j) : Maybe<Nat>}:
  match bk:
    case True{}:
      +kj = is_eq_true_eq(k, j, q)
      hk = {(%Equal.sym(Nat, k, j, kj) : {P.lookup(d, _) == P.lookup(b, _) : Maybe<Nat>}; h) : {P.lookup(d, k) == P.lookup(b, k) : Maybe<Nat>}}
      %kj : {P.lookup(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), _) == P.lookup(b, _) : Maybe<Nat>}
      one_keep(P.lookup(b, k), k, v, d, hk)
    case False{}:
      %Equal.sym(Maybe<Nat>, P.lookup(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), j), P.lookup(d, j), one_other(P.lookup(b, k), k, v, j, d, q)) : {_ == P.lookup(b, j) : Maybe<Nat>}
      h

# LEMMA: once the document holds the target's value at j, the rest of the source pass keeps it.
def source_keep(a: +List<P.Entry>, +b: +List<P.Entry>, +d: +List<P.Entry>, +j: Nat, h: {P.lookup(d, j) == P.lookup(b, j) : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_source(a, b), d), j) == P.lookup(b, j) : Maybe<Nat>}:
  match a:
    case Nil{}:
      h
    case Con{P.E{+k, +v}, +t}:
      %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_one_pick(P.lookup(b, k), k, v), P.diff_source(t, b)), d), P.apply(P.diff_source(t, b), P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d)), apply_append(P.diff_one_pick(P.lookup(b, k), k, v), P.diff_source(t, b), d)) : {P.lookup(_, j) == P.lookup(b, j) : Maybe<Nat>}
      source_keep(t, b, P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), j, source_keep_entry(Nat.is_eq(k, j), k, v, j, b, d, h, {==}))

# source_reach, one entry: an entry on j sets the target's value, any other leaves j as it is.
def source_reach_entry(
  bk: Bool,
  +k: Nat,
  +v: Nat,
  +t: +List<P.Entry>,
  +b: +List<P.Entry>,
  +d: +List<P.Entry>,
  +j: Nat,
  +x: Nat,
  h1: {P.lookup_pick(bk, v, P.lookup(t, j)) == {Some{x} : Maybe<Nat>} : Maybe<Nat>},
  h2: {P.lookup(d, j) == P.lookup_pick(bk, v, P.lookup(t, j)) : Maybe<Nat>},
  +q: {Nat.is_eq(k, j) == bk : Bool},
  ih: @d2: +List<P.Entry> -> @h1b: {P.lookup(t, j) == {Some{x} : Maybe<Nat>} : Maybe<Nat>} -> @h2b: {P.lookup(d2, j) == P.lookup(t, j) : Maybe<Nat>} -> {P.lookup(P.apply(P.diff_source(t, b), d2), j) == P.lookup(b, j) : Maybe<Nat>}
) -> {P.lookup(P.apply(P.diff_source(t, b), P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d)), j) == P.lookup(b, j) : Maybe<Nat>}:
  match bk:
    case True{}:
      +kj = is_eq_true_eq(k, j, q)
      hk = {(%Equal.sym(Nat, k, j, kj) : {P.lookup(d, _) == {Some{v} : Maybe<Nat>} : Maybe<Nat>}; h2) : {P.lookup(d, k) == {Some{v} : Maybe<Nat>} : Maybe<Nat>}}
      hj = {(%kj : {P.lookup(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), _) == P.lookup(b, _) : Maybe<Nat>}; one_set(P.lookup(b, k), k, v, d, hk)) : {P.lookup(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), j) == P.lookup(b, j) : Maybe<Nat>}}
      source_keep(t, b, P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), j, hj)
    case False{}:
      h2b = {(%Equal.sym(Maybe<Nat>, P.lookup(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), j), P.lookup(d, j), one_other(P.lookup(b, k), k, v, j, d, q)) : {_ == P.lookup(t, j) : Maybe<Nat>}; h2) : {P.lookup(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), j) == P.lookup(t, j) : Maybe<Nat>}}
      ih(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), h1, h2b)

# LEMMA: while j is still ahead in the source (the rest t holds it) and the document agrees with t at
# j, the source pass ends with the target's value at j.
def source_reach(t: +List<P.Entry>, +b: +List<P.Entry>, +d: +List<P.Entry>, +j: Nat, +x: Nat, h1: {P.lookup(t, j) == {Some{x} : Maybe<Nat>} : Maybe<Nat>}, h2: {P.lookup(d, j) == P.lookup(t, j) : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_source(t, b), d), j) == P.lookup(b, j) : Maybe<Nat>}:
  match t:
    case Nil{}:
      Empty.absurd({P.lookup(P.apply(P.diff_source([], b), d), j) == P.lookup(b, j) : Maybe<Nat>}, none_ne_some(x, h1))
    case Con{P.E{+k, +v}, +r}:
      %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_one_pick(P.lookup(b, k), k, v), P.diff_source(r, b)), d), P.apply(P.diff_source(r, b), P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d)), apply_append(P.diff_one_pick(P.lookup(b, k), k, v), P.diff_source(r, b), d)) : {P.lookup(_, j) == P.lookup(b, j) : Maybe<Nat>}
      source_reach_entry(Nat.is_eq(k, j), k, v, r, b, d, j, x, h1, h2, {==}, d2 => h1b => h2b => source_reach(r, b, d2, j, x, h1b, h2b))

# source_skip, one entry: its key is not j, as the source lacks j.
def source_skip_entry(
  bk: Bool,
  +k: Nat,
  +v: Nat,
  +t: +List<P.Entry>,
  +b: +List<P.Entry>,
  +d: +List<P.Entry>,
  +j: Nat,
  n: {P.lookup_pick(bk, v, P.lookup(t, j)) == {None{} : Maybe<Nat>} : Maybe<Nat>},
  +q: {Nat.is_eq(k, j) == bk : Bool},
  ih: @d2: +List<P.Entry> -> @nb: {P.lookup(t, j) == {None{} : Maybe<Nat>} : Maybe<Nat>} -> {P.lookup(P.apply(P.diff_source(t, b), d2), j) == P.lookup(d2, j) : Maybe<Nat>}
) -> {P.lookup(P.apply(P.diff_source(t, b), P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d)), j) == P.lookup(d, j) : Maybe<Nat>}:
  match bk:
    case True{}:
      Empty.absurd({P.lookup(P.apply(P.diff_source(t, b), P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d)), j) == P.lookup(d, j) : Maybe<Nat>}, some_ne_none(v, n))
    case False{}:
      %one_other(P.lookup(b, k), k, v, j, d, q) : {P.lookup(P.apply(P.diff_source(t, b), P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d)), j) == _ : Maybe<Nat>}
      ih(P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d), n)

# LEMMA: when the source lacks j, the source pass leaves j as it is.
def source_skip(a: +List<P.Entry>, +b: +List<P.Entry>, +d: +List<P.Entry>, +j: Nat, n: {P.lookup(a, j) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_source(a, b), d), j) == P.lookup(d, j) : Maybe<Nat>}:
  match a:
    case Nil{}:
      {==}
    case Con{P.E{+k, +v}, +t}:
      %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_one_pick(P.lookup(b, k), k, v), P.diff_source(t, b)), d), P.apply(P.diff_source(t, b), P.apply(P.diff_one_pick(P.lookup(b, k), k, v), d)), apply_append(P.diff_one_pick(P.lookup(b, k), k, v), P.diff_source(t, b), d)) : {P.lookup(_, j) == P.lookup(d, j) : Maybe<Nat>}
      source_skip_entry(Nat.is_eq(k, j), k, v, t, b, d, j, n, {==}, d2 => nb => source_skip(t, b, d2, j, nb))

# The operations diff adds for the target entry E{k, w}, when the source looks k up as m, touch only k.
def added_other(m: Maybe<Nat>, +k: Nat, +w: Nat, +j: Nat, +d: +List<P.Entry>, +ne: {Nat.is_eq(k, j) == False{} : Bool}) -> {P.lookup(P.apply(P.diff_added_pick(m, k, w), d), j) == P.lookup(d, j) : Maybe<Nat>}:
  match m:
    case None{}:
      lookup_put_other(d, k, w, j, ne)
    case Some{y}:
      {==}

# added_untouched, one entry: its key is not j, as the target's rest lacks j.
def added_untouched_entry(
  bk: Bool,
  +k: Nat,
  +w: Nat,
  +t: +List<P.Entry>,
  +a: +List<P.Entry>,
  +d: +List<P.Entry>,
  +j: Nat,
  n: {P.lookup_pick(bk, w, P.lookup(t, j)) == {None{} : Maybe<Nat>} : Maybe<Nat>},
  +q: {Nat.is_eq(k, j) == bk : Bool},
  ih: @d2: +List<P.Entry> -> @nb: {P.lookup(t, j) == {None{} : Maybe<Nat>} : Maybe<Nat>} -> {P.lookup(P.apply(P.diff_added(t, a), d2), j) == P.lookup(d2, j) : Maybe<Nat>}
) -> {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), j) == P.lookup(d, j) : Maybe<Nat>}:
  match bk:
    case True{}:
      Empty.absurd({P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), j) == P.lookup(d, j) : Maybe<Nat>}, some_ne_none(w, n))
    case False{}:
      %added_other(P.lookup(a, k), k, w, j, d, q) : {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), j) == _ : Maybe<Nat>}
      ih(P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d), n)

# LEMMA: when the target lacks j, the added pass leaves j as it is.
def added_untouched(b: +List<P.Entry>, +a: +List<P.Entry>, +d: +List<P.Entry>, +j: Nat, n: {P.lookup(b, j) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_added(b, a), d), j) == P.lookup(d, j) : Maybe<Nat>}:
  match b:
    case Nil{}:
      {==}
    case Con{P.E{+k, +w}, +t}:
      %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_added_pick(P.lookup(a, k), k, w), P.diff_added(t, a)), d), P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), apply_append(P.diff_added_pick(P.lookup(a, k), k, w), P.diff_added(t, a), d)) : {P.lookup(_, j) == P.lookup(d, j) : Maybe<Nat>}
      added_untouched_entry(Nat.is_eq(k, j), k, w, t, a, d, j, n, {==}, d2 => nb => added_untouched(t, a, d2, j, nb))

# added_held, one entry: when the source holds j, an entry on j adds nothing.
def added_held_entry(
  bk: Bool,
  +k: Nat,
  +w: Nat,
  +t: +List<P.Entry>,
  +a: +List<P.Entry>,
  +d: +List<P.Entry>,
  +j: Nat,
  +y: Nat,
  +ha: {P.lookup(a, j) == {Some{y} : Maybe<Nat>} : Maybe<Nat>},
  +q: {Nat.is_eq(k, j) == bk : Bool},
  ih: @d2: +List<P.Entry> -> {P.lookup(P.apply(P.diff_added(t, a), d2), j) == P.lookup(d2, j) : Maybe<Nat>}
) -> {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), j) == P.lookup(d, j) : Maybe<Nat>}:
  match bk:
    case True{}:
      hk = {(%Equal.sym(Nat, k, j, is_eq_true_eq(k, j, q)) : {P.lookup(a, _) == {Some{y} : Maybe<Nat>} : Maybe<Nat>}; ha) : {P.lookup(a, k) == {Some{y} : Maybe<Nat>} : Maybe<Nat>}}
      %Equal.sym(Maybe<Nat>, P.lookup(a, k), Some{y}, hk) : {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(_, k, w), d)), j) == P.lookup(d, j) : Maybe<Nat>}
      ih(d)
    case False{}:
      %added_other(P.lookup(a, k), k, w, j, d, q) : {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), j) == _ : Maybe<Nat>}
      ih(P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d))

# LEMMA: when the source holds j, the added pass leaves j as it is.
def added_held(b: +List<P.Entry>, +a: +List<P.Entry>, +d: +List<P.Entry>, +j: Nat, +y: Nat, +ha: {P.lookup(a, j) == {Some{y} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_added(b, a), d), j) == P.lookup(d, j) : Maybe<Nat>}:
  match b:
    case Nil{}:
      {==}
    case Con{P.E{+k, +w}, +t}:
      %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_added_pick(P.lookup(a, k), k, w), P.diff_added(t, a)), d), P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), apply_append(P.diff_added_pick(P.lookup(a, k), k, w), P.diff_added(t, a), d)) : {P.lookup(_, j) == P.lookup(d, j) : Maybe<Nat>}
      added_held_entry(Nat.is_eq(k, j), k, w, t, a, d, j, y, ha, {==}, d2 => added_held(t, a, d2, j, y, ha))

# added_fill on j itself: the source lacks k, so the entry puts w, and the rest of the target lacks k.
def added_fill_put(+k: Nat, +w: Nat, +t: +List<P.Entry>, +a: +List<P.Entry>, +d: +List<P.Entry>, +hak: {P.lookup(a, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}, nk: {P.lookup(t, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), k) == {Some{w} : Maybe<Nat>} : Maybe<Nat>}:
  %Equal.sym(Maybe<Nat>, P.lookup(a, k), None{}, hak) : {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(_, k, w), d)), k) == {Some{w} : Maybe<Nat>} : Maybe<Nat>}
  %Equal.sym(Maybe<Nat>, P.lookup(P.apply(P.diff_added(t, a), P.step(d, P.Put{k, w})), k), P.lookup(P.step(d, P.Put{k, w}), k), added_untouched(t, a, P.step(d, P.Put{k, w}), k, nk)) : {_ == {Some{w} : Maybe<Nat>} : Maybe<Nat>}
  lookup_put_same(d, k, w)

# added_fill, one entry: on j it adds the target's value, which the rest of the target lacks.
def added_fill_entry(
  bk: Bool,
  +k: Nat,
  +w: Nat,
  +t: +List<P.Entry>,
  +a: +List<P.Entry>,
  +d: +List<P.Entry>,
  +j: Nat,
  +ha: {P.lookup(a, j) == {None{} : Maybe<Nat>} : Maybe<Nat>},
  hd: {P.lookup(d, j) == {None{} : Maybe<Nat>} : Maybe<Nat>},
  nk: {P.lookup(t, k) == {None{} : Maybe<Nat>} : Maybe<Nat>},
  +q: {Nat.is_eq(k, j) == bk : Bool},
  ih: @d2: +List<P.Entry> -> @hd2: {P.lookup(d2, j) == {None{} : Maybe<Nat>} : Maybe<Nat>} -> {P.lookup(P.apply(P.diff_added(t, a), d2), j) == P.lookup(t, j) : Maybe<Nat>}
) -> {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), j) == P.lookup_pick(bk, w, P.lookup(t, j)) : Maybe<Nat>}:
  match bk:
    case True{}:
      +kj = is_eq_true_eq(k, j, q)
      hak = {(%Equal.sym(Nat, k, j, kj) : {P.lookup(a, _) == {None{} : Maybe<Nat>} : Maybe<Nat>}; ha) : {P.lookup(a, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}}
      %kj : {P.lookup(P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), _) == {Some{w} : Maybe<Nat>} : Maybe<Nat>}
      added_fill_put(k, w, t, a, d, hak, nk)
    case False{}:
      hd2 = {(%Equal.sym(Maybe<Nat>, P.lookup(P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d), j), P.lookup(d, j), added_other(P.lookup(a, k), k, w, j, d, q)) : {_ == {None{} : Maybe<Nat>} : Maybe<Nat>}; hd) : {P.lookup(P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d), j) == {None{} : Maybe<Nat>} : Maybe<Nat>}}
      ih(P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d), hd2)

# LEMMA: with distinct target keys, when neither the source nor the document holds j, the added pass
# gives j the target's value.
def added_fill(b: +List<P.Entry>, +a: +List<P.Entry>, +d: +List<P.Entry>, +j: Nat, +ha: {P.lookup(a, j) == {None{} : Maybe<Nat>} : Maybe<Nat>}, hd: {P.lookup(d, j) == {None{} : Maybe<Nat>} : Maybe<Nat>}, db: Spec.Distinct(b)) -> {P.lookup(P.apply(P.diff_added(b, a), d), j) == P.lookup(b, j) : Maybe<Nat>}:
  match b:
    case Nil{}:
      hd
    case Con{P.E{+k, +w}, +t}:
      (nk, dt) = db
      %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_added_pick(P.lookup(a, k), k, w), P.diff_added(t, a)), d), P.apply(P.diff_added(t, a), P.apply(P.diff_added_pick(P.lookup(a, k), k, w), d)), apply_append(P.diff_added_pick(P.lookup(a, k), k, w), P.diff_added(t, a), d)) : {P.lookup(_, j) == P.lookup_pick(Nat.is_eq(k, j), w, P.lookup(t, j)) : Maybe<Nat>}
      added_fill_entry(Nat.is_eq(k, j), k, w, t, a, d, j, ha, hd, nk, {==}, d2 => hd2 => added_fill(t, a, d2, j, ha, hd2, dt))

# The round trip from any document d that agrees with the source a at j, split on whether a holds j.
def roundtrip_from(m: Maybe<Nat>, +a: +List<P.Entry>, +b: +List<P.Entry>, +d: +List<P.Entry>, db: Spec.Distinct(b), +j: Nat, +e: {P.lookup(a, j) == m : Maybe<Nat>}, +hd: {P.lookup(d, j) == P.lookup(a, j) : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_added(b, a), P.apply(P.diff_source(a, b), d)), j) == P.lookup(b, j) : Maybe<Nat>}:
  match m:
    case None{}:
      hs = Equal.trans(Maybe<Nat>, P.lookup(P.apply(P.diff_source(a, b), d), j), P.lookup(d, j), None{}, source_skip(a, b, d, j, e), Equal.trans(Maybe<Nat>, P.lookup(d, j), P.lookup(a, j), None{}, hd, e))
      added_fill(b, a, P.apply(P.diff_source(a, b), d), j, e, hs, db)
    case Some{+y}:
      Equal.trans(Maybe<Nat>, P.lookup(P.apply(P.diff_added(b, a), P.apply(P.diff_source(a, b), d)), j), P.lookup(P.apply(P.diff_source(a, b), d), j), P.lookup(b, j), added_held(b, a, P.apply(P.diff_source(a, b), d), j, y, e), source_reach(a, b, d, j, y, e, hd))

# LEMMA: applying the diff of a and b to a document that agrees with a at j gives b's value at j.
def roundtrip_d(+a: +List<P.Entry>, +b: +List<P.Entry>, +d: +List<P.Entry>, db: Spec.Distinct(b), +j: Nat, +hd: {P.lookup(d, j) == P.lookup(a, j) : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff(a, b), d), j) == P.lookup(b, j) : Maybe<Nat>}:
  %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_source(a, b), P.diff_added(b, a)), d), P.apply(P.diff_added(b, a), P.apply(P.diff_source(a, b), d)), apply_append(P.diff_source(a, b), P.diff_added(b, a), d)) : {P.lookup(_, j) == P.lookup(b, j) : Maybe<Nat>}
  roundtrip_from(P.lookup(a, j), a, b, d, db, j, {==}, hd)

def Laws.apply_diff_roundtrip(a, b, db, j):
  roundtrip_d(a, b, a, db, j, {==})

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

# LEMMA: adding one on the right is the successor.
law add_one:
  for +n: Nat
  {Nat.add(n, 1n) == 1n+n : Nat}
def add_one(n):
  match n:
    case 0n:
      {==}
    case 1n+p:
      %add_one(p) : {1n+Nat.add(p, 1n) == 1n+_ : Nat}
      {==}

# LEMMA: a successor on the right of an addition comes out in front.
law add_succ_right:
  for +n: Nat
  for +m: Nat
  {Nat.add(n, 1n+m) == 1n+Nat.add(n, m) : Nat}
def add_succ_right(n, m):
  match n:
    case 0n:
      {==}
    case 1n+p:
      %add_succ_right(p, m) : {1n+Nat.add(p, 1n+m) == 1n+_ : Nat}
      {==}

# LEMMA: a list of at most n elements has at most n plus m.
law fits_add:
  for +p: +List<Nat>
  for +n: Nat
  for +m: Nat
  for h: {Spec.fits(p, n) == True{} : Bool}
  {Spec.fits(p, Nat.add(n, m)) == True{} : Bool}
def fits_add(p, n, m, h):
  match p n:
    case Nil{} n:
      {==}
    case Con{x, t} 0n:
      Empty.absurd({Spec.fits(x <> t, m) == True{} : Bool}, false_ne_true(h))
    case Con{x, t} 1n+k:
      fits_add(t, k, m, h)

# LEMMA: a list of at most n elements, with one more at its end, has at most n plus one.
law fits_snoc:
  for +cur: +List<Nat>
  for +n: Nat
  for +x: Nat
  for h: {Spec.fits(cur, n) == True{} : Bool}
  {Spec.fits(List.append(&2, Nat, cur, [x]), 1n+n) == True{} : Bool}
def fits_snoc(cur, n, x, h):
  match cur n:
    case Nil{} n:
      {==}
    case Con{c, t} 0n:
      Empty.absurd({Spec.fits(c <> List.append(&2, Nat, t, [x]), 1n) == True{} : Bool}, false_ne_true(h))
    case Con{c, t} 1n+k:
      fits_snoc(t, k, x, h)

# The emitted piece fits the size: the current piece fits n, and n plus one is the size.
def snoc_fits_size(+cur: +List<Nat>, +n: Nat, +x: Nat, +s: Nat, fc: {Spec.fits(cur, n) == True{} : Bool}, e: {Nat.add(n, 1n) == 1n+s : Nat}) -> {Spec.fits(List.append(&2, Nat, cur, [x]), 1n+s) == True{} : Bool}:
  %e : {Spec.fits(List.append(&2, Nat, cur, [x]), _) == True{} : Bool}
  %Equal.sym(Nat, Nat.add(n, 1n), 1n+n, add_one(n)) : {Spec.fits(List.append(&2, Nat, cur, [x]), _) == True{} : Bool}
  fits_snoc(cur, n, x, fc)

# LEMMA: a piece that fits, in front of pieces that fit, gives pieces that fit.
law piece_front:
  for +cur: +List<Nat>
  for +x: Nat
  for +m: Nat
  for +rest: +List<+List<Nat>>
  for hf: {Spec.fits(List.append(&2, Nat, cur, [x]), m) == True{} : Bool}
  for hr: {Spec.pieces_fit(rest, m) == True{} : Bool}
  {Spec.pieces_fit(List.append(&2, Nat, cur, [x]) <> rest, m) == True{} : Bool}
def piece_front(cur, x, m, rest, hf, hr):
  match cur:
    case Nil{}:
      %Equal.sym(Bool, Spec.fits([x], m), True{}, hf) : {Bool.and(_, Spec.pieces_fit(rest, m)) == True{} : Bool}
      hr
    case Con{c, t}:
      %Equal.sym(Bool, Spec.fits(c <> List.append(&2, Nat, t, [x]), m), True{}, hf) : {Bool.and(_, Spec.pieces_fit(rest, m)) == True{} : Bool}
      hr

# LEMMA: chunking with a current piece of at most n elements and rem slots left, where n plus rem
# is the size, gives pieces that are non-empty and fit the size.
law chunk_go_fit:
  for +xs: +List<Nat>
  for +s: Nat
  for +cur: +List<Nat>
  for +n: Nat
  for +r: Nat
  for fc: {Spec.fits(cur, n) == True{} : Bool}
  for e: {Nat.add(n, 1n+r) == 1n+s : Nat}
  {Spec.pieces_fit(C.chunk_go(xs, 1n+s, cur, 1n+r), 1n+s) == True{} : Bool}
def chunk_go_fit(xs, s, cur, n, r, fc, e):
  match xs r:
    case Nil{} r:
      match cur:
        case Nil{}:
          {==}
        case Con{+c, +t}:
          # the last piece: it fits n, so it fits n plus the slots left, the size
          %e : {Bool.and(Spec.fits(c <> t, _), True{}) == True{} : Bool}
          %Equal.sym(Bool, Spec.fits(c <> t, Nat.add(n, 1n+r)), True{}, fits_add(c <> t, n, 1n+r, fc)) : {Bool.and(_, True{}) == True{} : Bool}
          {==}
    case Con{+x, +t} 0n:
      # the last slot: the piece is emitted, and the rest starts from an empty piece
      piece_front(cur, x, 1n+s, C.chunk_go(t, 1n+s, [], 1n+s), snoc_fits_size(cur, n, x, s, fc, e), chunk_go_fit(t, s, [], 0n, s, {==}, {==}))
    case Con{+x, +t} 1n+q:
      # x joins the piece, which now fits n plus one, with one slot fewer
      chunk_go_fit(t, s, List.append(&2, Nat, cur, [x]), 1n+n, q, fits_snoc(cur, n, x, fc), Equal.trans(Nat, 1n+Nat.add(n, 1n+q), Nat.add(n, 2n+q), 1n+s, Equal.sym(Nat, Nat.add(n, 2n+q), 1n+Nat.add(n, 1n+q), add_succ_right(n, 1n+q)), e))

def Laws.chunk_pieces_fit(xs, s):
  chunk_go_fit(xs, s, [], 0n, s, {==}, {==})

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

# A key list that omits k at the top level omits every key equal to k.
def top_same(+keys: +List<+List<Nat>>, +j: Nat, +k: Nat, e: {j == k : Nat}, t: {O.is_top(keys, k) == True{} : Bool}) -> {O.is_top(keys, j) == True{} : Bool}:
  %Equal.sym(Nat, j, k, e) : {O.is_top(keys, _) == True{} : Bool}
  t

# One field: dropped when the key list omits its key, kept otherwise, and then its key is not k.
def keep_absent(bt: Bool, be: Bool, +keys: +List<+List<Nat>>, +j: Nat, +k: Nat, +x: O.Tree, +rest: +List<O.Field>, qt: {O.is_top(keys, j) == bt : Bool}, qe: {Nat.is_eq(j, k) == be : Bool}, +t: {O.is_top(keys, k) == True{} : Bool}, ih: {Spec.has_field(rest, k) == False{} : Bool}) -> {Spec.has_field(O.keep_pick(bt, O.F{j, x}, rest), k) == False{} : Bool}:
  match bt be:
    case True{} be:
      ih
    case False{} False{}:
      %Equal.sym(Bool, Nat.is_eq(j, k), False{}, qe) : {Bool.or(_, Spec.has_field(rest, k)) == False{} : Bool}
      ih
    case False{} True{}:
      Empty.absurd({Spec.has_field(O.F{j, x} <> rest, k) == False{} : Bool}, false_ne_true(Equal.trans(Bool, False{}, O.is_top(keys, j), True{}, Equal.sym(Bool, O.is_top(keys, j), False{}, qt), top_same(keys, j, k, is_eq_true_eq(j, k, qe), t))))

# omit_drops_top_key, with the hypothesis made reusable for the induction.
def drops_top(+fs: +List<O.Field>, +f: Nat, +keys: +List<+List<Nat>>, +k: Nat, +t: {O.is_top(keys, k) == True{} : Bool}) -> {Spec.has_field(O.unwrap_fs(O.go(Nat.add(List.length(&2, O.Field, fs), 1n+f), O.Fs{fs}, keys)), k) == False{} : Bool}:
  match fs:
    case Nil{}:
      {==}
    case Con{O.F{+j, +x}, +rest}:
      keep_absent(O.is_top(keys, j), Nat.is_eq(j, k), keys, j, k, O.unwrap_t(O.go(Nat.add(List.length(&2, O.Field, rest), 1n+f), O.T{x}, O.child_keys(keys, j))), O.unwrap_fs(O.go(Nat.add(List.length(&2, O.Field, rest), 1n+f), O.Fs{rest}, keys)), {==}, {==}, t, drops_top(rest, f, keys, k, t))

# Split on what the key list says about k, so the hypothesis can be rebuilt as a reusable one.
def drops_top_pick(bk: Bool, +fs: +List<O.Field>, +f: Nat, +keys: +List<+List<Nat>>, +k: Nat, +q: {O.is_top(keys, k) == bk : Bool}, t: {bk == True{} : Bool}) -> {Spec.has_field(O.unwrap_fs(O.go(Nat.add(List.length(&2, O.Field, fs), 1n+f), O.Fs{fs}, keys)), k) == False{} : Bool}:
  match bk:
    case True{}:
      drops_top(fs, f, keys, k, q)
    case False{}:
      Empty.absurd({Spec.has_field(O.unwrap_fs(O.go(Nat.add(List.length(&2, O.Field, fs), 1n+f), O.Fs{fs}, keys)), k) == False{} : Bool}, false_ne_true(t))

def Laws.omit_drops_top_key(fs, f, keys, k, t):
  drops_top_pick(O.is_top(keys, k), fs, f, keys, k, {==}, t)

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

def Laws.ttl_negative_drops(e, secs, frac):
  {==}

# ---- disabled history: one step, then any commands ----

# writes is False whatever the switches when history is off.
def dis_write(ops: +List<P.Op>, +ev: Bool, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_write(ops, Hs.Cfg{False{}, ev}, f, id, old, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match ops f:
    case Nil{} f:
      {==}
    case Con{o, os} Hs.Flags{h, e, i}:
      {==}

def dis_omit(none: Bool, +ev: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_omit(none, Hs.Cfg{False{}, ev}, o, f, id, old, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match none:
    case True{}:
      {==}
    case False{}:
      dis_write(Hs.ops_data(P.diff(Hs.strip(Hs.omit_keys(o), old), Hs.strip(Hs.omit_keys(o), doc))), ev, f, id, old, doc, store, hist, evs)

def dis_update_hook(skip: Bool, +ev: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_hook(skip, Hs.Cfg{False{}, ev}, o, f, id, old, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      dis_omit(Hs.blank(o, old, doc), ev, o, f, id, old, doc, store, hist, evs)

def dis_update(found: Maybe<+List<P.Entry>>, +ev: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_pick(found, Hs.Cfg{False{}, ev}, o, f, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      dis_update_hook(Hs.skipped(f), ev, o, f, id, old, doc, store, hist, evs)

def dis_delete_hook(skip: Bool, +ev: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.delete_hook(skip, Hs.Cfg{False{}, ev}, o, f, id, old, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match skip f:
    case True{} f:
      {==}
    case False{} Hs.Flags{h, e, i}:
      {==}

def dis_delete(found: Maybe<+List<P.Entry>>, +ev: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.delete_pick(found, Hs.Cfg{False{}, ev}, o, f, id, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      dis_delete_hook(Hs.skipped(f), ev, o, f, id, old, store, hist, evs)

def dis_create(found: Maybe<+List<P.Entry>>, +ev: Bool, +o: Hs.Omit, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.create_pick(found, Hs.Cfg{False{}, ev}, o, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

# LEMMA: with history off, one command writes no history.
law disabled_step:
  for +ev: Bool
  for +o: Hs.Omit
  for st: Hs.State
  for cmd: Hs.Cmd
  {Hs.hist_of(Hs.step_with(Hs.Cfg{False{}, ev}, o, st, cmd)) == Hs.hist_of(st) : +List<Hs.Hist>}
def disabled_step(ev, o, st, cmd):
  match st cmd:
    case Hs.S{+store, +hist, +evs} Hs.Create{+id, +doc}:
      dis_create(Hs.find(store, id), ev, o, id, doc, store, hist, evs)
    case Hs.S{+store, +hist, +evs} Hs.Update{+id, +doc, +f}:
      dis_update(Hs.find(store, id), ev, o, f, id, doc, store, hist, evs)
    case Hs.S{+store, +hist, +evs} Hs.Delete{+id, +f}:
      dis_delete(Hs.find(store, id), ev, o, f, id, store, hist, evs)

# ---- unconfigured events: one step, then any commands ----

# emits is False whatever the switches when no event is configured.
def unc_write(ops: +List<P.Op>, +h: Bool, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_write(ops, Hs.Cfg{h, False{}}, f, id, old, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match ops f:
    case Nil{} f:
      {==}
    case Con{o, os} Hs.Flags{h, e, i}:
      {==}

def unc_omit(none: Bool, +h: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_omit(none, Hs.Cfg{h, False{}}, o, f, id, old, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match none:
    case True{}:
      {==}
    case False{}:
      unc_write(Hs.ops_data(P.diff(Hs.strip(Hs.omit_keys(o), old), Hs.strip(Hs.omit_keys(o), doc))), h, f, id, old, doc, store, hist, evs)

def unc_update_hook(skip: Bool, +h: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_hook(skip, Hs.Cfg{h, False{}}, o, f, id, old, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      unc_omit(Hs.blank(o, old, doc), h, o, f, id, old, doc, store, hist, evs)

def unc_update(found: Maybe<+List<P.Entry>>, +h: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_pick(found, Hs.Cfg{h, False{}}, o, f, id, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      unc_update_hook(Hs.skipped(f), h, o, f, id, old, doc, store, hist, evs)

def unc_delete_hook(skip: Bool, +h: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.delete_hook(skip, Hs.Cfg{h, False{}}, o, f, id, old, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match skip f:
    case True{} f:
      {==}
    case False{} Hs.Flags{h, e, i}:
      {==}

def unc_delete(found: Maybe<+List<P.Entry>>, +h: Bool, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.delete_pick(found, Hs.Cfg{h, False{}}, o, f, id, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      unc_delete_hook(Hs.skipped(f), h, o, f, id, old, store, hist, evs)

def unc_create(found: Maybe<+List<P.Entry>>, +h: Bool, +o: Hs.Omit, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.create_pick(found, Hs.Cfg{h, False{}}, o, id, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

# LEMMA: with no event configured, one command emits none.
law unconfigured_step:
  for +h: Bool
  for +o: Hs.Omit
  for st: Hs.State
  for cmd: Hs.Cmd
  {Hs.evs_of(Hs.step_with(Hs.Cfg{h, False{}}, o, st, cmd)) == Hs.evs_of(st) : +List<Hs.Ev>}
def unconfigured_step(h, o, st, cmd):
  match st cmd:
    case Hs.S{+store, +hist, +evs} Hs.Create{+id, +doc}:
      unc_create(Hs.find(store, id), h, o, id, doc, store, hist, evs)
    case Hs.S{+store, +hist, +evs} Hs.Update{+id, +doc, +f}:
      unc_update(Hs.find(store, id), h, o, f, id, doc, store, hist, evs)
    case Hs.S{+store, +hist, +evs} Hs.Delete{+id, +f}:
      unc_delete(Hs.find(store, id), h, o, f, id, store, hist, evs)


# ---- query switches and configuration over calls ----

# A history append or event emit whose condition is false leaves the list as it is.
def when_hist_off(b: Bool, +hist: +List<Hs.Hist>, h: Hs.Hist, w: {b == False{} : Bool}) -> {Hs.when_hist(b, hist, h) == hist : +List<Hs.Hist>}:
  match b:
    case False{}:
      {==}
    case True{}:
      Empty.absurd({Hs.when_hist(True{}, hist, h) == hist : +List<Hs.Hist>}, false_ne_true(Equal.sym(Bool, True{}, False{}, w)))

def when_ev_off(b: Bool, +evs: +List<Hs.Ev>, e: Hs.Ev, w: {b == False{} : Bool}) -> {Hs.when_ev(b, evs, e) == evs : +List<Hs.Ev>}:
  match b:
    case False{}:
      {==}
    case True{}:
      Empty.absurd({Hs.when_ev(True{}, evs, e) == evs : +List<Hs.Ev>}, false_ne_true(Equal.sym(Bool, True{}, False{}, w)))

# When writes(c, f) is false, an update, delete or upsert with switches f writes no history.
def no_hist_write(ops: +List<P.Op>, +c: Hs.Cfg, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_write(ops, c, f, id, old, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match ops:
    case Nil{}:
      {==}
    case Con{+o, +os}:
      when_hist_off(Hs.writes(c, f), hist, Hs.H{Hs.KUpdate{}, id, Hs.next_version(Hs.top_version(hist, id)), [], o <> os}, w)

def no_hist_omit(none: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_omit(none, c, o, f, id, old, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match none:
    case True{}:
      {==}
    case False{}:
      no_hist_write(Hs.ops_data(P.diff(Hs.strip(Hs.omit_keys(o), old), Hs.strip(Hs.omit_keys(o), doc))), c, f, w, id, old, doc, store, hist, evs)

def no_hist_update_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_hook(skip, c, o, f, id, old, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      no_hist_omit(Hs.blank(o, old, doc), c, o, f, w, id, old, doc, store, hist, evs)

def no_hist_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_pick(found, c, o, f, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      no_hist_update_hook(Hs.skipped(f), c, o, f, w, id, old, doc, store, hist, evs)

def no_hist_delete_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.delete_hook(skip, c, o, f, id, old, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      when_hist_off(Hs.writes(c, f), hist, Hs.H{Hs.KDelete{}, id, 0n, Hs.strip(Hs.omit_keys(o), old), []}, w)

def no_hist_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.delete_pick(found, c, o, f, id, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      no_hist_delete_hook(Hs.skipped(f), c, o, f, w, id, old, store, hist, evs)

def no_hist_upsert_new(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.upsert_new(skip, c, o, f, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      when_hist_off(Hs.writes(c, f), hist, Hs.H{Hs.KCreate{}, id, 0n, Hs.strip(Hs.omit_keys(o), doc), []}, w)

def no_hist_upsert(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.writes(c, f) == False{} : Bool}, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.upsert_pick(found, c, o, f, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case Some{+old}:
      no_hist_update_hook(Hs.skipped(f), c, o, f, w, id, old, doc, store, hist, evs)
    case None{}:
      no_hist_upsert_new(Hs.skipped(f), c, o, f, w, id, doc, store, hist, evs)

# LEMMA: when writes(c, f) is false, updateMany with switches f writes no history.
law no_hist_updates:
  for +ids: +List<Nat>
  for +doc: +List<P.Entry>
  for +f: Hs.Flags
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +w: {Hs.writes(c, f) == False{} : Bool}
  for st: Hs.State
  {Hs.hist_of(Hs.updates(ids, doc, f, c, o, st)) == Hs.hist_of(st) : +List<Hs.Hist>}
def no_hist_updates(ids, doc, f, c, o, w, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Hist>, Hs.hist_of(Hs.updates(t, doc, f, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, f}))), Hs.hist_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, f})), hist, no_hist_updates(t, doc, f, c, o, w, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, f})), no_hist_update(Hs.find(store, id), c, o, f, w, id, doc, store, hist, evs))

# LEMMA: when writes(c, f) is false, deleteMany with switches f writes no history.
law no_hist_deletes:
  for +ids: +List<Nat>
  for +f: Hs.Flags
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +w: {Hs.writes(c, f) == False{} : Bool}
  for st: Hs.State
  {Hs.hist_of(Hs.deletes(ids, f, c, o, st)) == Hs.hist_of(st) : +List<Hs.Hist>}
def no_hist_deletes(ids, f, c, o, w, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Hist>, Hs.hist_of(Hs.deletes(t, f, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, f}))), Hs.hist_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, f})), hist, no_hist_deletes(t, f, c, o, w, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, f})), no_hist_delete(Hs.find(store, id), c, o, f, w, id, store, hist, evs))

def no_hist_vetoed(skip: Bool, +ids: +List<Nat>, +f: Hs.Flags, +c: Hs.Cfg, +o: Hs.Omit, +w: {Hs.writes(c, f) == False{} : Bool}, st: Hs.State) -> {Hs.hist_of(Hs.vetoed(skip, ids, f, c, o, st)) == Hs.hist_of(st) : +List<Hs.Hist>}:
  match skip:
    case True{}:
      no_hist_deletes(ids, f, c, o, w, st)
    case False{}:
      {==}

# When emits(c, f) is false, an update, delete or upsert with switches f emits no event.
def no_ev_write(ops: +List<P.Op>, +c: Hs.Cfg, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_write(ops, c, f, id, old, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match ops:
    case Nil{}:
      {==}
    case Con{+o, +os}:
      when_ev_off(Hs.emits(c, f), evs, Hs.EUpdated{old, doc, o <> os}, w)

def no_ev_omit(none: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_omit(none, c, o, f, id, old, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match none:
    case True{}:
      {==}
    case False{}:
      no_ev_write(Hs.ops_data(P.diff(Hs.strip(Hs.omit_keys(o), old), Hs.strip(Hs.omit_keys(o), doc))), c, f, w, id, old, doc, store, hist, evs)

def no_ev_update_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_hook(skip, c, o, f, id, old, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      no_ev_omit(Hs.blank(o, old, doc), c, o, f, w, id, old, doc, store, hist, evs)

def no_ev_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_pick(found, c, o, f, id, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      no_ev_update_hook(Hs.skipped(f), c, o, f, w, id, old, doc, store, hist, evs)

def no_ev_delete_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.delete_hook(skip, c, o, f, id, old, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      when_ev_off(Hs.emits(c, f), evs, Hs.EDeleted{Hs.strip(Hs.omit_keys(o), old)}, w)

def no_ev_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.delete_pick(found, c, o, f, id, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      no_ev_delete_hook(Hs.skipped(f), c, o, f, w, id, old, store, hist, evs)

def no_ev_upsert_new(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.upsert_new(skip, c, o, f, id, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      when_ev_off(Hs.emits(c, f), evs, Hs.ECreated{Hs.strip(Hs.omit_keys(o), doc)}, w)

def no_ev_upsert(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +w: {Hs.emits(c, f) == False{} : Bool}, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.upsert_pick(found, c, o, f, id, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case Some{+old}:
      no_ev_update_hook(Hs.skipped(f), c, o, f, w, id, old, doc, store, hist, evs)
    case None{}:
      no_ev_upsert_new(Hs.skipped(f), c, o, f, w, id, doc, store, hist, evs)

# LEMMA: when emits(c, f) is false, updateMany with switches f emits no event.
law no_ev_updates:
  for +ids: +List<Nat>
  for +doc: +List<P.Entry>
  for +f: Hs.Flags
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +w: {Hs.emits(c, f) == False{} : Bool}
  for st: Hs.State
  {Hs.evs_of(Hs.updates(ids, doc, f, c, o, st)) == Hs.evs_of(st) : +List<Hs.Ev>}
def no_ev_updates(ids, doc, f, c, o, w, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Ev>, Hs.evs_of(Hs.updates(t, doc, f, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, f}))), Hs.evs_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, f})), evs, no_ev_updates(t, doc, f, c, o, w, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, f})), no_ev_update(Hs.find(store, id), c, o, f, w, id, doc, store, hist, evs))

# LEMMA: when emits(c, f) is false, deleteMany with switches f emits no event.
law no_ev_deletes:
  for +ids: +List<Nat>
  for +f: Hs.Flags
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +w: {Hs.emits(c, f) == False{} : Bool}
  for st: Hs.State
  {Hs.evs_of(Hs.deletes(ids, f, c, o, st)) == Hs.evs_of(st) : +List<Hs.Ev>}
def no_ev_deletes(ids, f, c, o, w, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Ev>, Hs.evs_of(Hs.deletes(t, f, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, f}))), Hs.evs_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, f})), evs, no_ev_deletes(t, f, c, o, w, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, f})), no_ev_delete(Hs.find(store, id), c, o, f, w, id, store, hist, evs))

def no_ev_vetoed(skip: Bool, +ids: +List<Nat>, +f: Hs.Flags, +c: Hs.Cfg, +o: Hs.Omit, +w: {Hs.emits(c, f) == False{} : Bool}, st: Hs.State) -> {Hs.evs_of(Hs.vetoed(skip, ids, f, c, o, st)) == Hs.evs_of(st) : +List<Hs.Ev>}:
  match skip:
    case True{}:
      no_ev_deletes(ids, f, c, o, w, st)
    case False{}:
      {==}


# ---- ignoreHook: the hook does nothing, found or not ----

def hook_hist_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.update_pick(found, c, o, Hs.Flags{True{}, e, h}, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

def hook_hist_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.delete_pick(found, c, o, Hs.Flags{True{}, e, h}, id, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

def hook_hist_upsert(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.hist_of(Hs.upsert_pick(found, c, o, Hs.Flags{True{}, e, h}, id, doc, store, hist, evs)) == hist : +List<Hs.Hist>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

# LEMMA: updateMany with ignoreHook writes no history.
law hook_hist_updates:
  for +ids: +List<Nat>
  for +doc: +List<P.Entry>
  for +e: Bool
  for +h: Bool
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  {Hs.hist_of(Hs.updates(ids, doc, Hs.Flags{True{}, e, h}, c, o, st)) == Hs.hist_of(st) : +List<Hs.Hist>}
def hook_hist_updates(ids, doc, e, h, c, o, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Hist>, Hs.hist_of(Hs.updates(t, doc, Hs.Flags{True{}, e, h}, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, Hs.Flags{True{}, e, h}}))), Hs.hist_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, Hs.Flags{True{}, e, h}})), hist, hook_hist_updates(t, doc, e, h, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, Hs.Flags{True{}, e, h}})), hook_hist_update(Hs.find(store, id), c, o, e, h, id, doc, store, hist, evs))

# LEMMA: deleteMany with ignoreHook writes no history.
law hook_hist_deletes:
  for +ids: +List<Nat>
  for +e: Bool
  for +h: Bool
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  {Hs.hist_of(Hs.deletes(ids, Hs.Flags{True{}, e, h}, c, o, st)) == Hs.hist_of(st) : +List<Hs.Hist>}
def hook_hist_deletes(ids, e, h, c, o, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Hist>, Hs.hist_of(Hs.deletes(t, Hs.Flags{True{}, e, h}, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, Hs.Flags{True{}, e, h}}))), Hs.hist_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, Hs.Flags{True{}, e, h}})), hist, hook_hist_deletes(t, e, h, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, Hs.Flags{True{}, e, h}})), hook_hist_delete(Hs.find(store, id), c, o, e, h, id, store, hist, evs))

def hook_ev_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.update_pick(found, c, o, Hs.Flags{True{}, e, h}, id, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

def hook_ev_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.delete_pick(found, c, o, Hs.Flags{True{}, e, h}, id, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

def hook_ev_upsert(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +e: Bool, +h: Bool, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.evs_of(Hs.upsert_pick(found, c, o, Hs.Flags{True{}, e, h}, id, doc, store, hist, evs)) == evs : +List<Hs.Ev>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

# LEMMA: updateMany with ignoreHook emits no event.
law hook_ev_updates:
  for +ids: +List<Nat>
  for +doc: +List<P.Entry>
  for +e: Bool
  for +h: Bool
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  {Hs.evs_of(Hs.updates(ids, doc, Hs.Flags{True{}, e, h}, c, o, st)) == Hs.evs_of(st) : +List<Hs.Ev>}
def hook_ev_updates(ids, doc, e, h, c, o, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Ev>, Hs.evs_of(Hs.updates(t, doc, Hs.Flags{True{}, e, h}, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, Hs.Flags{True{}, e, h}}))), Hs.evs_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, Hs.Flags{True{}, e, h}})), evs, hook_ev_updates(t, doc, e, h, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Update{id, doc, Hs.Flags{True{}, e, h}})), hook_ev_update(Hs.find(store, id), c, o, e, h, id, doc, store, hist, evs))

# LEMMA: deleteMany with ignoreHook emits no event.
law hook_ev_deletes:
  for +ids: +List<Nat>
  for +e: Bool
  for +h: Bool
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  {Hs.evs_of(Hs.deletes(ids, Hs.Flags{True{}, e, h}, c, o, st)) == Hs.evs_of(st) : +List<Hs.Ev>}
def hook_ev_deletes(ids, e, h, c, o, st):
  match ids st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+id, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Ev>, Hs.evs_of(Hs.deletes(t, Hs.Flags{True{}, e, h}, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, Hs.Flags{True{}, e, h}}))), Hs.evs_of(Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, Hs.Flags{True{}, e, h}})), evs, hook_ev_deletes(t, e, h, c, o, Hs.step_with(c, o, Hs.S{store, hist, evs}, Hs.Delete{id, Hs.Flags{True{}, e, h}})), hook_ev_delete(Hs.find(store, id), c, o, e, h, id, store, hist, evs))

# ---- the switches make writes or emits false ----

def disabled_off(+ev: Bool, f: Hs.Flags) -> {Hs.writes(Hs.Cfg{False{}, ev}, f) == False{} : Bool}:
  match f:
    case Hs.Flags{h, e, i}:
      {==}

def unconfigured_off(+h: Bool, f: Hs.Flags) -> {Hs.emits(Hs.Cfg{h, False{}}, f) == False{} : Bool}:
  match f:
    case Hs.Flags{k, e, i}:
      {==}

def history_off(c: Hs.Cfg, +h: Bool, +e: Bool) -> {Hs.writes(c, Hs.Flags{h, e, True{}}) == False{} : Bool}:
  match c:
    case Hs.Cfg{True{}, ev}:
      {==}
    case Hs.Cfg{False{}, ev}:
      {==}

def event_off(c: Hs.Cfg, +h: Bool, +i: Bool) -> {Hs.emits(c, Hs.Flags{h, True{}, i}) == False{} : Bool}:
  match c:
    case Hs.Cfg{hc, True{}}:
      {==}
    case Hs.Cfg{hc, False{}}:
      {==}

# ---- history off and no events configured: one call, then any calls ----

# LEMMA: with history off, insertMany writes no history.
law disabled_creates:
  for +items: +List<Hs.Item>
  for +ev: Bool
  for +o: Hs.Omit
  for st: Hs.State
  {Hs.hist_of(Hs.creates(items, Hs.Cfg{False{}, ev}, o, st)) == Hs.hist_of(st) : +List<Hs.Hist>}
def disabled_creates(items, ev, o, st):
  match items st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{Hs.I{+id, +doc}, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Hist>, Hs.hist_of(Hs.creates(t, Hs.Cfg{False{}, ev}, o, Hs.step_with(Hs.Cfg{False{}, ev}, o, Hs.S{store, hist, evs}, Hs.Create{id, doc}))), Hs.hist_of(Hs.step_with(Hs.Cfg{False{}, ev}, o, Hs.S{store, hist, evs}, Hs.Create{id, doc})), hist, disabled_creates(t, ev, o, Hs.step_with(Hs.Cfg{False{}, ev}, o, Hs.S{store, hist, evs}, Hs.Create{id, doc})), disabled_step(ev, o, Hs.S{store, hist, evs}, Hs.Create{id, doc}))

# LEMMA: with history off, one call writes no history.
law disabled_call:
  for +ev: Bool
  for +o: Hs.Omit
  for st: Hs.State
  for k: Hs.Call
  {Hs.hist_of(Hs.call(Hs.Cfg{False{}, ev}, o, st, k)) == Hs.hist_of(st) : +List<Hs.Hist>}
def disabled_call(ev, o, st, k):
  match st k:
    case Hs.S{+store, +hist, +evs} Hs.Single{cmd}:
      disabled_step(ev, o, Hs.S{store, hist, evs}, cmd)
    case Hs.S{+store, +hist, +evs} Hs.InsertMany{+items}:
      disabled_creates(items, ev, o, Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.UpdateMany{+ids, +doc, +f}:
      no_hist_updates(ids, doc, f, Hs.Cfg{False{}, ev}, o, disabled_off(ev, f), Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.DeleteMany{+ids, +f}:
      no_hist_deletes(ids, f, Hs.Cfg{False{}, ev}, o, disabled_off(ev, f), Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.DeleteVetoed{+ids, +f}:
      no_hist_vetoed(Hs.skipped(f), ids, f, Hs.Cfg{False{}, ev}, o, disabled_off(ev, f), Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.Upsert{+id, +doc, +f}:
      no_hist_upsert(Hs.find(store, id), Hs.Cfg{False{}, ev}, o, f, disabled_off(ev, f), id, doc, store, hist, evs)

def Laws.disabled_writes_no_history(ks, ev, o, st):
  match ks st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+k, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Hist>, Hs.hist_of(Hs.calls(t, Hs.Cfg{False{}, ev}, o, Hs.call(Hs.Cfg{False{}, ev}, o, Hs.S{store, hist, evs}, k))), Hs.hist_of(Hs.call(Hs.Cfg{False{}, ev}, o, Hs.S{store, hist, evs}, k)), hist, Laws.disabled_writes_no_history(t, ev, o, Hs.call(Hs.Cfg{False{}, ev}, o, Hs.S{store, hist, evs}, k)), disabled_call(ev, o, Hs.S{store, hist, evs}, k))

# LEMMA: with no events configured, insertMany emits no event.
law unconfigured_creates:
  for +items: +List<Hs.Item>
  for +h: Bool
  for +o: Hs.Omit
  for st: Hs.State
  {Hs.evs_of(Hs.creates(items, Hs.Cfg{h, False{}}, o, st)) == Hs.evs_of(st) : +List<Hs.Ev>}
def unconfigured_creates(items, h, o, st):
  match items st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{Hs.I{+id, +doc}, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Ev>, Hs.evs_of(Hs.creates(t, Hs.Cfg{h, False{}}, o, Hs.step_with(Hs.Cfg{h, False{}}, o, Hs.S{store, hist, evs}, Hs.Create{id, doc}))), Hs.evs_of(Hs.step_with(Hs.Cfg{h, False{}}, o, Hs.S{store, hist, evs}, Hs.Create{id, doc})), evs, unconfigured_creates(t, h, o, Hs.step_with(Hs.Cfg{h, False{}}, o, Hs.S{store, hist, evs}, Hs.Create{id, doc})), unconfigured_step(h, o, Hs.S{store, hist, evs}, Hs.Create{id, doc}))

# LEMMA: with no events configured, one call emits no event.
law unconfigured_call:
  for +h: Bool
  for +o: Hs.Omit
  for st: Hs.State
  for k: Hs.Call
  {Hs.evs_of(Hs.call(Hs.Cfg{h, False{}}, o, st, k)) == Hs.evs_of(st) : +List<Hs.Ev>}
def unconfigured_call(h, o, st, k):
  match st k:
    case Hs.S{+store, +hist, +evs} Hs.Single{cmd}:
      unconfigured_step(h, o, Hs.S{store, hist, evs}, cmd)
    case Hs.S{+store, +hist, +evs} Hs.InsertMany{+items}:
      unconfigured_creates(items, h, o, Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.UpdateMany{+ids, +doc, +f}:
      no_ev_updates(ids, doc, f, Hs.Cfg{h, False{}}, o, unconfigured_off(h, f), Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.DeleteMany{+ids, +f}:
      no_ev_deletes(ids, f, Hs.Cfg{h, False{}}, o, unconfigured_off(h, f), Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.DeleteVetoed{+ids, +f}:
      no_ev_vetoed(Hs.skipped(f), ids, f, Hs.Cfg{h, False{}}, o, unconfigured_off(h, f), Hs.S{store, hist, evs})
    case Hs.S{+store, +hist, +evs} Hs.Upsert{+id, +doc, +f}:
      no_ev_upsert(Hs.find(store, id), Hs.Cfg{h, False{}}, o, f, unconfigured_off(h, f), id, doc, store, hist, evs)

def Laws.unconfigured_emits_nothing(ks, h, o, st):
  match ks st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+k, t} Hs.S{+store, +hist, +evs}:
      Equal.trans(+List<Hs.Ev>, Hs.evs_of(Hs.calls(t, Hs.Cfg{h, False{}}, o, Hs.call(Hs.Cfg{h, False{}}, o, Hs.S{store, hist, evs}, k))), Hs.evs_of(Hs.call(Hs.Cfg{h, False{}}, o, Hs.S{store, hist, evs}, k)), evs, Laws.unconfigured_emits_nothing(t, h, o, Hs.call(Hs.Cfg{h, False{}}, o, Hs.S{store, hist, evs}, k)), unconfigured_call(h, o, Hs.S{store, hist, evs}, k))

# ---- one call with a switch set ----

def Laws.ignore_history_silent(c, o, st, k, q):
  match st k:
    case Hs.S{store, hist, evs} Hs.Single{Hs.Create{id, doc}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Update{+id, +doc, Hs.Flags{+h, +e, True{}}}}:
      no_hist_update(Hs.find(store, id), c, o, Hs.Flags{h, e, True{}}, history_off(c, h, e), id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Update{id, doc, Hs.Flags{h, e, False{}}}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Delete{+id, Hs.Flags{+h, +e, True{}}}}:
      no_hist_delete(Hs.find(store, id), c, o, Hs.Flags{h, e, True{}}, history_off(c, h, e), id, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Delete{id, Hs.Flags{h, e, False{}}}}:
      match q:
    case Hs.S{store, hist, evs} Hs.InsertMany{items}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.UpdateMany{+ids, +doc, Hs.Flags{+h, +e, True{}}}:
      no_hist_updates(ids, doc, Hs.Flags{h, e, True{}}, c, o, history_off(c, h, e), Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.UpdateMany{ids, doc, Hs.Flags{h, e, False{}}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteMany{+ids, Hs.Flags{+h, +e, True{}}}:
      no_hist_deletes(ids, Hs.Flags{h, e, True{}}, c, o, history_off(c, h, e), Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteMany{ids, Hs.Flags{h, e, False{}}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteVetoed{+ids, Hs.Flags{+h, +e, True{}}}:
      no_hist_vetoed(Hs.skipped(Hs.Flags{h, e, True{}}), ids, Hs.Flags{h, e, True{}}, c, o, history_off(c, h, e), Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteVetoed{ids, Hs.Flags{h, e, False{}}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Upsert{+id, +doc, Hs.Flags{+h, +e, True{}}}:
      no_hist_upsert(Hs.find(store, id), c, o, Hs.Flags{h, e, True{}}, history_off(c, h, e), id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Upsert{id, doc, Hs.Flags{h, e, False{}}}:
      match q:

def Laws.ignore_event_quiet(c, o, st, k, q):
  match st k:
    case Hs.S{store, hist, evs} Hs.Single{Hs.Create{id, doc}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Update{+id, +doc, Hs.Flags{+h, True{}, +i}}}:
      no_ev_update(Hs.find(store, id), c, o, Hs.Flags{h, True{}, i}, event_off(c, h, i), id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Update{id, doc, Hs.Flags{h, False{}, i}}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Delete{+id, Hs.Flags{+h, True{}, +i}}}:
      no_ev_delete(Hs.find(store, id), c, o, Hs.Flags{h, True{}, i}, event_off(c, h, i), id, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Delete{id, Hs.Flags{h, False{}, i}}}:
      match q:
    case Hs.S{store, hist, evs} Hs.InsertMany{items}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.UpdateMany{+ids, +doc, Hs.Flags{+h, True{}, +i}}:
      no_ev_updates(ids, doc, Hs.Flags{h, True{}, i}, c, o, event_off(c, h, i), Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.UpdateMany{ids, doc, Hs.Flags{h, False{}, i}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteMany{+ids, Hs.Flags{+h, True{}, +i}}:
      no_ev_deletes(ids, Hs.Flags{h, True{}, i}, c, o, event_off(c, h, i), Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteMany{ids, Hs.Flags{h, False{}, i}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteVetoed{+ids, Hs.Flags{+h, True{}, +i}}:
      no_ev_vetoed(Hs.skipped(Hs.Flags{h, True{}, i}), ids, Hs.Flags{h, True{}, i}, c, o, event_off(c, h, i), Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteVetoed{ids, Hs.Flags{h, False{}, i}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Upsert{+id, +doc, Hs.Flags{+h, True{}, +i}}:
      no_ev_upsert(Hs.find(store, id), c, o, Hs.Flags{h, True{}, i}, event_off(c, h, i), id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Upsert{id, doc, Hs.Flags{h, False{}, i}}:
      match q:

def Laws.ignore_hook_silent(c, o, st, k, q):
  match st k:
    case Hs.S{store, hist, evs} Hs.Single{Hs.Create{id, doc}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Update{+id, +doc, Hs.Flags{True{}, +e, +h}}}:
      hook_hist_update(Hs.find(store, id), c, o, e, h, id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Update{id, doc, Hs.Flags{False{}, e, h}}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Delete{+id, Hs.Flags{True{}, +e, +h}}}:
      hook_hist_delete(Hs.find(store, id), c, o, e, h, id, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Delete{id, Hs.Flags{False{}, e, h}}}:
      match q:
    case Hs.S{store, hist, evs} Hs.InsertMany{items}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.UpdateMany{+ids, +doc, Hs.Flags{True{}, +e, +h}}:
      hook_hist_updates(ids, doc, e, h, c, o, Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.UpdateMany{ids, doc, Hs.Flags{False{}, e, h}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteMany{+ids, Hs.Flags{True{}, +e, +h}}:
      hook_hist_deletes(ids, e, h, c, o, Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteMany{ids, Hs.Flags{False{}, e, h}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteVetoed{+ids, Hs.Flags{True{}, +e, +h}}:
      # skipped, so preDelete is skipped too and the delete goes ahead
      hook_hist_deletes(ids, e, h, c, o, Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteVetoed{ids, Hs.Flags{False{}, e, h}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Upsert{+id, +doc, Hs.Flags{True{}, +e, +h}}:
      hook_hist_upsert(Hs.find(store, id), c, o, e, h, id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Upsert{id, doc, Hs.Flags{False{}, e, h}}:
      match q:

def Laws.ignore_hook_quiet(c, o, st, k, q):
  match st k:
    case Hs.S{store, hist, evs} Hs.Single{Hs.Create{id, doc}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Update{+id, +doc, Hs.Flags{True{}, +e, +h}}}:
      hook_ev_update(Hs.find(store, id), c, o, e, h, id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Update{id, doc, Hs.Flags{False{}, e, h}}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Single{Hs.Delete{+id, Hs.Flags{True{}, +e, +h}}}:
      hook_ev_delete(Hs.find(store, id), c, o, e, h, id, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Single{Hs.Delete{id, Hs.Flags{False{}, e, h}}}:
      match q:
    case Hs.S{store, hist, evs} Hs.InsertMany{items}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.UpdateMany{+ids, +doc, Hs.Flags{True{}, +e, +h}}:
      hook_ev_updates(ids, doc, e, h, c, o, Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.UpdateMany{ids, doc, Hs.Flags{False{}, e, h}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteMany{+ids, Hs.Flags{True{}, +e, +h}}:
      hook_ev_deletes(ids, e, h, c, o, Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteMany{ids, Hs.Flags{False{}, e, h}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.DeleteVetoed{+ids, Hs.Flags{True{}, +e, +h}}:
      # skipped, so preDelete is skipped too and the delete goes ahead
      hook_ev_deletes(ids, e, h, c, o, Hs.S{store, hist, evs})
    case Hs.S{store, hist, evs} Hs.DeleteVetoed{ids, Hs.Flags{False{}, e, h}}:
      match q:
    case Hs.S{+store, +hist, +evs} Hs.Upsert{+id, +doc, Hs.Flags{True{}, +e, +h}}:
      hook_ev_upsert(Hs.find(store, id), c, o, e, h, id, doc, store, hist, evs)
    case Hs.S{store, hist, evs} Hs.Upsert{id, doc, Hs.Flags{False{}, e, h}}:
      match q:

# ---- the store depends on the commands only: one step, then any commands ----

def si_write(ops: +List<P.Op>, +c: Hs.Cfg, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.store_of(Hs.update_write(ops, c, f, id, old, doc, store, hist, evs)) == Hs.R{id, doc} <> Hs.remove(store, id) : +List<Hs.Rec>}:
  match ops:
    case Nil{}:
      {==}
    case Con{o, os}:
      {==}

def si_omit(none: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.store_of(Hs.update_omit(none, c, o, f, id, old, doc, store, hist, evs)) == Hs.R{id, doc} <> Hs.remove(store, id) : +List<Hs.Rec>}:
  match none:
    case True{}:
      {==}
    case False{}:
      si_write(Hs.ops_data(P.diff(Hs.strip(Hs.omit_keys(o), old), Hs.strip(Hs.omit_keys(o), doc))), c, f, id, old, doc, store, hist, evs)

def si_update_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.store_of(Hs.update_hook(skip, c, o, f, id, old, doc, store, hist, evs)) == Hs.R{id, doc} <> Hs.remove(store, id) : +List<Hs.Rec>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      si_omit(Hs.blank(o, old, doc), c, o, f, id, old, doc, store, hist, evs)

def si_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.store_of(Hs.update_pick(found, c, o, f, id, doc, store, hist, evs)) == Spec.store_update(found, id, doc, store) : +List<Hs.Rec>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      si_update_hook(Hs.skipped(f), c, o, f, id, old, doc, store, hist, evs)

def si_delete_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.store_of(Hs.delete_hook(skip, c, o, f, id, old, store, hist, evs)) == Hs.remove(store, id) : +List<Hs.Rec>}:
  match skip:
    case True{}:
      {==}
    case False{}:
      {==}

def si_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.store_of(Hs.delete_pick(found, c, o, f, id, store, hist, evs)) == Spec.store_delete(found, id, store) : +List<Hs.Rec>}:
  match found:
    case None{}:
      {==}
    case Some{+old}:
      si_delete_hook(Hs.skipped(f), c, o, f, id, old, store, hist, evs)

def si_create(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>) -> {Hs.store_of(Hs.create_pick(found, c, o, id, doc, store, hist, evs)) == Spec.store_create(found, id, doc, store) : +List<Hs.Rec>}:
  match found:
    case None{}:
      {==}
    case Some{old}:
      {==}

# LEMMA: one command changes the store as Spec.store_step says, whatever the configuration and omit option.
law store_step_independent:
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  for cmd: Hs.Cmd
  {Hs.store_of(Hs.step_with(c, o, st, cmd)) == Spec.store_step(Hs.store_of(st), cmd) : +List<Hs.Rec>}
def store_step_independent(c, o, st, cmd):
  match st cmd:
    case Hs.S{+store, +hist, +evs} Hs.Create{+id, +doc}:
      si_create(Hs.find(store, id), c, o, id, doc, store, hist, evs)
    case Hs.S{+store, +hist, +evs} Hs.Update{+id, +doc, +f}:
      si_update(Hs.find(store, id), c, o, f, id, doc, store, hist, evs)
    case Hs.S{+store, +hist, +evs} Hs.Delete{+id, +f}:
      si_delete(Hs.find(store, id), c, o, f, id, store, hist, evs)

# omit_only_change_silent, once the update is past its hooks: the omitted documents are the same, so
# their diff is empty and the update writes no entry.
def oocs_omit(none: Bool, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, d: Spec.Distinct(Hs.strip(keys, old)), s: {Hs.strip(keys, old) == Hs.strip(keys, doc) : +List<P.Entry>}) -> {Spec.records(Hs.update_omit(none, c, Hs.Omit{keys, i}, f, id, old, doc, store, hist, evs)) == Hs.S{[], hist, evs} : Hs.State}:
  match none:
    case True{}:
      {==}
    case False{}:
      %s : {Spec.records(Hs.update_write(Hs.ops_data(P.diff(Hs.strip(keys, old), _)), c, f, id, old, doc, store, hist, evs)) == Hs.S{[], hist, evs} : Hs.State}
      %Equal.sym(List<P.Op>, P.diff(Hs.strip(keys, old), Hs.strip(keys, old)), [], Laws.diff_self_empty(Hs.strip(keys, old), d)) : {Spec.records(Hs.update_write(Hs.ops_data(_), c, f, id, old, doc, store, hist, evs)) == Hs.S{[], hist, evs} : Hs.State}
      {==}

def oocs_hook(skip: Bool, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, d: Spec.Distinct(Hs.strip(keys, old)), s: {Hs.strip(keys, old) == Hs.strip(keys, doc) : +List<P.Entry>}) -> {Spec.records(Hs.update_hook(skip, c, Hs.Omit{keys, i}, f, id, old, doc, store, hist, evs)) == Hs.S{[], hist, evs} : Hs.State}:
  match skip:
    case True{}:
      {==}
    case False{}:
      oocs_omit(Hs.blank(Hs.Omit{keys, i}, old, doc), c, keys, i, f, id, old, doc, store, hist, evs, d, s)

def Laws.omit_only_change_silent(c, keys, i, store, hist, evs, id, doc, old, f, e, d, s):
  %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(store, id), {Some{old} : Maybe<+List<P.Entry>>}, e) : {Spec.records(Hs.update_pick(_, c, Hs.Omit{keys, i}, f, id, doc, store, hist, evs)) == Hs.S{[], hist, evs} : Hs.State}
  oocs_hook(Hs.skipped(f), c, keys, i, f, id, old, doc, store, hist, evs, d, s)

# ---- omitted keys never reach history ----

# strip_lacks, one entry: an entry that strip keeps has a key the omit option does not list, so not k.
def strip_lacks_keep(be: Bool, +keys: +List<Nat>, +j: Nat, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, +q: {Hs.mem(keys, j) == False{} : Bool}, -t: +List<P.Entry>, +e: {Nat.is_eq(j, k) == be : Bool}, ih: {Spec.has_key(Hs.strip(keys, t), k) == False{} : Bool}) -> {Bool.or(be, Spec.has_key(Hs.strip(keys, t), k)) == False{} : Bool}:
  match be:
    case True{}:
      qk = {(%is_eq_true_eq(j, k, e) : {Hs.mem(keys, _) == False{} : Bool}; q) : {Hs.mem(keys, k) == False{} : Bool}}
      Empty.absurd({True{} == False{} : Bool}, false_ne_true(Equal.trans(Bool, False{}, Hs.mem(keys, k), True{}, Equal.sym(Bool, Hs.mem(keys, k), False{}, qk), m)))
    case False{}:
      ih

def strip_lacks_entry(bm: Bool, +keys: +List<Nat>, +j: Nat, +v: Nat, t: +List<P.Entry>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, +q: {Hs.mem(keys, j) == bm : Bool}, ih: {Spec.has_key(Hs.strip(keys, t), k) == False{} : Bool}) -> {Spec.has_key(Hs.strip_pick(bm, P.E{j, v}, Hs.strip(keys, t)), k) == False{} : Bool}:
  match bm:
    case True{}:
      ih
    case False{}:
      strip_lacks_keep(Nat.is_eq(j, k), keys, j, k, m, q, t, {==}, ih)

# LEMMA: a document stripped of the omitted keys has none of them.
def strip_lacks(+keys: +List<Nat>, d: +List<P.Entry>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}) -> {Spec.has_key(Hs.strip(keys, d), k) == False{} : Bool}:
  match d:
    case Nil{}:
      {==}
    case Con{P.E{+j, +v}, +t}:
      strip_lacks_entry(Hs.mem(keys, j), keys, j, v, t, k, m, {==}, strip_lacks(keys, t, k, m))

# No operation of ops is on key k.
def NoKey(ops: List<P.Op>, +k: Nat) -> Type:
  match ops:
    case Nil{}:
      Unit
    case Con{o, t}:
      {Nat.is_eq(Spec.op_key(o), k) == False{} : Bool} & NoKey(t, k)

# LEMMA: ops with no operation on k mention no k once kept as data.
def no_key_mention(ops: List<P.Op>, +k: Nat, nk: NoKey(ops, k)) -> {Spec.ops_mention(Hs.ops_data(ops), k) == False{} : Bool}:
  match ops:
    case Nil{}:
      {==}
    case Con{+o, t}:
      (e, nt) = nk
      %Equal.sym(Bool, Nat.is_eq(Spec.op_key(o), k), False{}, e) : {Bool.or(_, Spec.ops_mention(Hs.ops_data(t), k)) == False{} : Bool}
      no_key_mention(t, k, nt)

def no_key_append(x: List<P.Op>, y: List<P.Op>, +k: Nat, nx: NoKey(x, k), ny: NoKey(y, k)) -> NoKey(List.append(&1, P.Op, x, y), k):
  match x:
    case Nil{}:
      ny
    case Con{+o, t}:
      (e, nt) = nx
      (e, no_key_append(t, y, k, nt, ny))

def nk_same(bb: Bool, +j: Nat, +w: Nat, +k: Nat, +e: {Nat.is_eq(j, k) == False{} : Bool}) -> NoKey(P.diff_same(bb, j, w), k):
  match bb:
    case True{}:
      Unit{}
    case False{}:
      (e, Unit{})

def nk_one(mm: Maybe<Nat>, +j: Nat, +v: Nat, +k: Nat, +e: {Nat.is_eq(j, k) == False{} : Bool}) -> NoKey(P.diff_one_pick(mm, j, v), k):
  match mm:
    case None{}:
      (e, Unit{})
    case Some{+w}:
      nk_same(Nat.is_eq(v, w), j, w, k, e)

def nk_added_one(mm: Maybe<Nat>, +j: Nat, +w: Nat, +k: Nat, +e: {Nat.is_eq(j, k) == False{} : Bool}) -> NoKey(P.diff_added_pick(mm, j, w), k):
  match mm:
    case None{}:
      (e, Unit{})
    case Some{y}:
      Unit{}

def nk_source_entry(be: Bool, +j: Nat, +v: Nat, +t: +List<P.Entry>, +b: +List<P.Entry>, +k: Nat, h: {Bool.or(be, Spec.has_key(t, k)) == False{} : Bool}, +e: {Nat.is_eq(j, k) == be : Bool}, ih: @h2: {Spec.has_key(t, k) == False{} : Bool} -> NoKey(P.diff_source(t, b), k)) -> NoKey(List.append(&1, P.Op, P.diff_one_pick(P.lookup(b, j), j, v), P.diff_source(t, b)), k):
  match be:
    case True{}:
      Empty.absurd(NoKey(List.append(&1, P.Op, P.diff_one_pick(P.lookup(b, j), j, v), P.diff_source(t, b)), k), false_ne_true(Equal.sym(Bool, True{}, False{}, h)))
    case False{}:
      no_key_append(P.diff_one_pick(P.lookup(b, j), j, v), P.diff_source(t, b), k, nk_one(P.lookup(b, j), j, v, k, e), ih(h))

# LEMMA: diff removes and replaces only keys of the source.
def nk_source(a: +List<P.Entry>, +b: +List<P.Entry>, +k: Nat, h: {Spec.has_key(a, k) == False{} : Bool}) -> NoKey(P.diff_source(a, b), k):
  match a:
    case Nil{}:
      Unit{}
    case Con{P.E{+j, +v}, +t}:
      nk_source_entry(Nat.is_eq(j, k), j, v, t, b, k, h, {==}, h2 => nk_source(t, b, k, h2))

def nk_added_entry(be: Bool, +j: Nat, +w: Nat, +t: +List<P.Entry>, +a: +List<P.Entry>, +k: Nat, h: {Bool.or(be, Spec.has_key(t, k)) == False{} : Bool}, +e: {Nat.is_eq(j, k) == be : Bool}, ih: @h2: {Spec.has_key(t, k) == False{} : Bool} -> NoKey(P.diff_added(t, a), k)) -> NoKey(List.append(&1, P.Op, P.diff_added_pick(P.lookup(a, j), j, w), P.diff_added(t, a)), k):
  match be:
    case True{}:
      Empty.absurd(NoKey(List.append(&1, P.Op, P.diff_added_pick(P.lookup(a, j), j, w), P.diff_added(t, a)), k), false_ne_true(Equal.sym(Bool, True{}, False{}, h)))
    case False{}:
      no_key_append(P.diff_added_pick(P.lookup(a, j), j, w), P.diff_added(t, a), k, nk_added_one(P.lookup(a, j), j, w, k, e), ih(h))

# LEMMA: diff adds only keys of the target.
def nk_added(b: +List<P.Entry>, +a: +List<P.Entry>, +k: Nat, h: {Spec.has_key(b, k) == False{} : Bool}) -> NoKey(P.diff_added(b, a), k):
  match b:
    case Nil{}:
      Unit{}
    case Con{P.E{+j, +w}, +t}:
      nk_added_entry(Nat.is_eq(j, k), j, w, t, a, k, h, {==}, h2 => nk_added(t, a, k, h2))

# LEMMA: a diff of two documents without k has no operation on k.
def nk_diff(+a: +List<P.Entry>, +b: +List<P.Entry>, +k: Nat, ha: {Spec.has_key(a, k) == False{} : Bool}, hb: {Spec.has_key(b, k) == False{} : Bool}) -> NoKey(P.diff(a, b), k):
  no_key_append(P.diff_source(a, b), P.diff_added(b, a), k, nk_source(a, b, k, ha), nk_added(b, a, k, hb))

# An entry whose document and patch lack k does not mention it.
def hm_one(+kind: Hs.HOp, +id: Nat, +v: Nat, +d: +List<P.Entry>, +p: +List<P.Op>, +k: Nat, hd: {Spec.has_key(d, k) == False{} : Bool}, hp: {Spec.ops_mention(p, k) == False{} : Bool}) -> {Spec.hist_mentions([Hs.H{kind, id, v, d, p}], k) == False{} : Bool}:
  %Equal.sym(Bool, Spec.has_key(d, k), False{}, hd) : {Bool.or(_, Bool.or(Spec.ops_mention(p, k), False{})) == False{} : Bool}
  %Equal.sym(Bool, Spec.ops_mention(p, k), False{}, hp) : {Bool.or(False{}, Bool.or(_, False{})) == False{} : Bool}
  {==}

def hm_cons(a: Bool, b: Bool, +rest: +List<Hs.Hist>, +h: Hs.Hist, +k: Nat, q: {Bool.or(a, Bool.or(b, Spec.hist_mentions(rest, k))) == False{} : Bool}, ih: @q2: {Spec.hist_mentions(rest, k) == False{} : Bool} -> {Spec.hist_mentions(Hs.append_hist(rest, h), k) == False{} : Bool}) -> {Bool.or(a, Bool.or(b, Spec.hist_mentions(Hs.append_hist(rest, h), k))) == False{} : Bool}:
  match a:
    case True{}:
      Empty.absurd({True{} == False{} : Bool}, false_ne_true(Equal.sym(Bool, True{}, False{}, q)))
    case False{}:
      match b:
        case True{}:
          Empty.absurd({True{} == False{} : Bool}, false_ne_true(Equal.sym(Bool, True{}, False{}, q)))
        case False{}:
          ih(q)

# LEMMA: appending an entry that does not mention k to a history that does not keeps it so.
def hm_append(hist: +List<Hs.Hist>, +h: Hs.Hist, +k: Nat, q: {Spec.hist_mentions(hist, k) == False{} : Bool}, hh: {Spec.hist_mentions([h], k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.append_hist(hist, h), k) == False{} : Bool}:
  match hist:
    case Nil{}:
      hh
    case Con{Hs.H{+kind, +id, +v, +d, +p}, +rest}:
      hm_cons(Spec.has_key(d, k), Spec.ops_mention(p, k), rest, h, k, q, q2 => hm_append(rest, h, k, q2, hh))

def hm_when(bw: Bool, +hist: +List<Hs.Hist>, +h: Hs.Hist, +k: Nat, q: {Spec.hist_mentions(hist, k) == False{} : Bool}, hh: {Spec.hist_mentions([h], k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.when_hist(bw, hist, h), k) == False{} : Bool}:
  match bw:
    case True{}:
      hm_append(hist, h, k, q, hh)
    case False{}:
      q

def onr_create(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, q: {Spec.hist_mentions(hist, k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.hist_of(Hs.create_pick(found, c, Hs.Omit{keys, i}, id, doc, store, hist, evs)), k) == False{} : Bool}:
  match found:
    case Some{old}:
      q
    case None{}:
      hm_when(Hs.cfg_history(c), hist, Hs.H{Hs.KCreate{}, id, 0n, Hs.strip(keys, doc), []}, k, q, hm_one(Hs.KCreate{}, id, 0n, Hs.strip(keys, doc), [], k, strip_lacks(keys, doc, k, m), {==}))

def onr_write(ops: +List<P.Op>, +c: Hs.Cfg, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +k: Nat, q: {Spec.hist_mentions(hist, k) == False{} : Bool}, hp: {Spec.ops_mention(ops, k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.hist_of(Hs.update_write(ops, c, f, id, old, doc, store, hist, evs)), k) == False{} : Bool}:
  match ops:
    case Nil{}:
      q
    case Con{+o, +os}:
      hm_when(Hs.writes(c, f), hist, Hs.H{Hs.KUpdate{}, id, Hs.next_version(Hs.top_version(hist, id)), [], o <> os}, k, q, hm_one(Hs.KUpdate{}, id, Hs.next_version(Hs.top_version(hist, id)), [], o <> os, k, {==}, hp))

def onr_omit(none: Bool, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, q: {Spec.hist_mentions(hist, k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.hist_of(Hs.update_omit(none, c, Hs.Omit{keys, i}, f, id, old, doc, store, hist, evs)), k) == False{} : Bool}:
  match none:
    case True{}:
      q
    case False{}:
      onr_write(Hs.ops_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc))), c, f, id, old, doc, store, hist, evs, k, q, no_key_mention(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc)), k, nk_diff(Hs.strip(keys, old), Hs.strip(keys, doc), k, strip_lacks(keys, old, k, m), strip_lacks(keys, doc, k, m))))

def onr_hook(skip: Bool, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, q: {Spec.hist_mentions(hist, k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.hist_of(Hs.update_hook(skip, c, Hs.Omit{keys, i}, f, id, old, doc, store, hist, evs)), k) == False{} : Bool}:
  match skip:
    case True{}:
      q
    case False{}:
      onr_omit(Hs.blank(Hs.Omit{keys, i}, old, doc), c, keys, i, f, id, old, doc, store, hist, evs, k, m, q)

def onr_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +f: Hs.Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, q: {Spec.hist_mentions(hist, k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.hist_of(Hs.update_pick(found, c, Hs.Omit{keys, i}, f, id, doc, store, hist, evs)), k) == False{} : Bool}:
  match found:
    case None{}:
      q
    case Some{+old}:
      onr_hook(Hs.skipped(f), c, keys, i, f, id, old, doc, store, hist, evs, k, m, q)

def onr_delete_hook(skip: Bool, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, q: {Spec.hist_mentions(hist, k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.hist_of(Hs.delete_hook(skip, c, Hs.Omit{keys, i}, f, id, old, store, hist, evs)), k) == False{} : Bool}:
  match skip:
    case True{}:
      q
    case False{}:
      hm_when(Hs.writes(c, f), hist, Hs.H{Hs.KDelete{}, id, 0n, Hs.strip(keys, old), []}, k, q, hm_one(Hs.KDelete{}, id, 0n, Hs.strip(keys, old), [], k, strip_lacks(keys, old, k, m), {==}))

def onr_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +keys: +List<Nat>, +i: Bool, +f: Hs.Flags, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +k: Nat, +m: {Hs.mem(keys, k) == True{} : Bool}, q: {Spec.hist_mentions(hist, k) == False{} : Bool}) -> {Spec.hist_mentions(Hs.hist_of(Hs.delete_pick(found, c, Hs.Omit{keys, i}, f, id, store, hist, evs)), k) == False{} : Bool}:
  match found:
    case None{}:
      q
    case Some{+old}:
      onr_delete_hook(Hs.skipped(f), c, keys, i, f, id, old, store, hist, evs, k, m, q)

def Laws.omitted_never_recorded(c, keys, i, store, hist, evs, cmd, k, m, q):
  match cmd:
    case Hs.Create{+id, +doc}:
      onr_create(Hs.find(store, id), c, keys, i, id, doc, store, hist, evs, k, m, q)
    case Hs.Update{+id, +doc, +f}:
      onr_update(Hs.find(store, id), c, keys, i, f, id, doc, store, hist, evs, k, m, q)
    case Hs.Delete{+id, +f}:
      onr_delete(Hs.find(store, id), c, keys, i, f, id, store, hist, evs, k, m, q)

# ---- replaying history gives the stored document ----

# LEMMA: replaying a history with one entry appended replays the history, then the entry.
def replay_append(hist: +List<Hs.Hist>, +kind: Hs.HOp, +hid: Nat, +v: Nat, +d: +List<P.Entry>, +p: +List<P.Op>, +id: Nat, acc: Maybe<+List<P.Entry>>) -> {Spec.replay_go(Hs.append_hist(hist, Hs.H{kind, hid, v, d, p}), id, acc) == Spec.replay_pick(Nat.is_eq(hid, id), Hs.H{kind, hid, v, d, p}, Spec.replay_go(hist, id, acc)) : Maybe<+List<P.Entry>>}:
  match hist:
    case Nil{}:
      {==}
    case Con{Hs.H{+k2, +hid2, +v2, +d2, +p2}, +rest}:
      replay_append(rest, kind, hid, v, d, p, id, Spec.replay_pick(Nat.is_eq(hid2, id), Hs.H{k2, hid2, v2, d2, p2}, acc))

def frs_entry(bb: Bool, +rid: Nat, +doc: +List<P.Entry>, +rest: +List<Hs.Rec>, +id: Nat, +q: {Nat.is_eq(rid, id) == bb : Bool}, ih: {Hs.find(Hs.remove(rest, id), id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}) -> {Hs.find(Hs.remove_pick(bb, Hs.R{rid, doc}, Hs.remove(rest, id)), id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}:
  match bb:
    case True{}:
      ih
    case False{}:
      %Equal.sym(Bool, Nat.is_eq(rid, id), False{}, q) : {Hs.find_pick(_, doc, Hs.find(Hs.remove(rest, id), id)) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
      ih

# LEMMA: a removed document is not found.
def find_remove_same(store: +List<Hs.Rec>, +id: Nat) -> {Hs.find(Hs.remove(store, id), id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}:
  match store:
    case Nil{}:
      {==}
    case Con{Hs.R{+rid, +doc}, +rest}:
      frs_entry(Nat.is_eq(rid, id), rid, doc, rest, id, {==}, find_remove_same(rest, id))

def fro_entry(bb: Bool, +rid: Nat, +doc: +List<P.Entry>, +rest: +List<Hs.Rec>, +a: Nat, +b: Nat, +ne: {Nat.is_eq(a, b) == False{} : Bool}, +q: {Nat.is_eq(rid, a) == bb : Bool}, ih: {Hs.find(Hs.remove(rest, a), b) == Hs.find(rest, b) : Maybe<+List<P.Entry>>}) -> {Hs.find(Hs.remove_pick(bb, Hs.R{rid, doc}, Hs.remove(rest, a)), b) == Hs.find_pick(Nat.is_eq(rid, b), doc, Hs.find(rest, b)) : Maybe<+List<P.Entry>>}:
  match bb:
    case True{}:
      %Equal.sym(Nat, rid, a, is_eq_true_eq(rid, a, q)) : {Hs.find(Hs.remove(rest, a), b) == Hs.find_pick(Nat.is_eq(_, b), doc, Hs.find(rest, b)) : Maybe<+List<P.Entry>>}
      %Equal.sym(Bool, Nat.is_eq(a, b), False{}, ne) : {Hs.find(Hs.remove(rest, a), b) == Hs.find_pick(_, doc, Hs.find(rest, b)) : Maybe<+List<P.Entry>>}
      ih
    case False{}:
      %ih : {Hs.find_pick(Nat.is_eq(rid, b), doc, Hs.find(Hs.remove(rest, a), b)) == Hs.find_pick(Nat.is_eq(rid, b), doc, _) : Maybe<+List<P.Entry>>}
      {==}

# LEMMA: removing one id leaves every other id's document as it is.
def find_remove_other(store: +List<Hs.Rec>, +a: Nat, +b: Nat, +ne: {Nat.is_eq(a, b) == False{} : Bool}) -> {Hs.find(Hs.remove(store, a), b) == Hs.find(store, b) : Maybe<+List<P.Entry>>}:
  match store:
    case Nil{}:
      {==}
    case Con{Hs.R{+rid, +doc}, +rest}:
      fro_entry(Nat.is_eq(rid, a), rid, doc, rest, a, b, ne, {==}, find_remove_other(rest, a, b, ne))

def ops_disc(l: +List<P.Op>) -> Type:
  match l:
    case Nil{}:
      Unit
    case Con{o, t}:
      Empty

# LEMMA: ops kept as data are empty only when the ops are.
def ops_data_nil(x: List<P.Op>, e: {{[] : +List<P.Op>} == Hs.ops_data(x) : +List<P.Op>}) -> {x == {[] : List<P.Op>} : List<P.Op>}:
  match x:
    case Nil{}:
      {==}
    case Con{o, t}:
      Empty.absurd({o <> t == {[] : List<P.Op>} : List<P.Op>}, (%e : ops_disc(_); Unit{}))

# LEMMA: ops kept as data and used once again are the ops.
def once_data(x: List<P.Op>) -> {Hs.ops_once(Hs.ops_data(x)) == x : List<P.Op>}:
  match x:
    case Nil{}:
      {==}
    case Con{+o, t}:
      %Equal.sym(List<P.Op>, Hs.ops_once(Hs.ops_data(t)), t, once_data(t)) : {o <> _ == o <> t : List<P.Op>}
      {==}

# A key the document lacks is also absent past the document's first entry.
def sln_tail(be: Bool, +v: Nat, +r: +List<P.Entry>, +k: Nat, n: {P.lookup_pick(be, v, P.lookup(r, k)) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(r, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}:
  match be:
    case True{}:
      Empty.absurd({P.lookup(r, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}, some_ne_none(v, n))
    case False{}:
      n

def sln_keep(be: Bool, +keys: +List<Nat>, +v: Nat, +r: +List<P.Entry>, +k: Nat, n: {P.lookup_pick(be, v, P.lookup(r, k)) == {None{} : Maybe<Nat>} : Maybe<Nat>}, ih: @n2: {P.lookup(r, k) == {None{} : Maybe<Nat>} : Maybe<Nat>} -> {P.lookup(Hs.strip(keys, r), k) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup_pick(be, v, P.lookup(Hs.strip(keys, r), k)) == {None{} : Maybe<Nat>} : Maybe<Nat>}:
  match be:
    case True{}:
      Empty.absurd({{Some{v} : Maybe<Nat>} == {None{} : Maybe<Nat>} : Maybe<Nat>}, some_ne_none(v, n))
    case False{}:
      ih(n)

def sln_entry(bm: Bool, +keys: +List<Nat>, +j: Nat, +v: Nat, +r: +List<P.Entry>, +k: Nat, n: {P.lookup_pick(Nat.is_eq(j, k), v, P.lookup(r, k)) == {None{} : Maybe<Nat>} : Maybe<Nat>}, ih: @n2: {P.lookup(r, k) == {None{} : Maybe<Nat>} : Maybe<Nat>} -> {P.lookup(Hs.strip(keys, r), k) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(Hs.strip_pick(bm, P.E{j, v}, Hs.strip(keys, r)), k) == {None{} : Maybe<Nat>} : Maybe<Nat>}:
  match bm:
    case True{}:
      ih(sln_tail(Nat.is_eq(j, k), v, r, k, n))
    case False{}:
      sln_keep(Nat.is_eq(j, k), keys, v, r, k, n, ih)

# LEMMA: stripping keys adds none: a key the document lacks, the stripped document lacks.
def strip_lookup_none(+keys: +List<Nat>, d: +List<P.Entry>, +k: Nat, n: {P.lookup(d, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}) -> {P.lookup(Hs.strip(keys, d), k) == {None{} : Maybe<Nat>} : Maybe<Nat>}:
  match d:
    case Nil{}:
      {==}
    case Con{P.E{+j, +v}, +r}:
      sln_entry(Hs.mem(keys, j), keys, j, v, r, k, n, n2 => strip_lookup_none(keys, r, k, n2))

def sd_entry(bm: Bool, +keys: +List<Nat>, +k: Nat, +v: Nat, +t: +List<P.Entry>, n: {P.lookup(t, k) == {None{} : Maybe<Nat>} : Maybe<Nat>}, ih: Spec.Distinct(Hs.strip(keys, t))) -> Spec.Distinct(Hs.strip_pick(bm, P.E{k, v}, Hs.strip(keys, t))):
  match bm:
    case True{}:
      ih
    case False{}:
      (strip_lookup_none(keys, t, k, n), ih)

# LEMMA: a document with distinct keys keeps them distinct once stripped.
def strip_distinct(+keys: +List<Nat>, d: +List<P.Entry>, dd: Spec.Distinct(d)) -> Spec.Distinct(Hs.strip(keys, d)):
  match d:
    case Nil{}:
      Unit{}
    case Con{P.E{+k, +v}, +t}:
      (n, dt) = dd
      sd_entry(Hs.mem(keys, k), keys, k, v, t, n, strip_distinct(keys, t, dt))

# LEMMA: stripping no keys leaves the document.
def strip_nil(d: +List<P.Entry>) -> {Hs.strip([], d) == d : +List<P.Entry>}:
  match d:
    case Nil{}:
      {==}
    case Con{P.E{+k, +v}, +t}:
      %Equal.sym(+List<P.Entry>, Hs.strip([], t), t, strip_nil(t)) : {P.E{k, v} <> _ == P.E{k, v} <> t : +List<P.Entry>}
      {==}

def doc_strip_nil(m: Maybe<+List<P.Entry>>, +j: Nat) -> {Spec.doc_lookup(Spec.doc_strip([], m), j) == Spec.doc_lookup(m, j) : Maybe<Maybe<Nat>>}:
  match m:
    case None{}:
      {==}
    case Some{+d}:
      %strip_nil(d) : {Spec.doc_lookup(Spec.doc_strip([], Some{d}), j) == Spec.doc_lookup(Some{_}, j) : Maybe<Maybe<Nat>>}
      {==}

# Commands with no switch set carry the flags that are all off.
def flags_off(f: Hs.Flags, nsw: Spec.T(Spec.switches_off(f))) -> {f == Hs.Flags{False{}, False{}, False{}} : Hs.Flags}:
  match f:
    case Hs.Flags{True{}, e, h}:
      Empty.absurd({Hs.Flags{True{}, e, h} == Hs.Flags{False{}, False{}, False{}} : Hs.Flags}, nsw)
    case Hs.Flags{False{}, True{}, h}:
      Empty.absurd({Hs.Flags{False{}, True{}, h} == Hs.Flags{False{}, False{}, False{}} : Hs.Flags}, nsw)
    case Hs.Flags{False{}, False{}, True{}}:
      Empty.absurd({Hs.Flags{False{}, False{}, True{}} == Hs.Flags{False{}, False{}, False{}} : Hs.Flags}, nsw)
    case Hs.Flags{False{}, False{}, False{}}:
      {==}

def mm_disc(m: Maybe<Maybe<Nat>>) -> Type:
  match m:
    case None{}:
      Unit
    case Some{x}:
      Empty

def unsome(m: Maybe<Maybe<Nat>>) -> Maybe<Nat>:
  match m:
    case None{}:
      None{}
    case Some{x}:
      x

# For one id and key: replaying the history reads the key as the stored document stripped of the omitted keys does.
def Inv(+keys: +List<Nat>, +id: Nat, +j: Nat, +st: Hs.State) -> Type:
  {Spec.doc_lookup(Spec.replay(Hs.hist_of(st), id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(Hs.store_of(st), id)), j) : Maybe<Maybe<Nat>>}

# rp_create, on the created id or another.
def rp_create_at(bb: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +cid: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> {Spec.doc_lookup(Spec.replay_pick(bb, Hs.H{Hs.KCreate{}, cid, 0n, Hs.strip(keys, doc), {[] : +List<P.Op>}}, Spec.replay(hist, id)), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find_pick(bb, doc, Hs.find(store, id))), j) : Maybe<Maybe<Nat>>}:
  match bb:
    case True{}:
      {==}
    case False{}:
      inv

def rp_create(found: Maybe<+List<P.Entry>>, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +cid: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> Inv(keys, id, j, Hs.create_pick(found, Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, cid, doc, store, hist, evs)):
  match found:
    case Some{old}:
      inv
    case None{}:
      %Equal.sym(Maybe<+List<P.Entry>>, Spec.replay_go(Hs.append_hist(hist, Hs.H{Hs.KCreate{}, cid, 0n, Hs.strip(keys, doc), {[] : +List<P.Op>}}), id, None{}), Spec.replay_pick(Nat.is_eq(cid, id), Hs.H{Hs.KCreate{}, cid, 0n, Hs.strip(keys, doc), {[] : +List<P.Op>}}, Spec.replay_go(hist, id, None{})), replay_append(hist, Hs.KCreate{}, cid, 0n, Hs.strip(keys, doc), {[] : +List<P.Op>}, id, None{})) : {Spec.doc_lookup(_, j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(Hs.R{cid, doc} <> store, id)), j) : Maybe<Maybe<Nat>>}
      rp_create_at(Nat.is_eq(cid, id), keys, id, j, cid, doc, store, hist, inv)

# rp_write with an empty patch, on the updated id or another: the omitted documents agree at j.
def rp_same_at(bb: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +uid: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +q: {Nat.is_eq(uid, id) == bb : Bool}, +e: {Hs.find(store, uid) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}, +same: {P.lookup(Hs.strip(keys, old), j) == P.lookup(Hs.strip(keys, doc), j) : Maybe<Nat>}, inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find_pick(bb, doc, Hs.find(Hs.remove(store, uid), id))), j) : Maybe<Maybe<Nat>>}:
  match bb:
    case True{}:
      +kj = is_eq_true_eq(uid, id, q)
      +eid = {(%kj : {Hs.find(store, _) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}; e) : {Hs.find(store, id) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}}
      inv2 = {(%eid : {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, _), j) : Maybe<Maybe<Nat>>}; inv) : {Spec.doc_lookup(Spec.replay(hist, id), j) == {Some{P.lookup(Hs.strip(keys, old), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}}
      %same : {Spec.doc_lookup(Spec.replay(hist, id), j) == {Some{_} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}
      inv2
    case False{}:
      %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(Hs.remove(store, uid), id), Hs.find(store, id), find_remove_other(store, uid, id, q)) : {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, _), j) : Maybe<Maybe<Nat>>}
      inv

# rp_write with a patch, on the updated id, once the replay so far is known.
def rp_patch_acc(acc: Maybe<+List<P.Entry>>, +keys: +List<Nat>, +j: Nat, +uid: Nat, +ver: Nat, +op: P.Op, +os: +List<P.Op>, +old: +List<P.Entry>, +doc: +List<P.Entry>, +eo: {op <> os == Hs.ops_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc))) : +List<P.Op>}, ds_: Spec.Distinct(Hs.strip(keys, doc)), inv2: {Spec.doc_lookup(acc, j) == {Some{P.lookup(Hs.strip(keys, old), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}) -> {Spec.doc_lookup(Spec.replay_pick(True{}, Hs.H{Hs.KUpdate{}, uid, ver, {[] : +List<P.Entry>}, op <> os}, acc), j) == {Some{P.lookup(Hs.strip(keys, doc), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}:
  match acc:
    case None{}:
      Empty.absurd({{None{} : Maybe<Maybe<Nat>>} == {Some{P.lookup(Hs.strip(keys, doc), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}, (%inv2 : mm_disc(_); Unit{}))
    case Some{+cur}:
      +hcur = {Equal.cong(Maybe<Maybe<Nat>>, Maybe<Nat>, m => unsome(m), Some{P.lookup(cur, j)}, Some{P.lookup(Hs.strip(keys, old), j)}, inv2) : {P.lookup(cur, j) == P.lookup(Hs.strip(keys, old), j) : Maybe<Nat>}}
      %Equal.sym(+List<P.Op>, op <> os, Hs.ops_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc))), eo) : {{Some{P.lookup(P.apply(Hs.ops_once(_), cur), j)} : Maybe<Maybe<Nat>>} == {Some{P.lookup(Hs.strip(keys, doc), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}
      %Equal.sym(List<P.Op>, Hs.ops_once(Hs.ops_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc)))), P.diff(Hs.strip(keys, old), Hs.strip(keys, doc)), once_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc)))) : {{Some{P.lookup(P.apply(_, cur), j)} : Maybe<Maybe<Nat>>} == {Some{P.lookup(Hs.strip(keys, doc), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}
      %Equal.sym(Maybe<Nat>, P.lookup(P.apply(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc)), cur), j), P.lookup(Hs.strip(keys, doc), j), roundtrip_d(Hs.strip(keys, old), Hs.strip(keys, doc), cur, ds_, j, hcur)) : {{Some{_} : Maybe<Maybe<Nat>>} == {Some{P.lookup(Hs.strip(keys, doc), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}
      {==}

# rp_write with a patch, on the updated id or another.
def rp_patch_at(bb: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +uid: Nat, +ver: Nat, +op: P.Op, +os: +List<P.Op>, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +q: {Nat.is_eq(uid, id) == bb : Bool}, +e: {Hs.find(store, uid) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}, +eo: {op <> os == Hs.ops_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc))) : +List<P.Op>}, ds_: Spec.Distinct(Hs.strip(keys, doc)), inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> {Spec.doc_lookup(Spec.replay_pick(bb, Hs.H{Hs.KUpdate{}, uid, ver, {[] : +List<P.Entry>}, op <> os}, Spec.replay(hist, id)), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find_pick(bb, doc, Hs.find(Hs.remove(store, uid), id))), j) : Maybe<Maybe<Nat>>}:
  match bb:
    case True{}:
      +kj = is_eq_true_eq(uid, id, q)
      +eid = {(%kj : {Hs.find(store, _) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}; e) : {Hs.find(store, id) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}}
      inv2 = {(%eid : {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, _), j) : Maybe<Maybe<Nat>>}; inv) : {Spec.doc_lookup(Spec.replay(hist, id), j) == {Some{P.lookup(Hs.strip(keys, old), j)} : Maybe<Maybe<Nat>>} : Maybe<Maybe<Nat>>}}
      rp_patch_acc(Spec.replay(hist, id), keys, j, uid, ver, op, os, old, doc, eo, ds_, inv2)
    case False{}:
      %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(Hs.remove(store, uid), id), Hs.find(store, id), find_remove_other(store, uid, id, q)) : {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, _), j) : Maybe<Maybe<Nat>>}
      inv

def rp_write(ops: +List<P.Op>, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +uid: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +eo: {ops == Hs.ops_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc))) : +List<P.Op>}, +e: {Hs.find(store, uid) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}, ds_: Spec.Distinct(Hs.strip(keys, doc)), inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> Inv(keys, id, j, Hs.update_write(ops, Hs.Cfg{True{}, ev}, Hs.Flags{False{}, False{}, False{}}, uid, old, doc, store, hist, evs)):
  match ops:
    case Nil{}:
      +dz = ops_data_nil(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc)), eo)
      +same = {(%dz : {P.lookup(P.apply(_, Hs.strip(keys, old)), j) == P.lookup(Hs.strip(keys, doc), j) : Maybe<Nat>}; roundtrip_d(Hs.strip(keys, old), Hs.strip(keys, doc), Hs.strip(keys, old), ds_, j, {==})) : {P.lookup(Hs.strip(keys, old), j) == P.lookup(Hs.strip(keys, doc), j) : Maybe<Nat>}}
      rp_same_at(Nat.is_eq(uid, id), keys, id, j, uid, old, doc, store, hist, {==}, e, same, inv)
    case Con{+op, +os}:
      %Equal.sym(Maybe<+List<P.Entry>>, Spec.replay_go(Hs.append_hist(hist, Hs.H{Hs.KUpdate{}, uid, Hs.next_version(Hs.top_version(hist, uid)), {[] : +List<P.Entry>}, op <> os}), id, None{}), Spec.replay_pick(Nat.is_eq(uid, id), Hs.H{Hs.KUpdate{}, uid, Hs.next_version(Hs.top_version(hist, uid)), {[] : +List<P.Entry>}, op <> os}, Spec.replay_go(hist, id, None{})), replay_append(hist, Hs.KUpdate{}, uid, Hs.next_version(Hs.top_version(hist, uid)), {[] : +List<P.Entry>}, op <> os, id, None{})) : {Spec.doc_lookup(_, j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(Hs.R{uid, doc} <> Hs.remove(store, uid), id)), j) : Maybe<Maybe<Nat>>}
      rp_patch_at(Nat.is_eq(uid, id), keys, id, j, uid, Hs.next_version(Hs.top_version(hist, uid)), op, os, old, doc, store, hist, {==}, e, eo, ds_, inv)

def rp_update(found: Maybe<+List<P.Entry>>, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +uid: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, +e: {Hs.find(store, uid) == found : Maybe<+List<P.Entry>>}, dd: Spec.Distinct(doc), inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> Inv(keys, id, j, Hs.update_pick(found, Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, Hs.Flags{False{}, False{}, False{}}, uid, doc, store, hist, evs)):
  match found:
    case None{}:
      inv
    case Some{+old}:
      rp_write(Hs.ops_data(P.diff(Hs.strip(keys, old), Hs.strip(keys, doc))), ev, keys, id, j, uid, old, doc, store, hist, evs, {==}, e, strip_distinct(keys, doc, dd), inv)

# rp_delete, on the deleted id or another.
def rp_delete_at(bb: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +did: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +q: {Nat.is_eq(did, id) == bb : Bool}, inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> {Spec.doc_lookup(Spec.replay_pick(bb, Hs.H{Hs.KDelete{}, did, 0n, Hs.strip(keys, old), {[] : +List<P.Op>}}, Spec.replay(hist, id)), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(Hs.remove(store, did), id)), j) : Maybe<Maybe<Nat>>}:
  match bb:
    case True{}:
      +gone = {(%is_eq_true_eq(did, id, q) : {Hs.find(Hs.remove(store, did), _) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}; find_remove_same(store, did)) : {Hs.find(Hs.remove(store, did), id) == {None{} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}}
      %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(Hs.remove(store, did), id), None{}, gone) : {{None{} : Maybe<Maybe<Nat>>} == Spec.doc_lookup(Spec.doc_strip(keys, _), j) : Maybe<Maybe<Nat>>}
      {==}
    case False{}:
      %Equal.sym(Maybe<+List<P.Entry>>, Hs.find(Hs.remove(store, did), id), Hs.find(store, id), find_remove_other(store, did, id, q)) : {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, _), j) : Maybe<Maybe<Nat>>}
      inv

def rp_delete(found: Maybe<+List<P.Entry>>, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +did: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, inv: {Spec.doc_lookup(Spec.replay(hist, id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(store, id)), j) : Maybe<Maybe<Nat>>}) -> Inv(keys, id, j, Hs.delete_pick(found, Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, Hs.Flags{False{}, False{}, False{}}, did, store, hist, evs)):
  match found:
    case None{}:
      inv
    case Some{+old}:
      %Equal.sym(Maybe<+List<P.Entry>>, Spec.replay_go(Hs.append_hist(hist, Hs.H{Hs.KDelete{}, did, 0n, Hs.strip(keys, old), {[] : +List<P.Op>}}), id, None{}), Spec.replay_pick(Nat.is_eq(did, id), Hs.H{Hs.KDelete{}, did, 0n, Hs.strip(keys, old), {[] : +List<P.Op>}}, Spec.replay_go(hist, id, None{})), replay_append(hist, Hs.KDelete{}, did, 0n, Hs.strip(keys, old), {[] : +List<P.Op>}, id, None{})) : {Spec.doc_lookup(_, j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(Hs.remove(store, did), id)), j) : Maybe<Maybe<Nat>>}
      rp_delete_at(Nat.is_eq(did, id), keys, id, j, did, old, store, hist, {==}, inv)

def rp_create_st(st: Hs.State, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +cid: Nat, +doc: +List<P.Entry>, inv: Inv(keys, id, j, st)) -> Inv(keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, st, Hs.Create{cid, doc})):
  match st:
    case Hs.S{+store, +hist, +evs}:
      rp_create(Hs.find(store, cid), ev, keys, id, j, cid, doc, store, hist, evs, inv)

def rp_update_st(st: Hs.State, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +uid: Nat, +doc: +List<P.Entry>, +f: Hs.Flags, nsw: Spec.T(Spec.switches_off(f)), dd: Spec.Distinct(doc), inv: Inv(keys, id, j, st)) -> Inv(keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, st, Hs.Update{uid, doc, f})):
  match st:
    case Hs.S{+store, +hist, +evs}:
      %Equal.sym(Hs.Flags, f, Hs.Flags{False{}, False{}, False{}}, flags_off(f, nsw)) : Inv(keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, Hs.S{store, hist, evs}, Hs.Update{uid, doc, _}))
      rp_update(Hs.find(store, uid), ev, keys, id, j, uid, doc, store, hist, evs, {==}, dd, inv)

def rp_delete_st(st: Hs.State, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +did: Nat, +f: Hs.Flags, nsw: Spec.T(Spec.switches_off(f)), inv: Inv(keys, id, j, st)) -> Inv(keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, st, Hs.Delete{did, f})):
  match st:
    case Hs.S{+store, +hist, +evs}:
      %Equal.sym(Hs.Flags, f, Hs.Flags{False{}, False{}, False{}}, flags_off(f, nsw)) : Inv(keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, Hs.S{store, hist, evs}, Hs.Delete{did, _}))
      rp_delete(Hs.find(store, did), ev, keys, id, j, did, store, hist, evs, inv)

# LEMMA: every command with distinct keys and no switch keeps the replay agreeing with the store at
# one id and key.
def rp_run(cmds: List<Hs.Cmd>, +ev: Bool, +keys: +List<Nat>, +id: Nat, +j: Nat, +st: Hs.State, inv: Inv(keys, id, j, st), dc: Spec.AllDistinct(cmds), nf: Spec.NoSwitches(cmds)) -> Inv(keys, id, j, Hs.run_with(cmds, Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, st)):
  match cmds:
    case Nil{}:
      inv
    case Con{Hs.Create{+cid, +doc}, cs}:
      (dd, dcs) = dc
      rp_run(cs, ev, keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, st, Hs.Create{cid, doc}), rp_create_st(st, ev, keys, id, j, cid, doc, inv), dcs, nf)
    case Con{Hs.Update{+uid, +doc, +f}, cs}:
      (dd, dcs) = dc
      (nsw, nfs) = nf
      rp_run(cs, ev, keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, st, Hs.Update{uid, doc, f}), rp_update_st(st, ev, keys, id, j, uid, doc, f, nsw, dd, inv), dcs, nfs)
    case Con{Hs.Delete{+did, +f}, cs}:
      (nsw, nfs) = nf
      rp_run(cs, ev, keys, id, j, Hs.step_with(Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, st, Hs.Delete{did, f}), rp_delete_st(st, ev, keys, id, j, did, f, nsw, inv), dc, nfs)

def Laws.replay_matches_omitted_store(cmds, dc, nf, ev, keys, id, j):
  rp_run(cmds, ev, keys, id, j, Hs.empty(), {==}, dc, nf)

# For one id and key, with nothing omitted: replaying the history reads the key as the stored document does.
def Inv0(+id: Nat, +j: Nat, +st: Hs.State) -> Type:
  {Spec.doc_lookup(Spec.replay(Hs.hist_of(st), id), j) == Spec.doc_lookup(Hs.find(Hs.store_of(st), id), j) : Maybe<Maybe<Nat>>}

# rp_run with nothing omitted, ending on the stored document itself.
def rp_run0(cmds: List<Hs.Cmd>, +ev: Bool, +id: Nat, +j: Nat, +st: Hs.State, inv: Inv([], id, j, st), dc: Spec.AllDistinct(cmds), nf: Spec.NoSwitches(cmds)) -> Inv0(id, j, Hs.run(cmds, Hs.Cfg{True{}, ev}, st)):
  match cmds:
    case Nil{}:
      Equal.trans(Maybe<Maybe<Nat>>, Spec.doc_lookup(Spec.replay(Hs.hist_of(st), id), j), Spec.doc_lookup(Spec.doc_strip([], Hs.find(Hs.store_of(st), id)), j), Spec.doc_lookup(Hs.find(Hs.store_of(st), id), j), inv, doc_strip_nil(Hs.find(Hs.store_of(st), id), j))
    case Con{Hs.Create{+cid, +doc}, cs}:
      (dd, dcs) = dc
      rp_run0(cs, ev, id, j, Hs.step(Hs.Cfg{True{}, ev}, st, Hs.Create{cid, doc}), rp_create_st(st, ev, [], id, j, cid, doc, inv), dcs, nf)
    case Con{Hs.Update{+uid, +doc, +f}, cs}:
      (dd, dcs) = dc
      (nsw, nfs) = nf
      rp_run0(cs, ev, id, j, Hs.step(Hs.Cfg{True{}, ev}, st, Hs.Update{uid, doc, f}), rp_update_st(st, ev, [], id, j, uid, doc, f, nsw, dd, inv), dcs, nfs)
    case Con{Hs.Delete{+did, +f}, cs}:
      (nsw, nfs) = nf
      rp_run0(cs, ev, id, j, Hs.step(Hs.Cfg{True{}, ev}, st, Hs.Delete{did, f}), rp_delete_st(st, ev, [], id, j, did, f, nsw, inv), dc, nfs)

def Laws.replay_matches_store(cmds, dc, nf, ev, id, j):
  rp_run0(cmds, ev, id, j, Hs.empty(), {==}, dc, nf)

def Laws.store_independent(cmds, c, st):
  match cmds st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+cmd, cs} Hs.S{+store, +hist, +evs}:
      %Equal.sym(+List<Hs.Rec>, Hs.store_of(Hs.run(cs, c, Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))), Spec.store_run(cs, Hs.store_of(Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))), Laws.store_independent(cs, c, Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))) : {_ == Spec.store_run(Con{cmd, cs}, store) : +List<Hs.Rec>}
      %Equal.sym(+List<Hs.Rec>, Hs.store_of(Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)), Spec.store_step(store, cmd), store_step_independent(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)) : {Spec.store_run(cs, _) == Spec.store_run(Con{cmd, cs}, store) : +List<Hs.Rec>}
      {==}

# ---- versions rise ----

# LEMMA: both sides of an and hold when it does.
law vr_and_left:
  for a: Bool
  for b: Bool
  for e: {Bool.and(a, b) == True{} : Bool}
  {a == True{} : Bool}
def vr_and_left(a, b, e):
  match a:
    case True{}:
      {==}
    case False{}:
      Empty.absurd({False{} == True{} : Bool}, false_ne_true(e))

law vr_and_right:
  for a: Bool
  for b: Bool
  for e: {Bool.and(a, b) == True{} : Bool}
  {b == True{} : Bool}
def vr_and_right(a, b, e):
  match a:
    case True{}:
      e
    case False{}:
      Empty.absurd({b == True{} : Bool}, false_ne_true(e))

# LEMMA: an and holds when both sides do.
law vr_and_both:
  for a: Bool
  for b: Bool
  for ea: {a == True{} : Bool}
  for eb: {b == True{} : Bool}
  {Bool.and(a, b) == True{} : Bool}
def vr_and_both(a, b, ea, eb):
  match a:
    case True{}:
      eb
    case False{}:
      Empty.absurd({Bool.and(False{}, b) == True{} : Bool}, false_ne_true(ea))

# LEMMA: every number is at most itself.
law vr_le_refl:
  for a: Nat
  {Nat.is_le(a, a) == True{} : Bool}
def vr_le_refl(a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      vr_le_refl(p)

# LEMMA: zero is at most every number.
law vr_le_zero:
  for a: Nat
  {Nat.is_le(0n, a) == True{} : Bool}
def vr_le_zero(a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

# LEMMA: a number at most b is below 1 + b.
law vr_lt_succ:
  for a: Nat
  for b: Nat
  for e: {Nat.is_le(a, b) == True{} : Bool}
  {Nat.is_lt(a, 1n+b) == True{} : Bool}
def vr_lt_succ(a, b, e):
  match a b:
    case 0n b:
      {==}
    case 1n+ap 0n:
      Empty.absurd({Nat.is_lt(1n+ap, 1n) == True{} : Bool}, false_ne_true(e))
    case 1n+ap 1n+bp:
      vr_lt_succ(ap, bp, e)

# LEMMA: below b and b at most c is below c.
law vr_lt_le:
  for a: Nat
  for b: Nat
  for c: Nat
  for ab: {Nat.is_lt(a, b) == True{} : Bool}
  for bc: {Nat.is_le(b, c) == True{} : Bool}
  {Nat.is_lt(a, c) == True{} : Bool}
def vr_lt_le(a, b, c, ab, bc):
  match a b c:
    case 0n 0n c:
      Empty.absurd({Nat.is_lt(0n, c) == True{} : Bool}, false_ne_true(ab))
    case 1n+ap 0n c:
      Empty.absurd({Nat.is_lt(1n+ap, c) == True{} : Bool}, false_ne_true(ab))
    case 0n 1n+bp 0n:
      Empty.absurd({Nat.is_lt(0n, 0n) == True{} : Bool}, false_ne_true(bc))
    case 0n 1n+bp 1n+cp:
      {==}
    case 1n+ap 1n+bp 0n:
      Empty.absurd({Nat.is_lt(1n+ap, 0n) == True{} : Bool}, false_ne_true(bc))
    case 1n+ap 1n+bp 1n+cp:
      vr_lt_le(ap, bp, cp, ab, bc)

# LEMMA: the history's max is at least its first argument.
law vr_max_l:
  for a: Nat
  for b: Nat
  {Nat.is_le(a, Hs.max(a, b)) == True{} : Bool}
def vr_max_l(a, b):
  match a b:
    case 0n b:
      vr_le_zero(b)
    case 1n+ap 0n:
      vr_le_refl(ap)
    case 1n+ap 1n+bp:
      vr_max_l(ap, bp)

# LEMMA: the history's max is at least its second argument.
law vr_max_r:
  for a: Nat
  for b: Nat
  {Nat.is_le(b, Hs.max(a, b)) == True{} : Bool}
def vr_max_r(a, b):
  match a b:
    case 0n b:
      vr_le_refl(b)
    case 1n+ap 0n:
      {==}
    case 1n+ap 1n+bp:
      vr_max_r(ap, bp)

# below_mono, one entry: a version below v is below any u at least v.
def vr_entry_mono(b: Bool, +w: Nat, +v: Nat, +u: Nat, e: {Bool.or(Bool.not(b), Nat.is_lt(w, v)) == True{} : Bool}, hl: {Nat.is_le(v, u) == True{} : Bool}) -> {Bool.or(Bool.not(b), Nat.is_lt(w, u)) == True{} : Bool}:
  match b:
    case True{}:
      vr_lt_le(w, v, u, e, hl)
    case False{}:
      {==}

# LEMMA: versions below v are below any u at least v.
law vr_below_mono:
  for +hist: +List<Hs.Hist>
  for +id: Nat
  for +v: Nat
  for +u: Nat
  for +hb: {Spec.below(hist, id, v) == True{} : Bool}
  for +hl: {Nat.is_le(v, u) == True{} : Bool}
  {Spec.below(hist, id, u) == True{} : Bool}
def vr_below_mono(hist, id, v, u, hb, hl):
  match hist:
    case Nil{}:
      {==}
    case Con{Hs.H{k, +hid, +w, d, p}, +rest}:
      vr_and_both(Bool.or(Bool.not(Nat.is_eq(hid, id)), Nat.is_lt(w, u)), Spec.below(rest, id, u), vr_entry_mono(Nat.is_eq(hid, id), w, v, u, vr_and_left(Bool.or(Bool.not(Nat.is_eq(hid, id)), Nat.is_lt(w, v)), Spec.below(rest, id, v), hb), hl), vr_below_mono(rest, id, v, u, vr_and_right(Bool.or(Bool.not(Nat.is_eq(hid, id)), Nat.is_lt(w, v)), Spec.below(rest, id, v), hb), hl))

# below_top, one entry: split on whether it is the id's and on the rest's highest version.
def vr_top_cons(b: Bool, t: Maybe<Nat>, +w: Nat, +rest: +List<Hs.Hist>, +id: Nat, ih: {Spec.below(rest, id, Hs.next_version(t)) == True{} : Bool}) -> {Bool.and(Bool.or(Bool.not(b), Nat.is_lt(w, Hs.next_version(Hs.top_pick(b, w, t)))), Spec.below(rest, id, Hs.next_version(Hs.top_pick(b, w, t)))) == True{} : Bool}:
  match b t:
    case False{} None{}:
      ih
    case False{} Some{u}:
      ih
    case True{} None{}:
      vr_and_both(Nat.is_lt(w, 1n+w), Spec.below(rest, id, 1n+w), vr_lt_succ(w, w, vr_le_refl(w)), vr_below_mono(rest, id, 0n, 1n+w, ih, vr_le_zero(1n+w)))
    case True{} Some{+u}:
      vr_and_both(Nat.is_lt(w, 1n+Hs.max(w, u)), Spec.below(rest, id, 1n+Hs.max(w, u)), vr_lt_succ(w, Hs.max(w, u), vr_max_l(w, u)), vr_below_mono(rest, id, 1n+u, 1n+Hs.max(w, u), ih, vr_max_r(w, u)))

# LEMMA: every version of an id is below the next version the history gives it.
law vr_below_top:
  for +hist: +List<Hs.Hist>
  for +id: Nat
  {Spec.below(hist, id, Hs.next_version(Hs.top_version(hist, id))) == True{} : Bool}
def vr_below_top(hist, id):
  match hist:
    case Nil{}:
      {==}
    case Con{Hs.H{k, +hid, +w, d, p}, +rest}:
      vr_top_cons(Nat.is_eq(hid, id), Hs.top_version(rest, id), w, rest, id, vr_below_top(rest, id))

# LEMMA: appending nothing to a history leaves it.
law vr_append_nil:
  for +xs: +List<Hs.Hist>
  {List.append(&2, Hs.Hist, xs, []) == xs : +List<Hs.Hist>}
def vr_append_nil(xs):
  match xs:
    case Nil{}:
      {==}
    case Con{+h, +t}:
      %vr_append_nil(t) : {h <> List.append(&2, Hs.Hist, t, []) == h <> _ : +List<Hs.Hist>}
      {==}

# LEMMA: appending histories is associative.
law vr_append_assoc:
  for +xs: +List<Hs.Hist>
  for +ys: +List<Hs.Hist>
  for +zs: +List<Hs.Hist>
  {List.append(&2, Hs.Hist, List.append(&2, Hs.Hist, xs, ys), zs) == List.append(&2, Hs.Hist, xs, List.append(&2, Hs.Hist, ys, zs)) : +List<Hs.Hist>}
def vr_append_assoc(xs, ys, zs):
  match xs:
    case Nil{}:
      {==}
    case Con{+h, +t}:
      %vr_append_assoc(t, ys, zs) : {h <> List.append(&2, Hs.Hist, List.append(&2, Hs.Hist, t, ys), zs) == h <> _ : +List<Hs.Hist>}
      {==}

# An entry checked against p followed by nothing is checked against p.
def vr_entry_nil(+h: Hs.Hist, +p: +List<Hs.Hist>, hh: {Spec.rise_entry(h, List.append(&2, Hs.Hist, p, [])) == True{} : Bool}) -> {Spec.rise_entry(h, p) == True{} : Bool}:
  %vr_append_nil(p) : {Spec.rise_entry(h, _) == True{} : Bool}
  hh

# An entry checked against p, x, t is checked against (p, x) followed by t.
def vr_entry_shift(+h: Hs.Hist, +p: +List<Hs.Hist>, +x: Hs.Hist, +t: +List<Hs.Hist>, hh: {Spec.rise_entry(h, List.append(&2, Hs.Hist, p, x <> t)) == True{} : Bool}) -> {Spec.rise_entry(h, List.append(&2, Hs.Hist, List.append(&2, Hs.Hist, p, [x]), t)) == True{} : Bool}:
  %Equal.sym(+List<Hs.Hist>, List.append(&2, Hs.Hist, List.append(&2, Hs.Hist, p, [x]), t), List.append(&2, Hs.Hist, p, x <> t), vr_append_assoc(p, [x], t)) : {Spec.rise_entry(h, _) == True{} : Bool}
  hh

# LEMMA: a history that rises still rises with one more entry that rises over all before it.
law vr_rise_snoc:
  for +xs: +List<Hs.Hist>
  for +p: +List<Hs.Hist>
  for +h: Hs.Hist
  for +hx: {Spec.rise_go(xs, p) == True{} : Bool}
  for hh: {Spec.rise_entry(h, List.append(&2, Hs.Hist, p, xs)) == True{} : Bool}
  {Spec.rise_go(List.append(&2, Hs.Hist, xs, [h]), p) == True{} : Bool}
def vr_rise_snoc(xs, p, h, hx, hh):
  match xs:
    case Nil{}:
      vr_and_both(Spec.rise_entry(h, p), True{}, vr_entry_nil(h, p, hh), {==})
    case Con{+x, +t}:
      vr_and_both(Spec.rise_entry(x, p), Spec.rise_go(List.append(&2, Hs.Hist, t, [h]), List.append(&2, Hs.Hist, p, [x])), vr_and_left(Spec.rise_entry(x, p), Spec.rise_go(t, List.append(&2, Hs.Hist, p, [x])), hx), vr_rise_snoc(t, List.append(&2, Hs.Hist, p, [x]), h, vr_and_right(Spec.rise_entry(x, p), Spec.rise_go(t, List.append(&2, Hs.Hist, p, [x])), hx), vr_entry_shift(h, p, x, t, hh)))

# An entry that rises over the history keeps it rising, whether it is written or not.
def vr_when(b: Bool, +hist: +List<Hs.Hist>, +h: Hs.Hist, ok: {Spec.versions_rise(hist) == True{} : Bool}, he: {Spec.rise_entry(h, hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.when_hist(b, hist, h)) == True{} : Bool}:
  match b:
    case True{}:
      vr_rise_snoc(hist, [], h, ok, he)
    case False{}:
      ok

def vr_create(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.create_pick(found, c, o, id, doc, store, hist, evs))) == True{} : Bool}:
  match found:
    case Some{old}:
      ok
    case None{}:
      vr_when(Hs.cfg_history(c), hist, Hs.H{Hs.KCreate{}, id, 0n, Hs.strip(Hs.omit_keys(o), doc), []}, ok, {==})

def vr_write(ops: +List<P.Op>, +c: Hs.Cfg, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.update_write(ops, c, f, id, old, doc, store, hist, evs))) == True{} : Bool}:
  match ops:
    case Nil{}:
      ok
    case Con{+o, +os}:
      vr_when(Hs.writes(c, f), hist, Hs.H{Hs.KUpdate{}, id, Hs.next_version(Hs.top_version(hist, id)), [], o <> os}, ok, vr_below_top(hist, id))

def vr_omit(none: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.update_omit(none, c, o, f, id, old, doc, store, hist, evs))) == True{} : Bool}:
  match none:
    case True{}:
      ok
    case False{}:
      vr_write(Hs.ops_data(P.diff(Hs.strip(Hs.omit_keys(o), old), Hs.strip(Hs.omit_keys(o), doc))), c, f, id, old, doc, store, hist, evs, ok)

def vr_update_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.update_hook(skip, c, o, f, id, old, doc, store, hist, evs))) == True{} : Bool}:
  match skip:
    case True{}:
      ok
    case False{}:
      vr_omit(Hs.blank(o, old, doc), c, o, f, id, old, doc, store, hist, evs, ok)

def vr_update(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.update_pick(found, c, o, f, id, doc, store, hist, evs))) == True{} : Bool}:
  match found:
    case None{}:
      ok
    case Some{+old}:
      vr_update_hook(Hs.skipped(f), c, o, f, id, old, doc, store, hist, evs, ok)

def vr_delete_hook(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +old: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.delete_hook(skip, c, o, f, id, old, store, hist, evs))) == True{} : Bool}:
  match skip:
    case True{}:
      ok
    case False{}:
      vr_when(Hs.writes(c, f), hist, Hs.H{Hs.KDelete{}, id, 0n, Hs.strip(Hs.omit_keys(o), old), []}, ok, {==})

def vr_delete(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.delete_pick(found, c, o, f, id, store, hist, evs))) == True{} : Bool}:
  match found:
    case None{}:
      ok
    case Some{+old}:
      vr_delete_hook(Hs.skipped(f), c, o, f, id, old, store, hist, evs, ok)

# LEMMA: one command keeps the versions rising.
law vr_step:
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  for cmd: Hs.Cmd
  for ok: {Spec.versions_rise(Hs.hist_of(st)) == True{} : Bool}
  {Spec.versions_rise(Hs.hist_of(Hs.step_with(c, o, st, cmd))) == True{} : Bool}
def vr_step(c, o, st, cmd, ok):
  match st cmd:
    case Hs.S{+store, +hist, +evs} Hs.Create{+id, +doc}:
      vr_create(Hs.find(store, id), c, o, id, doc, store, hist, evs, ok)
    case Hs.S{+store, +hist, +evs} Hs.Update{+id, +doc, +f}:
      vr_update(Hs.find(store, id), c, o, f, id, doc, store, hist, evs, ok)
    case Hs.S{+store, +hist, +evs} Hs.Delete{+id, +f}:
      vr_delete(Hs.find(store, id), c, o, f, id, store, hist, evs, ok)

def vr_creates(items: +List<Hs.Item>, +c: Hs.Cfg, +o: Hs.Omit, +st: Hs.State, ok: {Spec.versions_rise(Hs.hist_of(st)) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.creates(items, c, o, st))) == True{} : Bool}:
  match items:
    case Nil{}:
      ok
    case Con{Hs.I{+id, +doc}, t}:
      vr_creates(t, c, o, Hs.step_with(c, o, st, Hs.Create{id, doc}), vr_step(c, o, st, Hs.Create{id, doc}, ok))

def vr_updates(ids: +List<Nat>, +doc: +List<P.Entry>, +f: Hs.Flags, +c: Hs.Cfg, +o: Hs.Omit, +st: Hs.State, ok: {Spec.versions_rise(Hs.hist_of(st)) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.updates(ids, doc, f, c, o, st))) == True{} : Bool}:
  match ids:
    case Nil{}:
      ok
    case Con{+id, t}:
      vr_updates(t, doc, f, c, o, Hs.step_with(c, o, st, Hs.Update{id, doc, f}), vr_step(c, o, st, Hs.Update{id, doc, f}, ok))

def vr_deletes(ids: +List<Nat>, +f: Hs.Flags, +c: Hs.Cfg, +o: Hs.Omit, +st: Hs.State, ok: {Spec.versions_rise(Hs.hist_of(st)) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.deletes(ids, f, c, o, st))) == True{} : Bool}:
  match ids:
    case Nil{}:
      ok
    case Con{+id, t}:
      vr_deletes(t, f, c, o, Hs.step_with(c, o, st, Hs.Delete{id, f}), vr_step(c, o, st, Hs.Delete{id, f}, ok))

def vr_vetoed(skip: Bool, +ids: +List<Nat>, +f: Hs.Flags, +c: Hs.Cfg, +o: Hs.Omit, st: Hs.State, ok: {Spec.versions_rise(Hs.hist_of(st)) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.vetoed(skip, ids, f, c, o, st))) == True{} : Bool}:
  match skip:
    case True{}:
      vr_deletes(ids, f, c, o, st, ok)
    case False{}:
      ok

def vr_upsert_new(skip: Bool, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.upsert_new(skip, c, o, f, id, doc, store, hist, evs))) == True{} : Bool}:
  match skip:
    case True{}:
      ok
    case False{}:
      vr_when(Hs.writes(c, f), hist, Hs.H{Hs.KCreate{}, id, 0n, Hs.strip(Hs.omit_keys(o), doc), []}, ok, {==})

def vr_upsert(found: Maybe<+List<P.Entry>>, +c: Hs.Cfg, +o: Hs.Omit, +f: Hs.Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>, +hist: +List<Hs.Hist>, +evs: +List<Hs.Ev>, ok: {Spec.versions_rise(hist) == True{} : Bool}) -> {Spec.versions_rise(Hs.hist_of(Hs.upsert_pick(found, c, o, f, id, doc, store, hist, evs))) == True{} : Bool}:
  match found:
    case Some{+old}:
      vr_update_hook(Hs.skipped(f), c, o, f, id, old, doc, store, hist, evs, ok)
    case None{}:
      vr_upsert_new(Hs.skipped(f), c, o, f, id, doc, store, hist, evs, ok)

# LEMMA: one call, bulk or upsert included, keeps the versions rising.
law vr_call:
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for st: Hs.State
  for k: Hs.Call
  for ok: {Spec.versions_rise(Hs.hist_of(st)) == True{} : Bool}
  {Spec.versions_rise(Hs.hist_of(Hs.call(c, o, st, k))) == True{} : Bool}
def vr_call(c, o, st, k, ok):
  match st k:
    case st Hs.Single{cmd}:
      vr_step(c, o, st, cmd, ok)
    case st Hs.InsertMany{items}:
      vr_creates(items, c, o, st, ok)
    case st Hs.UpdateMany{+ids, +doc, +f}:
      vr_updates(ids, doc, f, c, o, st, ok)
    case st Hs.DeleteMany{+ids, +f}:
      vr_deletes(ids, f, c, o, st, ok)
    case st Hs.DeleteVetoed{+ids, +f}:
      vr_vetoed(Hs.skipped(f), ids, f, c, o, st, ok)
    case Hs.S{+store, +hist, +evs} Hs.Upsert{+id, +doc, +f}:
      vr_upsert(Hs.find(store, id), c, o, f, id, doc, store, hist, evs, ok)

# LEMMA: any calls keep the versions rising.
law vr_calls:
  for ks: List<Hs.Call>
  for +c: Hs.Cfg
  for +o: Hs.Omit
  for +st: Hs.State
  for ok: {Spec.versions_rise(Hs.hist_of(st)) == True{} : Bool}
  {Spec.versions_rise(Hs.hist_of(Hs.calls(ks, c, o, st))) == True{} : Bool}
def vr_calls(ks, c, o, st, ok):
  match ks:
    case Nil{}:
      ok
    case Con{+k, t}:
      vr_calls(t, c, o, Hs.call(c, o, st, k), vr_call(c, o, st, k, ok))

def Laws.versions_rise(ks, c, o):
  vr_calls(ks, c, o, Hs.empty(), {==})
