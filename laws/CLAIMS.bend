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
