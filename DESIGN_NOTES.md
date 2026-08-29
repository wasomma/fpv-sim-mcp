# Design Notes — fpv-sim-mcp

How the browser simulation became a headless engine and an MCP server, and
why the interface looks the way it does. For the simulation model itself
(terrain, RF, DF fix math, drone behavior), see the original write-up in
[fpv-sim's DESIGN_NOTES.md](https://github.com/wasomma/fpv-sim/blob/main/DESIGN_NOTES.md)
— served by this project as the `fpv-sim://design-notes` resource.

## Goals

1. **Behavior parity, not reimplementation.** The engine must produce the
   *identical* engagement for a given seed as the browser file — the original
   is the specification, and its featured scenarios (five orbit-mode, six
   tactical-mode) are the acceptance test.
2. **Agent-shaped interface.** Tools sized for how an agent actually works:
   statistics first, drill-down second, model assumptions on demand.
3. **Reproducibility as a feature.** Every tool result must be reproducible
   by anyone from (seed, overrides) alone.

## Extraction approach

The original `index.html` holds one `<script>` block where simulation,
rendering, and UI interleave. The extraction boundary is exact: everything
from `CONFIG` through the end of the `TACTICAL MODE` section (i.e. before
`RENDERING`) is simulation; everything after is rendering/UI and was left
behind. The port mirrors the original's structure module for module —
`sensing.ts` / `drone.ts` hold the shared collectors and the attack run
exactly as upstream extracted them, `tactical.ts` is the `TACTICAL MODE`
section — so a reader can diff the two side by side.

### Two modes, one seed

`Simulation(seed, overrides, mode)` selects the engagement plan the way
upstream's `resetSim(seed, mode)` does: `"orbit"` (the original, and the
default whenever the mode is omitted) or `"tactical"` (the multi-FPV sortie
stream into OBJ TANTO). Both share the RNG stream through the emplacement,
so a seed gives the same terrain and unit positions in either; tactical mode
then draws its objective jitter and per-airframe plan, and its own scan
order follows. Nothing in `tactical.ts` runs — or draws — in orbit mode, and
the orbit code paths are byte-for-byte what they were before the mode
existed (the orbit fixtures regenerated identically when the mode landed).

### Preserved verbatim

- All CONFIG values, event-log message strings, and phase labels.
- All modeling comments (why DF baselines are perpendicular to the threat
  axis, why covariance is residual-inflated, why the fix gates exist, the
  bingo-fuel rationale...). These are the sim's intellectual content; they
  moved with their code.
- Floating-point expression order. JavaScript doubles are deterministic, so
  identical expression order in Node/V8 yields bit-identical results to the
  browser — which is what makes float-exact parity testing possible at all.
- **RNG draw order**, the real determinism contract. All engagement
  randomness draws from one `mulberry32(seed)` stream in a fixed order:
  team EMCON phase offsets (2 draws × 2 teams) → emplacement jitter (4 GCS
  draws, 8 node draws) → [tactical mode: objective jitter (2), then per
  team per strike airframe its uplink/video phase (2), aim point (2 gauss)
  and launch-spacing jitter (1)] → per-scan detection rolls and Box–Muller
  bearing noise (variable draws — the zero-rejection loops are part of the
  contract). The engine keeps every call site in the original sequence;
  `src/engine/rng.ts` documents the rule.

### Refactored

| Change | Why it cannot affect behavior |
|---|---|
| Browser globals (`state`, `world`, `rng`) → `Simulation` instance fields | Mechanical move; enables concurrent MCP calls with zero shared mutable state |
| `addLog()` DOM rows → structured `{t, side, text}` events | Original only wrote DOM; message text is preserved verbatim (and is part of the parity test) |
| `buildWorld()` no longer calls the terrain renderer | The renderer drew from its own independent RNG stream (`seed+909`) that fed pixels only |
| Visual state dropped: RF pulses, breadcrumb trails, explosion markers, hit-testing, the end card | None of it touches the RNG or is read back by simulation code (verified call site by call site) |
| Dead code dropped: `lawnmower()` (never called — a leftover from a pre-HOLD search design), unused `flags.terminal` | Dead |
| `emconLabel` derived (`videoOff === 0` → CONTINUOUS) instead of stored | Reproduces the stock labels exactly; stays truthful under overrides |
| `Team.drone` is `null` in tactical mode (the package is `Team.drones`) | Mirrors upstream (`T.drone = null` in `setupTactical`); orbit paths never run in that mode |

### Headless additions (not in the browser version)

