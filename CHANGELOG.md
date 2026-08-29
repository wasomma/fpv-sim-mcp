# Changelog

All notable changes to fpv-sim-mcp are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and match the `version` field in
`package.json`. The engine's behavior contract is exact parity with
upstream [fpv-sim](https://github.com/wasomma/fpv-sim) — any release that
regenerates the golden fixtures against a new upstream commit says so
explicitly and records the commit in `docs/upstream/SNAPSHOT.md`.

## [Unreleased]

Engine sync with upstream's bounded hunter search (fpv-sim PR #28, upstream
commit `d215c70`): a Behavior-changing upstream fix, so the golden fixtures
regenerate against that commit. Orbit behavior is unchanged — the orbit
set's runs regenerate byte-identically and only its `_meta` pin advances;
in the tactical set only seed 5 differs (the same BLUFOR search-recovery
kill, 8.8 s later, plus the new search-start log line). Parity re-verified
against the vm-run browser sim over seeds 1–500, both modes,
float-for-float.

### Added
- **Consumable as a git dependency.** `"prepare": "npm run build"` builds
  `dist/` automatically when the package is installed from a git URL
  (`npm install github:wasomma/fpv-sim-mcp#<sha>`), a new `"./server"`
  export exposes `buildServer()`/`SERVER_VERSION` (the composition point
  for hosts that register extra tools on the same server), and
  `test/fixtures` ships in the package so downstream consumers — the
  planned fpv-sim-app desktop host — can run an engine-parity smoke test
  against the committed goldens. No engine or tool changes.

### Changed
- **Bounded terminal search and AO-edge-aware steering**, mirroring
  upstream `index.html`: a no-joy terminal search is now an expanding
  orbit around the live fix — radius steps `SEARCH_RING_M` (170 m, inside
  visual range) per revolution at `SEARCH_MPS` (24 m/s), bounded to
  `SEARCH_CEP_MULT` (2×) the current CEP within [`ACQ_RANGE_M`,
  `SEARCH_MAX_R_M`], re-sweeping from the center on a completed no-joy
  pattern, with the search start logged (`AT FIX NO VISUAL // COMMENCING
  EXPANDING SEARCH`) — instead of an unbounded spiral (+22 m/s forever)
  that left a missed hunter riding the world-edge clamp around the whole
  AO. `steerToward` now confines every commanded steering point
  `EDGE_MARGIN_M` (150 m) inside the AO and takes the sim context instead
  of a bare turn rate. `TERMINAL_SEARCH_GROW` is retired; the five new
  `DRONE` knobs join the parameter table, validation and
  `get_config_schema`; `describe_model`'s drone-behavior text matches the
  new code.

