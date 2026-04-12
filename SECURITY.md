# Security Policy

## Supported Versions

Security fixes are issued only for the latest `3.x` release line. Older
major versions (`1.x`, `2.x`) are no longer maintained — upgrade to `3.x`
if you need a security fix.

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | :white_check_mark: |
| 2.x     | :x:                |
| 1.x     | :x:                |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Report vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/ilovepixelart/ts-patch-mongoose/security/advisories/new)
form. This routes the report directly to the maintainer through a private
advisory and keeps the details out of the public issue tracker until a fix
is available.

When reporting, please include:

- The affected version(s) of `ts-patch-mongoose`
- A minimal reproduction (schema, plugin options, query, observed vs
  expected behavior)
- The impact you believe the issue has (data integrity, information
  disclosure, denial of service, etc.)

## Response Expectations

- **Acknowledgement:** within 7 days of the report.
- **Triage and fix window:** targeted within 30 days for confirmed issues,
  depending on severity and complexity.
- **Disclosure:** coordinated via the GitHub advisory. A CVE will be
  requested where applicable, and a patched release will be published to
  npm with provenance attestations before the advisory is made public.

## Scope

In scope:

- The `ts-patch-mongoose` plugin source in this repository.
- The published tarball on npm (`ts-patch-mongoose`).

Out of scope:

- Vulnerabilities in `mongoose` itself — report those to the
  [mongoose project](https://github.com/Automattic/mongoose/security).
- Vulnerabilities in development-only dependencies listed under
  `devDependencies` — those do not ship in the published package.

## Supply Chain

- `ts-patch-mongoose` has **zero runtime dependencies**. The only
  third-party code reaching consumer projects is `mongoose` itself
  (declared as a peer dependency).
- Releases from `3.1.3` onward are published to npm with
  [provenance attestations](https://docs.npmjs.com/generating-provenance-statements)
  linking the tarball back to the exact GitHub Actions run that built
  it — emitted automatically via `publishConfig.provenance: true`.
  Consumers can verify with `npm audit signatures` (built into npm,
  no extra install).
- Every build additionally produces a **GitHub-native artifact
  attestation** via
  [`actions/attest@v4`](https://github.com/actions/attest) (Sigstore
  keyless OIDC → SLSA v1.0 build provenance stored in GitHub's
  attestation store). The advanced verification path for consumers
  is:

  ```bash
  gh attestation verify ts-patch-mongoose-X.Y.Z.tgz \
    --repo ilovepixelart/ts-patch-mongoose \
    --signer-workflow ilovepixelart/ts-patch-mongoose/.github/workflows/publish.yaml
  ```

  `gh attestation verify` is built into the `gh` CLI — no extra
  tooling install required — and the `--signer-workflow` flag pins
  verification to the exact workflow file that produced the
  attestation, blocking any other workflow in the repository from
  signing acceptable attestations.
- The publish pipeline runs as two jobs, `build → publish`. Every
  action in every workflow is **SHA-pinned** — there are no tag-pin
  exceptions anywhere. (The previous pipeline used
  `slsa-framework/slsa-github-generator`, which could not be
  SHA-pinned because `generate-builder.sh` rejected commit-SHA refs.
  Migrating to `actions/attest@v4` removed that exception.)

## OpenSSF Scorecard — Accepted Findings

The project runs [OpenSSF Scorecard](https://securityscorecards.dev/) on a
weekly schedule (see `.github/workflows/scorecard.yaml`). The following
checks intentionally stay below their maximum score; the rationale is
documented here so future reviewers understand why they are not bugs to
chase:

- **`Code-Review`** — Scorecard requires that recent commits be approved
  by a reviewer distinct from the author. `ts-patch-mongoose` has a single
  active maintainer, so every change is inherently self-merged. Requiring
  approvals would either block all work or force fake approvals. We rely
  on automated gates (CI status checks, CodeQL, Scorecard, SonarCloud,
  Socket, Biome, type checks) to catch issues instead of human review.

- **`Contributors`** — Scorecard wants contributors from 3+ distinct
  organizations in the last 30 commits. As a personal project this is
  structurally unattainable; the score will move organically if external
  contributors join.

- **`CII-Best-Practices`** — tracked at
  [bestpractices.dev/projects/12473](https://www.bestpractices.dev/en/projects/12473).
  The project targets the "passing" tier; "silver" and "gold" require
  multiple reviewers and documented security-review processes that are
  out of reach for a single-maintainer project.
