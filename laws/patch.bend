import Base

# A flat document: a list of key/value entries, both Nat. Keys are expected to be distinct.
type Entry is Data:
  E{k: Nat, v: Nat}

# A patch operation: set a key (add or replace) or remove it.
type Op is Data:
  Put{k: Nat, v: Nat}
  Del{k: Nat}

# ---- lookup ----

def lookup_pick(same: Bool, v: Nat, rest: Maybe<Nat>) -> Maybe<Nat>:
  match same:
    case True{}:
      Some{v}
    case False{}:
      rest

def lookup(d: +List<Entry>, +k: Nat) -> Maybe<Nat>:
  match d:
    case Nil{}:
      None{}
    case Con{E{+ek, v}, t}:
      lookup_pick(Nat.is_eq(ek, k), v, lookup(t, k))

# ---- apply one op, then a list of ops ----

def del_pick(same: Bool, e: Entry, rest: +List<Entry>) -> +List<Entry>:
  match same:
    case True{}:
      rest
    case False{}:
      e <> rest

def del(d: +List<Entry>, +k: Nat) -> +List<Entry>:
  match d:
    case Nil{}:
      Nil{}
    case Con{E{+ek, v}, t}:
      del_pick(Nat.is_eq(ek, k), E{ek, v}, del(t, k))

def step(d: +List<Entry>, op: Op) -> +List<Entry>:
  match op:
    case Put{+k, v}:
      E{k, v} <> del(d, k)
    case Del{k}:
      del(d, k)

def apply(ops: List<Op>, d: +List<Entry>) -> +List<Entry>:
  match ops:
    case Nil{}:
      d
    case Con{op, t}:
      apply(t, step(d, op))

# ---- diff: only what changed, like compare ----

def diff_same(same: Bool, +k: Nat, +w: Nat) -> List<Op>:
  match same:
    case True{}:
      []
    case False{}:
      [Put{k, w}]

# For one source entry: removed when the target lacks its key, replaced when the value differs.
def diff_one_pick(found: Maybe<Nat>, +k: Nat, +v: Nat) -> List<Op>:
  match found:
    case None{}:
      [Del{k}]
    case Some{+w}:
      diff_same(Nat.is_eq(v, w), k, w)

def diff_source(a: +List<Entry>, +b: +List<Entry>) -> List<Op>:
  match a:
    case Nil{}:
      []
    case Con{E{+k, +v}, t}:
      List.append(&1, Op, diff_one_pick(lookup(b, k), k, v), diff_source(t, b))

# For one target entry: added when the source lacks its key.
def diff_added_pick(found: Maybe<Nat>, +k: Nat, +w: Nat) -> List<Op>:
  match found:
    case None{}:
      [Put{k, w}]
    case Some{x}:
      []

def diff_added(b: +List<Entry>, +a: +List<Entry>) -> List<Op>:
  match b:
    case Nil{}:
      []
    case Con{E{+k, +w}, t}:
      List.append(&1, Op, diff_added_pick(lookup(a, k), k, w), diff_added(t, a))

def diff(+a: +List<Entry>, +b: +List<Entry>) -> List<Op>:
  List.append(&1, Op, diff_source(a, b), diff_added(b, a))

def example() -> +List<Entry>:
  +a = {[E{1n, 10n}, E{2n, 20n}, E{3n, 30n}] : +List<Entry>}
  +b = {[E{2n, 21n}, E{3n, 30n}, E{4n, 40n}] : +List<Entry>}
  apply(diff(a, b), a)
