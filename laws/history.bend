import Base
import ./patch.bend as P

# The plugin's contract over a document store: what each command does to the stored documents and
# which history entry it writes (src/patch.ts, src/hooks). Documents are flat (patch.bend).
#   Create  stores a new document; entry version 0 with the document
#   Update  replaces a document; entry with the patch, version = highest version for the id + 1,
#           written only when the patch is not empty
#   Delete  removes a document; entry version 0 with the removed document
# A create of an existing id, and an update or delete of a missing id, change nothing.
# Events: created {doc}, updated {oldDoc, doc, patch} when the patch is not empty, deleted {oldDoc}.
# Configuration: history off (patchHistoryDisabled), events configured or not. Updates and deletes
# carry the query switches (true = ignore); a hook with ignoreHook, or with both ignoreEvent and
# ignorePatchHistory, does nothing. Creates (save, insertMany) carry none.
# Omit (the plugin's omit option): the listed keys are left out of every history entry, of the
# created and deleted events' documents and of the patch, which is the diff of the omitted
# documents. The updated event keeps the documents whole. When _id is omitted too (id), an update
# whose omitted old or new document has no keys left records nothing.

type Flags is Data:
  Flags{hook: Bool, event: Bool, history: Bool}

type Cfg is Data:
  Cfg{history: Bool, events: Bool}

type Omit is Data:
  Omit{keys: +List<Nat>, id: Bool}

type Cmd is Data:
  Create{id: Nat, doc: +List<P.Entry>}
  Update{id: Nat, doc: +List<P.Entry>, flags: Flags}
  Delete{id: Nat, flags: Flags}

type HOp is Data:
  KCreate{}
  KUpdate{}
  KDelete{}

type Hist is Data:
  H{kind: HOp, id: Nat, version: Nat, doc: +List<P.Entry>, patch: +List<P.Op>}

type Rec is Data:
  R{id: Nat, doc: +List<P.Entry>}

type Ev is Data:
  ECreated{doc: +List<P.Entry>}
  EUpdated{old: +List<P.Entry>, doc: +List<P.Entry>, patch: +List<P.Op>}
  EDeleted{old: +List<P.Entry>}

type State is Data:
  S{store: +List<Rec>, hist: +List<Hist>, evs: +List<Ev>}

# ---- store ----

def find_pick(same: Bool, +doc: +List<P.Entry>, rest: Maybe<+List<P.Entry>>) -> Maybe<+List<P.Entry>>:
  match same:
    case True{}:
      Some{doc}
    case False{}:
      rest

def find(store: +List<Rec>, +id: Nat) -> Maybe<+List<P.Entry>>:
  match store:
    case Nil{}:
      None{}
    case Con{R{+rid, +doc}, rest}:
      find_pick(Nat.is_eq(rid, id), doc, find(rest, id))

def remove_pick(same: Bool, +r: Rec, rest: +List<Rec>) -> +List<Rec>:
  match same:
    case True{}:
      rest
    case False{}:
      r <> rest

def remove(store: +List<Rec>, +id: Nat) -> +List<Rec>:
  match store:
    case Nil{}:
      []
    case Con{R{+rid, +doc}, rest}:
      remove_pick(Nat.is_eq(rid, id), R{rid, doc}, remove(rest, id))

# ---- history ----

def max(a: Nat, b: Nat) -> Nat:
  match a b:
    case 0n b:
      b
    case 1n+x 0n:
      1n+x
    case 1n+x 1n+y:
      1n+max(x, y)

def top_pick(same: Bool, +version: Nat, rest: Maybe<Nat>) -> Maybe<Nat>:
  match same rest:
    case False{} rest:
      rest
    case True{} None{}:
      Some{version}
    case True{} Some{v}:
      Some{max(version, v)}

# The highest version among the entries of an id.
def top_version(hist: +List<Hist>, +id: Nat) -> Maybe<Nat>:
  match hist:
    case Nil{}:
      None{}
    case Con{H{k, +hid, +v, d, p}, rest}:
      top_pick(Nat.is_eq(hid, id), v, top_version(rest, id))

