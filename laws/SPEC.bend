import Base
import ./patch.bend as P
import ./history.bend as Hs
import ./omit.bend as O

# Specification helpers for LAWS.bend, not part of the models. The models (listed in
# MODELS in laws/check.mjs) mirror src/ and may change with it; keep this file and LAWS.bend unchanged
# when they do, so a law that stops holding fails instead of moving.

# T(b): the truth of a Bool as a type, Unit when it holds and Empty when it fails.
def T(b: Bool) -> Data:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

def switches_off(f: Hs.Flags) -> Bool:
  match f:
    case Hs.Flags{hook, event, history}:
      Bool.not(Bool.or(hook, Bool.or(event, history)))

# A query switch: ignoreHook, ignoreEvent or ignorePatchHistory.
type Switch is Data:
  Hook{}
  Event{}
  History{}

def sets(s: Switch, f: Hs.Flags) -> Bool:
  match s f:
    case Hook{} Hs.Flags{hook, event, history}:
      hook
    case Event{} Hs.Flags{hook, event, history}:
      event
    case History{} Hs.Flags{hook, event, history}:
      history

# A document whose keys are all different: each key is absent from the entries after it.
def Distinct(d: +List<P.Entry>) -> Type:
  match d:
    case Nil{}:
      Unit
    case Con{P.E{+k, v}, +t}:
      {P.lookup(t, k) == {None{} : Maybe<Nat>} : Maybe<Nat>} & Distinct(t)

# Every document the commands carry has distinct keys (what JS objects guarantee).
def AllDistinct(cmds: List<Hs.Cmd>) -> Type:
  match cmds:
    case Nil{}:
      Unit
    case Con{Hs.Create{id, doc}, cs}:
      Distinct(doc) & AllDistinct(cs)
    case Con{Hs.Update{id, doc, f}, cs}:
      Distinct(doc) & AllDistinct(cs)
    case Con{Hs.Delete{id, f}, cs}:
      AllDistinct(cs)

# No command sets a switch.
def NoSwitches(cmds: List<Hs.Cmd>) -> Type:
  match cmds:
    case Nil{}:
      Unit
    case Con{Hs.Create{id, doc}, cs}:
      NoSwitches(cs)
    case Con{Hs.Update{id, doc, f}, cs}:
      T(switches_off(f)) & NoSwitches(cs)
    case Con{Hs.Delete{id, f}, cs}:
      T(switches_off(f)) & NoSwitches(cs)

# The call sets switch s: an update, delete, bulk update or delete, or upsert with it set. Creates
# and insertMany carry no switches.
def Sets(s: Switch, k: Hs.Call) -> Type:
  match k:
    case Hs.Single{Hs.Create{id, doc}}:
      Empty
    case Hs.Single{Hs.Update{id, doc, f}}:
      T(sets(s, f))
    case Hs.Single{Hs.Delete{id, f}}:
      T(sets(s, f))
    case Hs.InsertMany{items}:
      Empty
    case Hs.UpdateMany{ids, doc, f}:
      T(sets(s, f))
    case Hs.DeleteMany{ids, f}:
      T(sets(s, f))
    case Hs.DeleteVetoed{ids, f}:
      T(sets(s, f))
    case Hs.Upsert{id, doc, f}:
      T(sets(s, f))

def store_create(found: Maybe<+List<P.Entry>>, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>) -> +List<Hs.Rec>:
  match found:
    case Some{old}:
      store
    case None{}:
      Hs.R{id, doc} <> store

def store_update(found: Maybe<+List<P.Entry>>, +id: Nat, +doc: +List<P.Entry>, +store: +List<Hs.Rec>) -> +List<Hs.Rec>:
  match found:
    case None{}:
      store
    case Some{old}:
      Hs.R{id, doc} <> Hs.remove(store, id)

def store_delete(found: Maybe<+List<P.Entry>>, +id: Nat, +store: +List<Hs.Rec>) -> +List<Hs.Rec>:
  match found:
    case None{}:
      store
    case Some{old}:
      Hs.remove(store, id)

def store_step(+store: +List<Hs.Rec>, cmd: Hs.Cmd) -> +List<Hs.Rec>:
  match cmd:
    case Hs.Create{+id, +doc}:
      store_create(Hs.find(store, id), id, doc, store)
    case Hs.Update{+id, +doc, f}:
      store_update(Hs.find(store, id), id, doc, store)
    case Hs.Delete{+id, f}:
      store_delete(Hs.find(store, id), id, store)

def store_run(cmds: List<Hs.Cmd>, +store: +List<Hs.Rec>) -> +List<Hs.Rec>:
  match cmds:
    case Nil{}:
      store
    case Con{cmd, cs}:
      store_run(cs, store_step(store, cmd))

