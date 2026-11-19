# Claims: the rest of the contract, stated but not yet proven. Each holds on the models in the
# oracle tests (tests/laws/) and is checked against the real plugin; once PROOF.bend proves one, it
# moves to LAWS.bend.

import Base
import ./patch.bend as P
import ./chunk.bend as C
import ./omit.bend as O
import ./history.bend as Hs
import ./SPEC.bend as Spec

# CLAIM (the contract): applying the diff of a and b to a gives a document that agrees with b on every key.
law apply_diff_roundtrip:
  for +a: +List<P.Entry>
  for +b: +List<P.Entry>
  for -db: Spec.Distinct(b)
  for +j: Nat
  {P.lookup(P.apply(P.diff(a, b), a), j) == P.lookup(b, j) : Maybe<Nat>}

# CLAIM: a document diffed against itself gives no operations.
law diff_self_empty:
  for +a: +List<P.Entry>
  for -da: Spec.Distinct(a)
  {P.diff(a, a) == {[] : List<P.Op>} : List<P.Op>}

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

# CLAIM: the stored documents depend on the commands only: never on the configuration, the switches,
# the history or the events.
law store_independent:
  for cmds: List<Hs.Cmd>
  for +c: Hs.Cfg
  for st: Hs.State
  {Hs.store_of(Hs.run(cmds, c, st)) == Spec.store_run(cmds, Hs.store_of(st)) : +List<Hs.Rec>}

# CLAIM: with patch history disabled, no command writes history.
law disabled_writes_no_history:
  for cmds: List<Hs.Cmd>
  for +ev: Bool
  for st: Hs.State
  {Hs.hist_of(Hs.run(cmds, Hs.Cfg{False{}, ev}, st)) == Hs.hist_of(st) : +List<Hs.Hist>}

# CLAIM: with no events configured, no command emits one.
law unconfigured_emits_nothing:
  for cmds: List<Hs.Cmd>
  for +h: Bool
  for st: Hs.State
  {Hs.evs_of(Hs.run(cmds, Hs.Cfg{h, False{}}, st)) == Hs.evs_of(st) : +List<Hs.Ev>}
