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

# The round trip, split on whether the source holds j.
def roundtrip_at(m: Maybe<Nat>, +a: +List<P.Entry>, +b: +List<P.Entry>, db: Spec.Distinct(b), +j: Nat, +e: {P.lookup(a, j) == m : Maybe<Nat>}) -> {P.lookup(P.apply(P.diff_added(b, a), P.apply(P.diff_source(a, b), a)), j) == P.lookup(b, j) : Maybe<Nat>}:
  match m:
    case None{}:
      hd = Equal.trans(Maybe<Nat>, P.lookup(P.apply(P.diff_source(a, b), a), j), P.lookup(a, j), None{}, source_skip(a, b, a, j, e), e)
      added_fill(b, a, P.apply(P.diff_source(a, b), a), j, e, hd, db)
    case Some{+y}:
      Equal.trans(Maybe<Nat>, P.lookup(P.apply(P.diff_added(b, a), P.apply(P.diff_source(a, b), a)), j), P.lookup(P.apply(P.diff_source(a, b), a), j), P.lookup(b, j), added_held(b, a, P.apply(P.diff_source(a, b), a), j, y, e), source_reach(a, b, a, j, y, e, {==}))

def Laws.apply_diff_roundtrip(a, b, db, j):
  %Equal.sym(+List<P.Entry>, P.apply(List.append(&1, P.Op, P.diff_source(a, b), P.diff_added(b, a)), a), P.apply(P.diff_added(b, a), P.apply(P.diff_source(a, b), a)), apply_append(P.diff_source(a, b), P.diff_added(b, a), a)) : {P.lookup(_, j) == P.lookup(b, j) : Maybe<Nat>}
  roundtrip_at(P.lookup(a, j), a, b, db, j, {==})

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

def Laws.disabled_writes_no_history(cmds, ev, st):
  match cmds st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+cmd, cs} Hs.S{+store, +hist, +evs}:
      %Equal.sym(+List<Hs.Hist>, Hs.hist_of(Hs.run(cs, Hs.Cfg{False{}, ev}, Hs.step_with(Hs.Cfg{False{}, ev}, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))), Hs.hist_of(Hs.step_with(Hs.Cfg{False{}, ev}, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)), Laws.disabled_writes_no_history(cs, ev, Hs.step_with(Hs.Cfg{False{}, ev}, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))) : {_ == hist : +List<Hs.Hist>}
      disabled_step(ev, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)

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


def Laws.unconfigured_emits_nothing(cmds, h, st):
  match cmds st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+cmd, cs} Hs.S{+store, +hist, +evs}:
      %Equal.sym(+List<Hs.Ev>, Hs.evs_of(Hs.run(cs, Hs.Cfg{h, False{}}, Hs.step_with(Hs.Cfg{h, False{}}, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))), Hs.evs_of(Hs.step_with(Hs.Cfg{h, False{}}, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)), Laws.unconfigured_emits_nothing(cs, h, Hs.step_with(Hs.Cfg{h, False{}}, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))) : {_ == evs : +List<Hs.Ev>}
      unconfigured_step(h, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)

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

def Laws.store_independent(cmds, c, st):
  match cmds st:
    case Nil{} Hs.S{+store, +hist, +evs}:
      {==}
    case Con{+cmd, cs} Hs.S{+store, +hist, +evs}:
      %Equal.sym(+List<Hs.Rec>, Hs.store_of(Hs.run(cs, c, Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))), Spec.store_run(cs, Hs.store_of(Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))), Laws.store_independent(cs, c, Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd))) : {_ == Spec.store_run(Con{cmd, cs}, store) : +List<Hs.Rec>}
      %Equal.sym(+List<Hs.Rec>, Hs.store_of(Hs.step_with(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)), Spec.store_step(store, cmd), store_step_independent(c, Hs.no_omit(), Hs.S{store, hist, evs}, cmd)) : {Spec.store_run(cs, _) == Spec.store_run(Con{cmd, cs}, store) : +List<Hs.Rec>}
      {==}