### Docs
- `docs/upstream/DESIGN_NOTES.md` re-synced to upstream `e597c83`
  (SNAPSHOT.md pin advanced): the TERMINAL bullet now describes the
  bounded search, the steering paragraph the edge confinement, the
  tactical hunter paragraph drops its stray "outward spiral" (upstream
  PR #29), plus the OBJ TANTO naming note upstream added since
  `843a2c5`. The fixtures' own pin stays at `d215c70`, the commit whose
  `index.html` they were generated from — #29 was docs-only.

## [0.3.0] — 2026-08-18

The tactical-mode port: the engine now covers both of upstream's engagement
plans. Orbit-mode behavior is unchanged — the orbit fixtures regenerate
byte-identically (their `_meta.source_commit` pin advances to upstream
`843a2c5`, the commit that introduced tactical mode without touching orbit
behavior).

### Added
- **Tactical mode** in the engine (`src/engine/tactical.ts` plus a
  `mode: "orbit" | "tactical"` argument on `Simulation` / `runEngagement`,
  mirroring the browser's `resetSim(seed, mode)`): the multi-FPV sortie
  stream — per-seed launch plans and aim points, per-airframe EMCON keying,
  the pilot-station launch scheduler with commit holds, the strike/hunter
  FSM sharing the orbit attack run, and the sim's own STALEMATE end state
  (outcome reason `packages_expended`). Both modes share every RNG draw
  through emplacement; tactical results add the objective, per-airframe
  package state, sortie tallies and the killer id.
- **`mode` input on the tools**: `run_engagement`, `sweep_seeds` and
  `compare_configs` accept `mode` ("orbit" default); `TACTICAL.*` overrides
  (package size, pilot stations, reserve-or-retask, launch spacing,
  objective geometry — including the boolean `RESERVE_HUNTER`) join the
  validated parameter table and `get_config_schema`; `describe_model` gains
  a `tactical_mode` section; sweeps over tactical results add per-side
  `strikes_delivered` distributions.
- **Second golden-fixture set** (`test/fixtures/golden-seeds-tactical.json`,
  the six featured tactical seeds) with matching golden-master tests, and
  tactical coverage in the fixture generator. Parity for the port was
  additionally cross-checked against the vm-run original browser sim over
  seeds 1–500: outcomes, event logs, fix floats and per-airframe positions
  all match exactly, reproducing the documented 27% / 15% / 58% split.

### Changed
- CI: the `upstream-drift` gate now regenerates and compares BOTH fixture
  sets, so a tactical-behavior change upstream (or an engine regression in
  either mode) is caught the same way orbit drift always was.

### Docs
- README, DESIGN_NOTES.md and the pinned `docs/upstream/DESIGN_NOTES.md`
  copy re-synced for the two-mode era (`SNAPSHOT.md` pin: `843a2c5`).

## [0.2.3] — 2026-08-16

No engine or tool behavior changes; golden fixtures unchanged. CI and
docs only: the upstream-drift parity check now runs on every pull request
and is a required status check on `main` (paired with fpv-sim's new
`parity` workflow, so the two repos cannot diverge at merge time), and
`describe_model` / the pinned DESIGN_NOTES copy are corrected against the
code.

### Docs
- `describe_model` text (`src/server/model.ts`) corrected to match the
  code, in step with upstream fpv-sim's DESIGN_NOTES.md fix (fpv-sim
  PR #20): `pathAtten` samples 13 interior points and tops out near 3.9
  (the cap of 6 is never reached); WLS weights floor range at 300 m; the
  geometry-penalty cut angle is between the two strongest sensors'
  bearings *to the current estimate*, not their mean LOBs; the terminal
  search is an outward spiral, not an "expanding search" of unspecified
  shape; and the determinism entry names every main-stream consumer
  (including the display-only enemy-drone track noise) and the derived
  terrain streams. Two engine comments (`fix.ts`, `drone.ts`) that had
  inherited the upstream "mean bearings" / "expanding-square" wording are
  corrected — comments only, no code change; goldens unchanged.
- `docs/upstream/DESIGN_NOTES.md` re-synced to upstream `74b161a`
  (`SNAPSHOT.md` updated; that pin is the design-notes copy, distinct
  from the fixtures' `_meta.source_commit`).

### Changed
- CI: `upstream-drift` workflow bumped `actions/checkout` and
  `actions/setup-node` from v4 to v5 (Node 24 action runtime), clearing
  GitHub's Node 20 deprecation warning. The workflow still tests on
  Node 20, the package's stated minimum; setup-node v5's automatic
  package-manager caching does not engage because `package.json` has no
  `packageManager` field.
- CI: `upstream-drift` now also runs on every pull request and on push
  to `main`, so a PR whose engine no longer reproduces the committed
  fixtures, or whose fixtures no longer match live upstream fpv-sim
  `main`, shows a red check before it merges instead of failing the
  weekly run afterwards. The weekly schedule and manual dispatch remain
  for catching upstream movement while this repo is quiet. Paired with
  fpv-sim's new `parity` workflow (which regenerates these fixtures from
  a PR's `index.html` on that side), divergence between the two repos
  surfaces at merge time on whichever side changes.
- CI: the `drift` job is now a required status check on `main`
  (repository ruleset "main: require upstream-drift", no bypass actors),
  so a red `upstream-drift` run blocks the merge outright rather than
  merely flagging it. Repo setting, recorded here so it isn't invisible:
  renaming the job requires updating the ruleset's required context.

## [0.2.2] — 2026-08-16

No engine or tool behavior changes; golden fixtures unchanged. Dependency
hygiene only.

### Security
- `npm audit fix` (no `--force`): four transitive dependencies of
  `@modelcontextprotocol/sdk` bumped within their existing semver ranges
  to clear all reported advisories — `hono` 4.12.31 → 4.13.2 (ReDoS in
  CORS middleware, SSR `memo()` cross-request retention, proxy-helper
  `Connection` header handling, language-middleware complexity),
  `@hono/node-server` 1.19.14 → 1.19.17 (`serve-static` path traversal
  on Windows), `fast-uri` 3.1.4 → 3.1.5 (host confusion via backslash
  authority), `ip-address` 10.2.0 → 10.5.0 (leading-zero / CIDR /
  IPv4-mapped misclassification enabling SSRF bypasses). None of these
  code paths are exercised by this server (it uses `node:http` directly
  and the SDK's Streamable HTTP transport, no CORS/static/proxy
  middleware), so this is hygiene, not a fix for an exposure. SDK stays
  at 1.29.0; no dependency ranges changed. `npm audit` is clean
  afterwards.

## [0.2.1] — 2026-08-16

No engine or tool behavior changes; golden fixtures unchanged.

### Changed
- **Relicensed from MIT to PolyForm Strict License 1.0.0**
  ([LICENSE.md](LICENSE.md)): the repository stays public to read and
  use noncommercially, but is no longer open source — no modification,
  redistribution, or commercial use. Copies obtained under MIT before
  this change retain their MIT rights.

### Fixed
- The version the server reports (MCP `initialize` handshake, `/healthz`,
  startup banner) is now read from `package.json` instead of a hardcoded
  constant in `src/server/build.ts`, which had silently stayed at `0.1.0`
  through the 0.2.0 release — so the hosted demo's `/healthz` could not
  confirm a redeploy. `package-lock.json` had likewise never been bumped
  past 0.1.0; `npm version` now keeps it in step. A new test
  (`test/version.test.ts`) asserts the reported version equals
  `package.json`'s.

### Docs
- `deploy/DEPLOY.md` "Updating" now ends with a `/healthz` version check —
  the redeploy confirmation the fix above makes meaningful.
- Release tags `v0.1.0` and `v0.2.0` now exist (published 2026-08-16),
  so the compare links below use tag form. The `[0.2.0]` range
  previously ended one merge early (at PR #3 rather than the PR #4 merge
  that carried the version bump); corrected.

## [0.2.0] — 2026-07-23

### Added
- **Upstream drift detection** (`.github/workflows/upstream-drift.yml`):
  weekly CI that regenerates the golden fixtures from live fpv-sim `main`
  and fails if engagement outcomes differ from the committed ones —
  distinguishing engine regressions (`npm test`) from upstream
  behavior changes (fixture comparison). Also warns when the pinned
  design-notes snapshot falls behind upstream.

### Fixed
- `npm test` now works on Node 20, the stated minimum: the test glob is
  shell-expanded instead of relying on `node --test` pattern expansion,
  which only Node 21+ performs. Caught by the drift workflow's first CI
  run.

### Docs
- README example transcript: added a postscript correcting the agent's
  closing guess that the 6-second launch stagger explained the residual
  BLUFOR edge — a 2,000-pair study on this engine
  ([fpv-sim's MONTE_CARLO.md](https://github.com/wasomma/fpv-sim/blob/main/MONTE_CARLO.md),
  experiment E2c) found the stagger moves outcome rates by less than half
  a point.

## [0.1.0] — 2026-07-21

### Added
- Initial release: headless TypeScript engine extracted from fpv-sim's
  `index.html` with float-exact behavior parity, proven by golden-master
  fixtures generated from the original browser source running in a Node
  `vm` (plus a real-browser cross-check).
- MCP server with five read-only, deterministic tools (`run_engagement`,
  `sweep_seeds`, `compare_configs`, `describe_model`, `get_config_schema`)
  and two documentation resources, with zod validation generated from the
  same parameter table as the schema tool.
- Stdio and Streamable HTTP transports, an MCP client demo
  (`npm run demo`), a VPS deployment runbook (`deploy/`), and the
  golden-fixture generator (`scripts/generate-goldens.mjs`).
- Headless-only additions to the sim's semantics: guaranteed termination
  (winner, both-drones-down, or 3600 s cap — the latter two reported as
  first-class `STALEMATE` outcomes) and flag timestamps for aggregation.

[Unreleased]: https://github.com/wasomma/fpv-sim-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/wasomma/fpv-sim-mcp/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/wasomma/fpv-sim-mcp/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/wasomma/fpv-sim-mcp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/wasomma/fpv-sim-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/wasomma/fpv-sim-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wasomma/fpv-sim-mcp/releases/tag/v0.1.0
