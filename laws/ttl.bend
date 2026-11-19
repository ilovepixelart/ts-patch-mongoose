import Base

# setPatchHistoryTTL (src/helpers.ts) over the history TTL index, observed on MongoDB: the index is
# NoIndex or Ttl{seconds}. An input is the empty string, unparseable (ms gives NaN), or a number of
# milliseconds: its sign, whole seconds and whether a fraction of a second remains. The number 0 is
# Millis{False, 0, False}.
#   empty      drops an index; with none, the create of NaN seconds fails (error)
#   unparseable  drops an index, then the create of NaN seconds fails (error): the index is lost
#   too long   (more seconds than MongoDB's limit, 2147483647) the same: the index is lost, with an error
#   below 1s   drops an index; with none, creates one of the seconds MongoDB truncates to (0), or fails
#              when that is negative
#   1s or more keeps an index of exactly that many seconds, and otherwise replaces or creates one of the
#              whole seconds (MongoDB truncates the fraction)

type Input is Data:
  Empty{}
  Invalid{}
  TooLong{}
  Millis{neg: Bool, secs: Nat, frac: Bool}

type Index is Data:
  NoIndex{}
  Ttl{secs: Nat}

type Outcome is Data:
  R{index: Index, error: Bool}

def created(neg: Bool, secs: Nat) -> Outcome:
  match neg secs:
    case False{} s:
      R{Ttl{s}, False{}}
    case True{} 0n:
      R{Ttl{0n}, False{}}
    case True{} 1n+p:
      R{NoIndex{}, True{}}

def same(frac: Bool, +secs: Nat, +e: Nat) -> Bool:
  match frac:
    case True{}:
      False{}
    case False{}:
      Nat.is_eq(secs, e)

def kept(keep: Bool, +secs: Nat, +e: Nat) -> Outcome:
  match keep:
    case True{}:
      R{Ttl{e}, False{}}
    case False{}:
      R{Ttl{secs}, False{}}

def existing(+e: Nat, neg: Bool, +secs: Nat, frac: Bool) -> Outcome:
  match neg secs:
    case True{} s:
      R{NoIndex{}, False{}}
    case False{} 0n:
      R{NoIndex{}, False{}}
    case False{} 1n+p:
      kept(same(frac, 1n+p, e), 1n+p, e)

def ttl(index: Index, input: Input) -> Outcome:
  match index input:
    case NoIndex{} Empty{}:
      R{NoIndex{}, True{}}
    case Ttl{e} Empty{}:
      R{NoIndex{}, False{}}
    case i Invalid{}:
      R{NoIndex{}, True{}}
    case i TooLong{}:
      R{NoIndex{}, True{}}
    case NoIndex{} Millis{neg, secs, frac}:
      created(neg, secs)
    case Ttl{+e} Millis{neg, +secs, frac}:
      existing(e, neg, secs, frac)

def index_of(r: Outcome) -> Index:
  match r:
    case R{index, error}:
      index