def next_version(top: Maybe<Nat>) -> Nat:
  match top:
    case None{}:
      0n
    case Some{v}:
      1n+v

def append_hist(hist: +List<Hist>, h: Hist) -> +List<Hist>:
  List.append(&2, Hist, hist, [h])

# patch.bend's ops are a use-once list; entries keep them as data.
def ops_data(ops: List<P.Op>) -> +List<P.Op>:
  match ops:
    case Nil{}:
      []
    case Con{o, os}:
      o <> ops_data(os)

def ops_once(ops: +List<P.Op>) -> List<P.Op>:
  match ops:
    case Nil{}:
      []
    case Con{o, os}:
      o <> ops_once(os)

# ---- omit ----

def mem(keys: +List<Nat>, +k: Nat) -> Bool:
  match keys:
    case Nil{}:
      False{}
    case Con{+h, t}:
      Bool.or(Nat.is_eq(h, k), mem(t, k))

def strip_pick(drop: Bool, e: P.Entry, rest: +List<P.Entry>) -> +List<P.Entry>:
  match drop:
    case True{}:
      rest
    case False{}:
      e <> rest

# A document without the omitted keys.
def strip(+keys: +List<Nat>, d: +List<P.Entry>) -> +List<P.Entry>:
  match d:
    case Nil{}:
      []
    case Con{P.E{+k, +v}, t}:
      strip_pick(mem(keys, k), P.E{k, v}, strip(keys, t))

def omit_keys(o: Omit) -> +List<Nat>:
  match o:
    case Omit{keys, id}:
      keys

def is_nil(d: +List<P.Entry>) -> Bool:
  match d:
    case Nil{}:
      True{}
    case Con{e, t}:
      False{}

# An update records nothing when _id is omitted and the omitted old or new document is empty.
def blank(o: Omit, +old: +List<P.Entry>, +doc: +List<P.Entry>) -> Bool:
  match o:
    case Omit{+keys, id}:
      Bool.and(id, Bool.or(is_nil(strip(keys, old)), is_nil(strip(keys, doc))))

# ---- commands ----

def when_hist(b: Bool, +hist: +List<Hist>, h: Hist) -> +List<Hist>:
  match b:
    case True{}:
      append_hist(hist, h)
    case False{}:
      hist

def when_ev(b: Bool, +evs: +List<Ev>, e: Ev) -> +List<Ev>:
  match b:
    case True{}:
      List.append(&2, Ev, evs, [e])
    case False{}:
      evs

# The hook does nothing with ignoreHook, or with both ignoreEvent and ignorePatchHistory.
def skipped(f: Flags) -> Bool:
  match f:
    case Flags{hook, +event, +history}:
      Bool.or(hook, Bool.and(event, history))

def writes(c: Cfg, f: Flags) -> Bool:
  match c f:
    case Cfg{history, events} Flags{hook, event, ignored}:
      Bool.and(history, Bool.not(ignored))

def emits(c: Cfg, f: Flags) -> Bool:
  match c f:
    case Cfg{history, events} Flags{hook, ignored, h}:
      Bool.and(events, Bool.not(ignored))

def cfg_history(c: Cfg) -> Bool:
  match c:
    case Cfg{history, events}:
      history

def cfg_events(c: Cfg) -> Bool:
  match c:
    case Cfg{history, events}:
      events

