import Base

# omitDeep (src/omit-deep.ts) over JSON-like trees with Nat keys. A key list holds paths: [k] omits
# key k at any depth; [h, ...tail] omits tail under key h only, and replaces the key list below h.
# A path whose head is unsafe (1 and 2 stand for constructor and prototype) is ignored.

type Tree is Data:
  Leaf{v: Nat}
  Obj{fs: +List<Field>}
  Arr{xs: +List<Tree>}

type Field is Data:
  F{k: Nat, t: Tree}

# One recursive def walks trees, field lists and item lists, picked by the node.
type Node is Data:
  T{t: Tree}
  Fs{fs: +List<Field>}
  Ts{ts: +List<Tree>}

def unsafe(k: Nat) -> Bool:
  match k:
    case 0n:
      False{}
    case 1n+0n:
      True{}
    case 2n+0n:
      True{}
    case 3n+n:
      False{}

def or_pick(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}:
      True{}
    case False{}:
      b

# Whether the key list omits key k here: a path [k] of length one.
def is_top_path(p: +List<Nat>, +k: Nat) -> Bool:
  match p:
    case Nil{}:
      False{}
    case Con{h, Nil{}}:
      Nat.is_eq(h, k)
    case Con{h, Con{x, xs}}:
      False{}

def is_top(keys: +List<+List<Nat>>, +k: Nat) -> Bool:
  match keys:
    case Nil{}:
      False{}
    case Con{p, rest}:
      or_pick(is_top_path(p, k), is_top(rest, k))

# The tails of the paths under key k, skipping paths with an unsafe head.
def nested_pick(take: Bool, tail: +List<Nat>, rest: +List<+List<Nat>>) -> +List<+List<Nat>>:
  match take:
    case True{}:
      tail <> rest
    case False{}:
      rest

def nested_path(p: +List<Nat>, +k: Nat, rest: +List<+List<Nat>>) -> +List<+List<Nat>>:
  match p:
    case Nil{}:
      rest
    case Con{h, Nil{}}:
      rest
    case Con{+h, Con{x, xs}}:
      nested_pick(Bool.and(Nat.is_eq(h, k), Bool.not(unsafe(h))), x <> xs, rest)

def nested(keys: +List<+List<Nat>>, +k: Nat) -> +List<+List<Nat>>:
  match keys:
    case Nil{}:
      []
    case Con{p, rest}:
      nested_path(p, k, nested(rest, k))

# Below key k: the tails nested under k when there are any, otherwise the same key list.
def child_pick(below: +List<+List<Nat>>, keys: +List<+List<Nat>>) -> +List<+List<Nat>>:
  match below:
    case Nil{}:
      keys
    case Con{p, ps}:
      p <> ps

def child_keys(+keys: +List<+List<Nat>>, +k: Nat) -> +List<+List<Nat>>:
  child_pick(nested(keys, k), keys)

def unwrap_t(n: Node) -> Tree:
  match n:
    case T{t}:
      t
    case Fs{fs}:
      Leaf{0n}
    case Ts{ts}:
      Leaf{0n}

def unwrap_fs(n: Node) -> +List<Field>:
  match n:
    case T{t}:
      []
    case Fs{fs}:
      fs
    case Ts{ts}:
      []

def unwrap_ts(n: Node) -> +List<Tree>:
  match n:
    case T{t}:
      []
    case Fs{fs}:
      []
    case Ts{ts}:
      ts

def keep_pick(omit: Bool, field: Field, rest: +List<Field>) -> +List<Field>:
  match omit:
    case True{}:
      rest
    case False{}:
      field <> rest

# Out of fuel, a node comes back unchanged.
def go(fuel: Nat, n: Node, +keys: +List<+List<Nat>>) -> Node:
  match fuel n:
    case 0n n:
      n
    case 1n+f T{Leaf{v}}:
      T{Leaf{v}}
    case 1n+f T{Obj{fs}}:
      T{Obj{unwrap_fs(go(f, Fs{fs}, keys))}}
    case 1n+f T{Arr{xs}}:
      T{Arr{unwrap_ts(go(f, Ts{xs}, keys))}}
    case 1n+f Fs{Nil{}}:
      Fs{[]}
    case 1n++f Fs{Con{F{+k, t}, rest}}:
      Fs{keep_pick(is_top(keys, k), F{k, unwrap_t(go(f, T{t}, child_keys(keys, k)))}, unwrap_fs(go(f, Fs{rest}, keys)))}
    case 1n+f Ts{Nil{}}:
      Ts{[]}
    case 1n++f Ts{Con{t, rest}}:
      Ts{unwrap_t(go(f, T{t}, keys)) <> unwrap_ts(go(f, Ts{rest}, keys))}

def omit(fuel: Nat, t: Tree, +keys: +List<+List<Nat>>) -> Tree:
  unwrap_t(go(fuel, T{t}, keys))

# The key list with the path [u, x, ...xs] in front.
def with_path(+u: Nat, +x: Nat, +xs: +List<Nat>, +keys: +List<+List<Nat>>) -> +List<+List<Nat>>:
  (u <> (x <> xs)) <> keys

def example() -> Tree:
  # { 5: 1, 6: { 5: 2, 7: 3 }, 8: [ { 5: 4 } ] } omitting key 5 everywhere and 7 under 6
  omit(100n, Obj{[F{5n, Leaf{1n}}, F{6n, Obj{[F{5n, Leaf{2n}}, F{7n, Leaf{3n}}]}}, F{8n, Arr{[Obj{[F{5n, Leaf{4n}}]}]}}]}, [[5n], [6n, 7n]])