def replay_pick(same: Bool, h: Hs.Hist, acc: Maybe<+List<P.Entry>>) -> Maybe<+List<P.Entry>>:
  match same h acc:
    case False{} h acc:
      acc
    case True{} Hs.H{Hs.KCreate{}, i, v, +d, p} acc:
      Some{d}
    case True{} Hs.H{Hs.KDelete{}, i, v, d, p} acc:
      None{}
    case True{} Hs.H{Hs.KUpdate{}, i, v, d, +p} None{}:
      None{}
    case True{} Hs.H{Hs.KUpdate{}, i, v, d, +p} Some{+cur}:
      Some{P.apply(Hs.ops_once(p), cur)}

def replay_go(hist: +List<Hs.Hist>, +id: Nat, acc: Maybe<+List<P.Entry>>) -> Maybe<+List<P.Entry>>:
  match hist:
    case Nil{}:
      acc
    case Con{Hs.H{k, +hid, v, d, p}, rest}:
      replay_go(rest, id, replay_pick(Nat.is_eq(hid, id), Hs.H{k, hid, v, d, p}, acc))

def replay(hist: +List<Hs.Hist>, +id: Nat) -> Maybe<+List<P.Entry>>:
  replay_go(hist, id, None{})

# What a key of a document reads as: None when there is no document, Some(lookup) when there is.
def doc_lookup(m: Maybe<+List<P.Entry>>, +j: Nat) -> Maybe<Maybe<Nat>>:
  match m:
    case None{}:
      None{}
    case Some{d}:
      Some{P.lookup(d, j)}

# ---- omit ----

def has_key(d: +List<P.Entry>, +k: Nat) -> Bool:
  match d:
    case Nil{}:
      False{}
    case Con{P.E{+j, v}, t}:
      Bool.or(Nat.is_eq(j, k), has_key(t, k))

def op_key(op: P.Op) -> Nat:
  match op:
    case P.Put{j, v}:
      j
    case P.Del{j}:
      j

def ops_mention(ops: +List<P.Op>, +k: Nat) -> Bool:
  match ops:
    case Nil{}:
      False{}
    case Con{+op, t}:
      Bool.or(Nat.is_eq(op_key(op), k), ops_mention(t, k))

# Whether any history entry holds key k, in its document or in its patch.
def hist_mentions(hist: +List<Hs.Hist>, +k: Nat) -> Bool:
  match hist:
    case Nil{}:
      False{}
    case Con{Hs.H{kind, id, v, +d, +p}, rest}:
      Bool.or(has_key(d, k), Bool.or(ops_mention(p, k), hist_mentions(rest, k)))

# What a state recorded: its history and events, without the store.
def records(st: Hs.State) -> Hs.State:
  match st:
    case Hs.S{store, hist, evs}:
      Hs.S{[], hist, evs}

def doc_strip(+keys: +List<Nat>, m: Maybe<+List<P.Entry>>) -> Maybe<+List<P.Entry>>:
  match m:
    case None{}:
      None{}
    case Some{d}:
      Some{Hs.strip(keys, d)}

# ---- versions ----

# Whether every entry of id in hist has a version below v.
def below(hist: +List<Hs.Hist>, +id: Nat, +v: Nat) -> Bool:
  match hist:
    case Nil{}:
      True{}
    case Con{Hs.H{k, +hid, +w, d, p}, rest}:
      Bool.and(Bool.or(Bool.not(Nat.is_eq(hid, id)), Nat.is_lt(w, v)), below(rest, id, v))

def rise_entry(h: Hs.Hist, +before: +List<Hs.Hist>) -> Bool:
  match h:
    case Hs.H{Hs.KUpdate{}, +id, +v, d, p}:
      below(before, id, v)
    case Hs.H{Hs.KCreate{}, id, v, d, p}:
      True{}
    case Hs.H{Hs.KDelete{}, id, v, d, p}:
      True{}

def rise_go(hist: +List<Hs.Hist>, +before: +List<Hs.Hist>) -> Bool:
  match hist:
    case Nil{}:
      True{}
    case Con{+h, rest}:
      Bool.and(rise_entry(h, before), rise_go(rest, List.append(&2, Hs.Hist, before, [h])))

# Whether each update entry's version is above every version recorded before it for the same id.
def versions_rise(+hist: +List<Hs.Hist>) -> Bool:
  rise_go(hist, [])

# ---- chunk ----

# Whether a list has at most n elements.
def fits(xs: +List<Nat>, n: Nat) -> Bool:
  match xs n:
    case Nil{} n:
      True{}
    case Con{h, t} 0n:
      False{}
    case Con{h, t} 1n+m:
      fits(t, m)

# Whether every piece is non-empty and has at most n elements.
def pieces_fit(ps: +List<+List<Nat>>, +n: Nat) -> Bool:
  match ps:
    case Nil{}:
      True{}
    case Con{Nil{}, t}:
      False{}
    case Con{Con{+h, +r}, t}:
      Bool.and(fits(h <> r, n), pieces_fit(t, n))

# ---- omitDeep ----

# Whether a field list has a field with key k.
def has_field(fs: +List<O.Field>, +k: Nat) -> Bool:
  match fs:
    case Nil{}:
      False{}
    case Con{O.F{+j, t}, rest}:
      Bool.or(Nat.is_eq(j, k), has_field(rest, k))
