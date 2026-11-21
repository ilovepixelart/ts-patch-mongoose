# AGENTS

When using Bend:
- run `bend guide` to learn it
- use `laws/LAWS.bend` to keep important rules
- run `npm run laws` before committing (`bend laws/PROOF.bend` checks the proofs only)

The laws of this library are in `laws/`: what they cover, how to change them and what the gate
checks is in [CONTRIBUTING.md](CONTRIBUTING.md#laws). Do not edit `laws/LAWS.bend` or `laws/SPEC.bend`
to make a proof pass: a law that stops holding is a finding to report, not an obstacle.
