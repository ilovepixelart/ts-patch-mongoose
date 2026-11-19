import Base

# chunk(xs, size): consecutive pieces of at most `size` elements, in order (helpers.ts chunk, which
# splits history bulk writes). The current piece is built in order; `rem` counts the slots left in
# it, and the piece is emitted when the last slot is filled, or at the end when not empty.

def flush(cur: +List<Nat>) -> +List<+List<Nat>>:
  match cur:
    case Nil{}:
      []
    case Con{h, t}:
      [h <> t]

def chunk_go(xs: +List<Nat>, +size: Nat, cur: +List<Nat>, rem: Nat) -> +List<+List<Nat>>:
  match xs rem:
    case Nil{} r:
      flush(cur)
    case Con{h, t} 0n:
      List.append(&2, Nat, cur, [h]) <> chunk_go(t, size, [], size)
    case Con{h, t} 1n+0n:
      List.append(&2, Nat, cur, [h]) <> chunk_go(t, size, [], size)
    case Con{h, t} 2n+r:
      chunk_go(t, size, List.append(&2, Nat, cur, [h]), 1n+r)

def chunk(xs: +List<Nat>, +size: Nat) -> +List<+List<Nat>>:
  chunk_go(xs, size, [], size)

def example() -> +List<+List<Nat>>:
  chunk([1n, 2n, 3n, 4n, 5n], 2n)