def create_pick(found: Maybe<+List<P.Entry>>, +c: Cfg, +o: Omit, +id: Nat, +doc: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match found:
    case Some{old}:
      S{store, hist, evs}
    case None{}:
      S{R{id, doc} <> store, when_hist(cfg_history(c), hist, H{KCreate{}, id, 0n, strip(omit_keys(o), doc), []}), when_ev(cfg_events(c), evs, ECreated{strip(omit_keys(o), doc)})}

def update_write(ops: +List<P.Op>, +c: Cfg, +f: Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match ops:
    case Nil{}:
      S{R{id, doc} <> remove(store, id), hist, evs}
    case Con{+o, +os}:
      S{R{id, doc} <> remove(store, id), when_hist(writes(c, f), hist, H{KUpdate{}, id, next_version(top_version(hist, id)), [], o <> os}), when_ev(emits(c, f), evs, EUpdated{old, doc, o <> os})}

def update_omit(none: Bool, +c: Cfg, +o: Omit, +f: Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match none:
    case True{}:
      S{R{id, doc} <> remove(store, id), hist, evs}
    case False{}:
      update_write(ops_data(P.diff(strip(omit_keys(o), old), strip(omit_keys(o), doc))), c, f, id, old, doc, store, hist, evs)

def update_hook(skip: Bool, +c: Cfg, +o: Omit, +f: Flags, +id: Nat, +old: +List<P.Entry>, +doc: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match skip:
    case True{}:
      S{R{id, doc} <> remove(store, id), hist, evs}
    case False{}:
      update_omit(blank(o, old, doc), c, o, f, id, old, doc, store, hist, evs)

def update_pick(found: Maybe<+List<P.Entry>>, +c: Cfg, +o: Omit, +f: Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match found:
    case None{}:
      S{store, hist, evs}
    case Some{+old}:
      update_hook(skipped(f), c, o, f, id, old, doc, store, hist, evs)

def delete_hook(skip: Bool, +c: Cfg, +o: Omit, +f: Flags, +id: Nat, +old: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match skip:
    case True{}:
      S{remove(store, id), hist, evs}
    case False{}:
      S{remove(store, id), when_hist(writes(c, f), hist, H{KDelete{}, id, 0n, strip(omit_keys(o), old), []}), when_ev(emits(c, f), evs, EDeleted{strip(omit_keys(o), old)})}

def delete_pick(found: Maybe<+List<P.Entry>>, +c: Cfg, +o: Omit, +f: Flags, +id: Nat, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match found:
    case None{}:
      S{store, hist, evs}
    case Some{+old}:
      delete_hook(skipped(f), c, o, f, id, old, store, hist, evs)

def step_with(+c: Cfg, +o: Omit, st: State, cmd: Cmd) -> State:
  match st cmd:
    case S{+store, +hist, +evs} Create{+id, +doc}:
      create_pick(find(store, id), c, o, id, doc, store, hist, evs)
    case S{+store, +hist, +evs} Update{+id, +doc, +f}:
      update_pick(find(store, id), c, o, f, id, doc, store, hist, evs)
    case S{+store, +hist, +evs} Delete{+id, +f}:
      delete_pick(find(store, id), c, o, f, id, store, hist, evs)

def run_with(cmds: List<Cmd>, +c: Cfg, +o: Omit, st: State) -> State:
  match cmds:
    case Nil{}:
      st
    case Con{cmd, cs}:
      run_with(cs, c, o, step_with(c, o, st, cmd))

# Nothing omitted.
def no_omit() -> Omit:
  Omit{[], False{}}

def step(+c: Cfg, st: State, cmd: Cmd) -> State:
  step_with(c, no_omit(), st, cmd)

def run(cmds: List<Cmd>, +c: Cfg, st: State) -> State:
  run_with(cmds, c, no_omit(), st)

def empty() -> State:
  S{[], [], []}

# ---- mongoose calls: bulk operations and upserts ----
# insertMany, updateMany and deleteMany act as the single command on each document they match (the
# order among those documents is the cursor's and not part of the contract). An upsert of an existing
# id is an update; of a missing id it stores the document and records a creation, which, unlike a
# save, honours the query switches. A preDelete that rejects (DeleteVetoed) fails the delete: nothing
# is deleted, recorded or emitted, unless the hook is skipped, which skips preDelete too.

type Item is Data:
  I{id: Nat, doc: +List<P.Entry>}

type Call is Data:
  Single{cmd: Cmd}
  InsertMany{items: +List<Item>}
  UpdateMany{ids: +List<Nat>, doc: +List<P.Entry>, flags: Flags}
  DeleteMany{ids: +List<Nat>, flags: Flags}
  DeleteVetoed{ids: +List<Nat>, flags: Flags}
  Upsert{id: Nat, doc: +List<P.Entry>, flags: Flags}

def creates(items: +List<Item>, +c: Cfg, +o: Omit, st: State) -> State:
  match items:
    case Nil{}:
      st
    case Con{I{+id, +doc}, t}:
      creates(t, c, o, step_with(c, o, st, Create{id, doc}))

def updates(ids: +List<Nat>, +doc: +List<P.Entry>, +f: Flags, +c: Cfg, +o: Omit, st: State) -> State:
  match ids:
    case Nil{}:
      st
    case Con{+id, t}:
      updates(t, doc, f, c, o, step_with(c, o, st, Update{id, doc, f}))

def deletes(ids: +List<Nat>, +f: Flags, +c: Cfg, +o: Omit, st: State) -> State:
  match ids:
    case Nil{}:
      st
    case Con{+id, t}:
      deletes(t, f, c, o, step_with(c, o, st, Delete{id, f}))

def vetoed(skip: Bool, +ids: +List<Nat>, +f: Flags, +c: Cfg, +o: Omit, st: State) -> State:
  match skip:
    case True{}:
      deletes(ids, f, c, o, st)
    case False{}:
      st

def upsert_new(skip: Bool, +c: Cfg, +o: Omit, +f: Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match skip:
    case True{}:
      S{R{id, doc} <> store, hist, evs}
    case False{}:
      S{R{id, doc} <> store, when_hist(writes(c, f), hist, H{KCreate{}, id, 0n, strip(omit_keys(o), doc), []}), when_ev(emits(c, f), evs, ECreated{strip(omit_keys(o), doc)})}

def upsert_pick(found: Maybe<+List<P.Entry>>, +c: Cfg, +o: Omit, +f: Flags, +id: Nat, +doc: +List<P.Entry>, +store: +List<Rec>, +hist: +List<Hist>, +evs: +List<Ev>) -> State:
  match found:
    case Some{+old}:
      update_hook(skipped(f), c, o, f, id, old, doc, store, hist, evs)
    case None{}:
      upsert_new(skipped(f), c, o, f, id, doc, store, hist, evs)

def call(+c: Cfg, +o: Omit, st: State, k: Call) -> State:
  match st k:
    case st Single{cmd}:
      step_with(c, o, st, cmd)
    case st InsertMany{items}:
      creates(items, c, o, st)
    case st UpdateMany{+ids, +doc, +f}:
      updates(ids, doc, f, c, o, st)
    case st DeleteMany{+ids, +f}:
      deletes(ids, f, c, o, st)
    case st DeleteVetoed{+ids, +f}:
      vetoed(skipped(f), ids, f, c, o, st)
    case S{+store, +hist, +evs} Upsert{+id, +doc, +f}:
      upsert_pick(find(store, id), c, o, f, id, doc, store, hist, evs)

def calls(ks: List<Call>, +c: Cfg, +o: Omit, st: State) -> State:
  match ks:
    case Nil{}:
      st
    case Con{k, t}:
      calls(t, c, o, call(c, o, st, k))

# ---- replay: what the history says a document is ----

def store_of(st: State) -> +List<Rec>:
  match st:
    case S{store, hist, evs}:
      store

def hist_of(st: State) -> +List<Hist>:
  match st:
    case S{store, hist, evs}:
      hist

def evs_of(st: State) -> +List<Ev>:
  match st:
    case S{store, hist, evs}:
      evs

def none() -> Flags:
  Flags{False{}, False{}, False{}}

def example() -> State:
  run([Create{1n, [P.E{1n, 10n}]}, Update{1n, [P.E{1n, 11n}, P.E{2n, 20n}], none()}, Update{1n, [P.E{1n, 11n}, P.E{2n, 20n}], none()}, Create{2n, [P.E{1n, 5n}]}, Delete{1n, none()}], Cfg{True{}, True{}}, empty())
