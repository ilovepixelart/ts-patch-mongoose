# Claims: the rest of the contract, stated but not yet proven. Each holds on the models in the
# oracle tests (tests/laws/) and is checked against the real plugin; once PROOF.bend proves one, it
# moves to LAWS.bend.

import Base
import ./patch.bend as P
import ./chunk.bend as C
import ./omit.bend as O
import ./history.bend as Hs
import ./SPEC.bend as Spec

# CLAIM (the plugin's contract): after any commands whose documents have distinct keys, replaying a
# document's history gives the stored document, key by key; for a deleted or missing document both say
# there is none. History is on and no switch is set.
law replay_matches_store:
  for cmds: List<Hs.Cmd>
  for -dc: Spec.AllDistinct(cmds)
  for -nf: Spec.NoSwitches(cmds)
  for +ev: Bool
  for +id: Nat
  for +j: Nat
  st = Hs.run(cmds, Hs.Cfg{True{}, ev}, Hs.empty())
  {Spec.doc_lookup(Spec.replay(Hs.hist_of(st), id), j) == Spec.doc_lookup(Hs.find(Hs.store_of(st), id), j) : Maybe<Maybe<Nat>>}

# ---- omit ----

# CLAIM: a key the omit option lists never reaches history: no command records it in an entry's
# document or patch.
law omitted_never_recorded:
  for +c: Hs.Cfg
  for +keys: +List<Nat>
  for +i: Bool
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for cmd: Hs.Cmd
  for +k: Nat
  for -m: {Hs.mem(keys, k) == True{} : Bool}
  for -q: {Spec.hist_mentions(hist, k) == False{} : Bool}
  {Spec.hist_mentions(Hs.hist_of(Hs.step_with(c, Hs.Omit{keys, i}, Hs.S{store, hist, evs}, cmd)), k) == False{} : Bool}

# CLAIM: an update that changes only omitted keys records no history entry and emits no event.
law omit_only_change_silent:
  for +c: Hs.Cfg
  for +keys: +List<Nat>
  for +i: Bool
  for +store: +List<Hs.Rec>
  for +hist: +List<Hs.Hist>
  for +evs: +List<Hs.Ev>
  for +id: Nat
  for +doc: +List<P.Entry>
  for +old: +List<P.Entry>
  for +f: Hs.Flags
  for e: {Hs.find(store, id) == {Some{old} : Maybe<+List<P.Entry>>} : Maybe<+List<P.Entry>>}
  for -d: Spec.Distinct(Hs.strip(keys, old))
  for s: {Hs.strip(keys, old) == Hs.strip(keys, doc) : +List<P.Entry>}
  {Spec.records(Hs.step_with(c, Hs.Omit{keys, i}, Hs.S{store, hist, evs}, Hs.Update{id, doc, f})) == Hs.S{[], hist, evs} : Hs.State}

# CLAIM: with fields omitted (and _id kept), replaying a document's history gives the stored document
# without its omitted fields, key by key. History is on and no switch is set.
law replay_matches_omitted_store:
  for cmds: List<Hs.Cmd>
  for -dc: Spec.AllDistinct(cmds)
  for -nf: Spec.NoSwitches(cmds)
  for +ev: Bool
  for +keys: +List<Nat>
  for +id: Nat
  for +j: Nat
  st = Hs.run_with(cmds, Hs.Cfg{True{}, ev}, Hs.Omit{keys, False{}}, Hs.empty())
  {Spec.doc_lookup(Spec.replay(Hs.hist_of(st), id), j) == Spec.doc_lookup(Spec.doc_strip(keys, Hs.find(Hs.store_of(st), id)), j) : Maybe<Maybe<Nat>>}