- **Termination.** The browser ticks until a human closes the tab. Headless
  runs end on winner, on the engagement being unable to change — orbit:
  *both drones down*; tactical: the sim's own `ENDEX // STALEMATE` (both
  packages expended, no hunter can launch; reason `packages_expended`) — or
  at a 3600 s cap, the latter reported as `STALEMATE` with a reason.
  Stalemates are ~30–35% of random orbit seeds (matching the original
  development history's finding) and ~58% of tactical ones, and are a
  first-class outcome in every statistic.
- Flag timestamps (`fix_established_t_s`, `commit_t_s`, ...) so aggregation
  never parses log text. In tactical mode `commit_t_s` is the hunter-killer
  launch.
- A phase-transition timeline.
- Tactical mode: the per-team `tactical` result block (sorties flown,
  strikes delivered, the hunter's fate, every airframe's end state) and the
  `objective`.

## Determinism parity: how it is verified

Three legs, each catching a different failure:

1. **Fixture generation** (`scripts/generate-goldens.mjs`): the *original*
   `<script>` source is executed headless in a Node `vm` with all DOM/canvas
   globals replaced by an inert proxy, and `addLog` swapped for an event
   collector after load. Both interventions are provably outside the sim
   state/RNG path. The featured seeds of both modes (five orbit, six
   tactical, each run tagged with its `mode`) → one file,
   `test/fixtures/golden-seeds.json` (committed, pinned to the upstream
   commit). One file, because both repos' CI gates (`upstream-drift` here,
   `parity` in fpv-sim) compare that file's `runs` verbatim — so the
   tactical runs are under the same gate as the orbit ones with no
   workflow change.
2. **Golden-master tests** (`test/golden.test.ts`): the engine must
   reproduce each fixture *exactly* — event logs string-equal, end times
   tick-equal, LOB counts integer-equal, CEPs, positions and (tactical)
   every airframe's state float-equal. No epsilons.
3. **Real-browser cross-check**: the untouched live page
   (wasomma.github.io/fpv-sim) driven to completion through its own
   `stepSim` loop produced, for seed 20260719: BLUFOR victory at T+311.1 s,
   23/9 LOBs, CEP 116.86454478829876 m — float-for-float identical to leg 1's
   fixture. This proves the DOM-stub harness didn't perturb the sim it
   recorded.

Policy: if a golden test fails, the engine is wrong — fixtures are only
regenerated when upstream itself changes, together with the new commit hash
in `docs/upstream/SNAPSHOT.md`.

## MCP interface design

### Why these five tools

They map onto the agent workflow end to end: ground yourself
(`describe_model`), construct a valid experiment (`get_config_schema`), run
it (`sweep_seeds` / `compare_configs`), drill into specifics
(`run_engagement`). The sweep results deliberately include `notable_seeds`
so the statistical tools hand the agent its next `run_engagement` call.

### Why `mode` is a tool argument, not a config override

The two air plans are different scenarios with different result shapes
(one drone vs a package; the tactical stalemate), not a number in the
same experiment. So `mode` sits beside `seed` on the three run tools and
defaults to `"orbit"`, `compare_configs` runs both variants in the same
mode (a doctrine comparison across plans is two sweeps, not one paired
run), and the `TACTICAL.*` overrides are validated in every mode but read
only in tactical mode — `get_config_schema` says so.

### Why aggregation lives server-side

A 200-seed sweep returned raw is ~500 KB of event logs an agent would have
to page through and re-derive means from; the statistics it actually reasons
over fit in ~1 KB and are deterministic arithmetic. The same goes for
`compare_configs`: the pairing (same seeds under both variants) is an
experimental-design decision the server should own, because it is what makes
a few hundred seeds resolve real effects — per-seed terrain and emplacement
luck cancels out of the delta. The plain-language `summary` string is
template-generated from the computed statistics only.

### Validation as documentation

One table (`src/server/params.ts`) holds every tunable's default, unit,
range, and description. The zod validators and the `get_config_schema`
payload are both generated from it, so what the server *says* it accepts and
what it *actually* accepts cannot drift. Out-of-range input returns the
offending path and allowed range — an agent can self-correct from the error
alone. `WORLD_M` and `SIM_DT` are deliberately not overridable: emplacements
are absolute coordinates tuned to the 4000 m box, and the fixed 0.1 s tick is
part of the determinism contract; likewise the tactical objective's position
(it sits between the fixed emplacements) and name (a label in the event
text). The table is numeric except `TACTICAL.RESERVE_HUNTER`, a boolean.

### Resources

`fpv-sim://design-notes` serves the original technical write-up from a live
sibling checkout (`../fpv-sim`) when present, else from the pinned snapshot
in `docs/upstream/` — a standalone clone of this repo stays fully
functional. `fpv-sim://mcp-design-notes` serves this document.

## Performance envelope

One engagement ≈ 25 ms (dominated by the 200×200 terrain build). Caps:
`sweep_seeds` ≤ 1000 (~25 s), `compare_configs` ≤ 500 pairs (~25 s) — inside
common MCP client timeouts with margin.

## Known limitations

- All modeling simplifications of the original sim are inherited unchanged
  (sense-only cUAS, cosmetic frequencies, planar geometry, one sortie per
  side in orbit mode / a fixed package with nothing shooting back on the
  objective in tactical mode — see the upstream design notes).
- The engine is single-threaded; large paired comparisons run serially.
- `config_overrides` cannot move unit emplacements or the NAI boxes; the
  scenario geometry is part of what the seed reproduces.
