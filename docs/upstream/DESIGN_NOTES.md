# Design Notes

Technical documentation for `index.html`, reconstructed from the code and its
inline comments. Line references are approximate and drift as the file evolves;
section names in the code (`/* --- TERRAIN --- */` etc.) are stable anchors.

## Goals and constraints

- **Single file, no dependencies.** The deliverable had to open from a browser
  tab or email attachment with nothing to install — it was built for customer
  demonstrations, not for a lab. Everything (styles, markup, simulation,
  rendering) is inline. It runs from `file://` and makes zero network calls.
- **Deterministic.** Same seed → identical engagement, tick for tick. This is
  what makes "featured scenarios" possible: a seed whose outcome teaches the
  right lesson can be bookmarked in the dropdown and replayed on demand in
  front of an audience.
- **Honest uncertainty.** The centerpiece visual is the error ellipse. The fix
  math is deliberately conservative (see *Fix quality gating* below) so the
  displayed CEP behaves believably — it shrinks with good geometry and balloons
  with bad geometry, rather than collapsing optimistically.
- **Notional but shaped by doctrine.** Symbology is MIL-STD-2525-inspired
  (rectangles for friendly ground units, diamonds for hostile, arc/caret frames
  for air). The event log mimics message traffic. Numbers (speeds, ranges,
  duty cycles) are plausible-magnitude fiction, not measured data.

## Architecture

One `<script>` block, organized top-down:

| Section | Responsibility |
|---|---|
| `CONFIG` | Every tunable in one object: drone kinematics, DF sensor model, fix gates, per-team EMCON |
| RNG helpers | `mulberry32` seeded PRNG, Box–Muller `gauss()`, angle/bearing utilities |
| Terrain | Seeded value-noise elevation + canopy grids, clearings, a trail, coastline |
| Terrain render | Offscreen canvases: hillshaded elevation layer + canopy overlay, drawn once per seed |
| RF propagation | `pathAtten()` — terrain blocking + canopy loss along the sensor→emitter path |
| Sim state | `state`, `makeTeam()`, `makeDrone()`, `resetSim(seed, mode)` — shared emplacement, then the mode's air plan |
| Emissions | `uplinkActive()` / `videoActive()` — EMCON duty-cycle logic (orbit mode) |
| DF collect & fix | `collectUplinkLOBs()` / `collectDownlink()` (one scan of intercepts → LOBs / a drone track; both modes), `doScans()` (orbit mode), `updateFix()` (weighted least squares; both modes) |
| Drone FSM | `stepDrone()` — STANDBY → TRANSIT → HOLD → COMMIT → TERMINAL → IMPACT (orbit mode); `attackGuidance()` — the COMMIT/TERMINAL attack run, both modes |
| Master step | `stepSim()` — fixed 0.1 s physics tick, phase tracking, end-of-match (dispatches to `stepSimTactical()` in tactical mode) |
| Tactical mode | `setupTactical()`, `uplinkActiveTac()` / `videoActiveTac()`, `doScansTactical()`, `stepTeamTactical()` (launch scheduler + hunter commit), `stepDroneTactical()`, `stepSimTactical()`, `endOfMatchTactical()` — see *Tactical mode* below |
| Rendering | `draw()` and per-layer draw functions, world→screen transform |
| UI | Detail panel, event log, click-to-select hit testing, controls (mode switch, per-mode featured scenarios), main rAF loop |

The main loop decouples wall clock from sim time: real frame time × playback
speed accumulates into a bucket that is drained in fixed `SIM_DT = 0.1 s`
steps (with a guard against spiral-of-death). Rendering runs every animation
frame regardless of sim rate.

## The scenario

Two symmetric teams on a 4000 m × 4000 m map. Each team has:

- **1 GCS** (ground control station) — the drone operator's position and the
  C2 uplink emitter. Also each side's *target*.
- **2 cUAS DF nodes** — passive RF direction-finders. Emplaced with a wide
  baseline **perpendicular to the expected threat axis** (the code comments
  call this out explicitly): separating the collectors in northing gives
  well-crossed LOBs instead of two look angles down nearly the same bearing.
- **1 armed FPV sUAS** with a kinetic payload and ~20 min of battery.

BLUFOR sets in on the western side, OPFOR in the eastern interior short of the
coast, each unit with ±60 m emplacement jitter per axis per seed
(`(rng() - 0.5) * 120`, so a 120 m spread; and a nudge-west guard so nothing
spawns in the water). Each side has a named area of interest (NAI)
around the suspected enemy position that drives its drone's holding point.

### The one asymmetry: EMCON

```
BLUFOR: uplink 4 s on / 13 s off, video 3 s on / 7 s off  → "INTERMITTENT"
OPFOR:  uplink 10 s on / 4 s off, video continuous        → "CONTINUOUS"
```

Everything else — sensors, drones, fix math — is identical. OPFOR also
launches 6 s later. Continuous video is the big giveaway: per-scan detection
probability against the FPV downlink (0.65) is much higher than against the
uplink (0.40), so an always-on video emitter feeds the enemy a steady drone
track, and its longer uplink duty cycle feeds the GCS fix. This is the whole
argument of the demo expressed as four numbers in `CONFIG.TEAMS`.

Exception in `videoActive()`: during COMMIT and TERMINAL the attacker needs
eyes on, so video forces on regardless of posture — realism over purity, and
it means even the disciplined side becomes loud in the endgame.

## Terrain and RF model

Elevation is three octaves of seeded value noise shaped by `pow(·, 1.35)` into
low jungle hills with a ridge spine, minus a smoothstep coastline on the east
edge and a shallow bay in the northeast. Canopy density is separate noise,
zeroed on beach/water, thinned on crests, cut by six seeded clearings and a
winding east–west trail. Both are sampled bilinearly from 200×200 grids.

`pathAtten(a, b)` samples 13 interior points along the sensor→emitter sight
line (`K = 14` subdivisions, `i = 1..13`); each sample counts toward at most
one of two terms (or neither, if the ray is clear of both terrain and canopy):

- terrain more than 2 m above the line-of-sight ray adds **hard (but not
  absolute) blocking** — the comment notes diffraction as the reason blocking
  saturates rather than going binary;
- otherwise, if the ray is below canopy top (ground + 18 m), the sample
  accumulates **soft vegetation loss** proportional to canopy density.

The result is `min(6, block/14 × 4.2 + veg × 0.14)`: 0 = clean LOS, about 3.9
with every sample blocked, about 1.8 under full canopy the whole way — the
nominal cap of 6 is never actually reached. It multiplies detection
probability via `exp(-att)` and inflates bearing error
`sig = 4.0° × (1 + 0.5·att)`. So a GCS
tucked behind a ridge under canopy is genuinely harder to detect *and* yields
sloppier bearings — terrain masking matters, which is visible in how fixes
develop differently seed to seed.

## DF collection

Every 1.5 s (`CUAS.SCAN_S`), each side's nodes roll detection against every
active enemy emitter within 3600 m:

- **C2 uplink intercepts** (LOBs terminate at the enemy GCS): base p = 0.40
  per scan, scaled by range and attenuation. Successful intercepts append a
  noisy bearing `{sensor, bearing, sigma, t}` to the team's measurement set
  (capped at 140, FIFO).
- **Video downlink intercepts** (track on the enemy air vehicle): base
  p = 0.65. These don't feed the GCS fix; they produce a fading "TRK" diamond
  on the map — situational awareness that the enemy bird is airborne.

First-intercept events are logged in message-traffic style ("INITIAL LOB 087T
// C2 UPLINK 915 MHZ // HOSTILE GCS EMITTING").

## The fix: weighted least squares with honest error

`updateFix()` is the mathematical heart of the demo.

**Measurement model.** Each LOB is treated as a line; the observable is the
target's perpendicular offset from that line, with noise
σ_perp = σ_bearing × range (range floored at 300 m so a sensor sitting
nearly on top of the estimate can't claim near-zero σ_perp). Each measurement
contributes weight w = 1/σ_perp² to a 2×2 normal-equation system; solving it
gives the least-squares intersection point. Two iterations refine the ranges
used in the weights (range depends on the answer, so iterate).

**Covariance and ellipse.** The formal covariance is the scaled inverse normal
matrix, **inflated by the residual χ²/(n−2)** so that when the small-sample
geometry makes the formal answer optimistic, the ellipse stays honest.
Eigen-decomposition gives semi-axes (drawn at 2.45σ) and orientation;
CEP ≈ 0.59(σ₁+σ₂), floored at 35 m (sensor-limited best case).

**Fix quality gating.** Raw WLS on LOBs has a classic failure mode: many looks
from one sensor plus a stray crossing LOB from another produces a
tight-*looking* solution whose along-range position actually slides freely.
Three defenses, all visible in the code comments:

1. **Participation gate** — no solve until ≥6 LOBs exist *and* the
   second-strongest collector holds ≥3 of them.
2. **Geometry penalty** — group LOBs by sensor, take the two strongest
   collectors, compute the crossing angle between the bearings *from each of
   those two sensors to the current estimate* (i.e. the geometry of the cut
   at the solution, not an average of the measured LOBs — the code comment
   says "mean bearings"; the code uses sensor→estimate bearings) and how
   balanced their LOB counts are; a lopsided or shallow-cut fix has its CEP
   divided by (angle factor × balance), inflating it toward uselessness.
3. **Jitter penalty** — the last 6 solutions are kept; if the estimate is
   still wandering (RMS scatter high), effective CEP can't be small yet.

Effective CEP = max(formal, geometry-penalized, jitter). Thresholds:
"FIX ESTABLISHED" at ≥10 LOBs and CEP < 240 m; **attack commit** at ≥12 LOBs
and CEP < 120 m.

## Drone behavior (finite-state machine)

```
STANDBY → TRANSIT → HOLD → COMMIT → TERMINAL → IMPACT
                      ↓ (GCS destroyed)     ↓ (battery/fix failure)
                  LINK LOST → DOWN        expanding search / DOWN
```

- **TRANSIT/HOLD** — launch at T+20 s (BLUFOR) / T+26 s (OPFOR), fly to a
  holding point 600 m forward of own GCS toward the NAI, then orbit at 130 m
  radius, loiter speed 12 m/s at 55 m AGL. Holding drains battery at 0.62×
  cruise — the drone is cheap to keep on station while the ground nodes work.
- **COMMIT** — triggered by the fix gate above, or by **bingo fuel**: at ≤45%
  battery the operator accepts a looser fix (CEP < 260 m) rather than expend
  the drone holding. Dash at 36 m/s toward the estimate.
- **TERMINAL** — inside 380 m of the estimate: descend to 12 m AGL (below
  canopy) at 45 m/s. Visual acquisition of the actual GCS occurs at 220 m.
  If the drone reaches the fix point without acquiring (the fix was wrong),
  it flies an **outward spiral search**: the commanded search point's radius
  grows 22 m/s while its tangential speed is held at terminal speed, giving a
  steep spiral (not repeated laps) that the drone pursues at 45 m/s outward
  from the estimate (the code comment calls it an "expanding-square"; the
  geometry is a spiral) — so a modest fix error is recovered quickly and a
  gross one burns the battery. Impact within 9 m
  destroys the GCS, ends the match, and logs ENDEX.
- **LINK LOST** — if your GCS dies while your drone flies, C2 is severed; the
  drone decays speed/altitude and is down 8 s later. This is why killing the
  GCS (not the drone) is the win condition.
- **Battery** — 1200 s endurance at cruise; 30% triggers a warning; 0% is DOWN.

Steering is a turn-rate-limited (70°/s) heading controller with rate-limited
speed and climb; movement is simple dead reckoning per 0.1 s tick.

## Tactical mode

`state.mode` selects one of two air plans on top of everything above:
`"orbit"` — the original engagement, and the default whenever `resetSim(seed)`
is called without a mode — or `"tactical"`. The Mode buttons and the
`?mode=tactical` deep link select it; the mode survives Reset / Replay /
Random, and the mode switch keeps the seed so the same emplacement can be
watched under both plans. Terrain, RF, the DF sensor model, the WLS fix and
its gates, and the terminal attack run are the same code in both modes; the
`TACTICAL MODE` section of the script holds everything else, and nothing in
it runs — or draws from the RNG — in orbit mode.

### The scenario

There is a ground fight both sides are supporting: a contested objective,
**OBJ TANTO** (`CONFIG.TACTICAL.OBJ_*`), a 260 m circle midway between the
two GCS, jittered per seed like the emplacements. Each side has a **strike
package** of `SORTIES[side]` one-way FPV airframes (default 5) plus, with
`RESERVE_HUNTER` on, one more held back as the **hunter-killer**; a GCS has
`PILOTS[side]` pilot stations (default 2), each flying one airframe on one C2
link, so at most that many can be airborne at once. The NAIs of orbit mode
are still assigned (the DF effort still hunts the enemy GCS in its NAI), but
the orbit's holding points are not computed and the orbit itself is not
flown.

The launch plan is fixed at reset: sortie 1 at `TEAMS.<side>.launchT`, then
`LAUNCH_INTERVAL_S` ± `LAUNCH_JITTER_S` (uniform) apart, each airframe with
its own EMCON phase offsets and an aim point scattered `AIM_SIGMA_M`
(Gaussian) about the objective center and clamped inside it. Launches go in
plan order when the planned time has come *and* a pilot station is free — a
busy package slips its schedule.

### Strike sortie FSM

```
STANDBY → TRANSIT (autonomous) → TERMINAL (manual) → IMPACT (expended)
                    ↓ (GCS destroyed)
                LINK LOST → DOWN
```

TRANSIT is cruise speed at transit altitude straight to the aim point;
`STRIKE_TERMINAL_M` (380 m) out the pilot takes manual control and the
airframe descends to terminal altitude at terminal speed and is expended on
the aim point (`IMPACT_RANGE_M`), incrementing the side's **delivered**
count. Battery drains at cruise rate throughout; LINK LOST works as in orbit
mode. Nothing on the objective shoots back — sorties exist to be delivered
and, above all, to *emit*.

### Emissions

`uplinkActiveTac()` keys the GCS uplink if any linked airframe needs it:
continuously for one under manual control (COMMIT or TERMINAL), else in that
airframe's window of the team's uplink duty cycle (`uplinkOn`/`uplinkOff`,
per-airframe phase). With nothing airborne the GCS is silent. So the uplink
is the OR of the package's schedules, plus ~10 s of continuous keying per
sortie for the terminal run — the more a side flies, the more its GCS emits.
`videoActiveTac()` is per airframe: continuous posture (`videoOff === 0`),
manual control, or the airframe's burst window. The DF scan
(`doScansTactical()`) is the orbit scan generalized: `collectUplinkLOBs()`
against the enemy GCS when its uplink is up, then `collectDownlink()` against
every enemy airframe whose video is up, keeping one track per airframe in
`T.tracks`. The fix code is untouched.

### The hunter-killer

`stepTeamTactical()` launches the hunter when the team's fix on the enemy GCS
meets the orbit-mode **commit gate** (`fixed`, ≥ `MIN_LOBS_COMMIT` LOBs, CEP
< `COMMIT_CEP_M`), or — once the strike package is expended (every strike
airframe launched, none airborne) with no emitter left to draw the enemy's
attention — as a **final push** on the best fix held (CEP < `PUSH_CEP_M`),
the bingo-fuel commit by another route. The hunter is the reserve airframe,
or, with `RESERVE_HUNTER` off, the next unflown strike airframe *retasked*
(it still counts as a sortie flown; if the package is already spent, no
hunter is possible). It needs a pilot station: if every one is flying a
sortie the commit **holds** (logged once per hold) until one frees, and the
hunter then takes priority over the next strike launch; if the fix loosens
back above the gate while the stations are busy, the hold is lifted. From
launch it runs `attackGuidance()` — the same COMMIT dash, TERMINAL descent,
visual acquisition, outward spiral and impact as the orbit drone — against
the live fix. Impact destroys the enemy GCS, sets the winner, and every
enemy airframe loses link; the enemy's package is grounded and its unflown
airframes are logged. The winner's own sorties still airborne are held where
they are — the fight is decided at the kill, and the strikes-delivered tally
is final at that moment.

### End states and phases

Win: as orbit mode. **Stalemate** (new): a side is *quiet* when nothing of
its is airborne, no strike airframe is unflown, and it holds no reserve
hunter that could still go on the fix it has (CEP < `PUSH_CEP_M`); when both
sides are quiet no emitter remains for either DF effort, neither fix can
improve, and `state.stalemate` ends the match. Note the hunter-search corner
case shared with orbit mode: a hunter launched on a bad fix spirals until
its battery is gone — up to 20 min, during which its own continuous keying
can get *its* GCS fixed. Phases: EMPLACEMENT → STRIKE SORTIES (first
launch) → FIX → ATTACK (a hunter committed) → ENDEX. The HUD shows sorties
flown of planned, airborne now, strikes delivered and the hunter's state; the
GCS panel lists the airframes it is controlling and pilot-station usage; the
end card carries the strikes-delivered tally.

### RNG isolation

Both modes share the main engagement stream up to and including the
emplacement (team phase offsets, then GCS/DF jitter — `makeTeam()` and the
first part of `resetSim()`), so a seed gives the same terrain and positions in
either mode. Tactical mode then draws the objective jitter and, per airframe,
its phase offsets, aim point and launch-spacing jitter; per-scan draws follow
in scan order. Orbit mode's draw sequence is exactly what it was before the
mode existed — the parity fixtures in fpv-sim-mcp regenerate identically —
and the orbit code was only touched to extract three helpers verbatim
(`collectUplinkLOBs`, `collectDownlink`, `attackGuidance`), reorder RNG-free
lines in `resetSim()`, and add the mode dispatch.

### Character

Over seeds 1–200 with the defaults, the disciplined side wins 27%, the
continuous emitter 15%, and 58% end in stalemate (mean decided fight ~7 min).
The higher draw rate against orbit mode's 37% is structural — a package is
spent in about seven minutes, a third of the orbit fight's exposure window —
and package size moves it only slowly (8 sorties at 75 s spacing: 31/20/50);
the seeds that stall are the ones whose sensor–GCS paths are heavily masked,
and those stall in orbit mode too. The EMCON edge widens from 1.4:1 to
1.8:1: with terminal keying forced on for both sides, the schedule still
decides who is fixed first, and the intermittent side spends far less time
on the air per sortie.

## Rendering

- Terrain and canopy are rendered **once per seed** to 600×600 offscreen
  canvases (hillshade from NW light on the elevation grid, alpha-scaled green
  for canopy, plus a seeded speckle pass for texture) and blitted each frame.
- Dynamic layers, in order: 500 m grid with labels, NAI boxes (plus the
  objective ring in tactical mode), RF range rings, flight-path trails (one
  per airframe; expended/downed ones fainter), expanding RF pulse rings on
  transmit, fading LOBs (last 16, 30 s fade), enemy-drone track diamonds
  (one per tracked airframe), error ellipses with CEP readout, unit symbols
  (the hunter-killer ringed), explosion rings (GCS kill 260 m, strike impact
  110 m), map furniture (north arrow, 500 m scale bar, AO label), team status
  HUD cards (upper corners: drone state and battery — or, in tactical mode,
  sorties flown/airborne, strikes delivered and hunter state — LOB count,
  fix CEP, engagement status), selection ring.
- World coordinates are meters with north up; `W2S()` flips Y for screen
  space. Canvas is DPI-aware (`devicePixelRatio` transform). The view uses a
  **cover fit**: it fills the pane and crops the square world's empty
  top/bottom margins on wide panes, with a clamp (`MIN_VIS_M`) guaranteeing
  the central emplacement band always stays visible. Map furniture and grid
  labels pin to the visible pane rather than the world edges.
- Hit testing for unit selection is a simple nearest-center search over
  screen-space hit circles rebuilt each frame.

The UI is intentionally styled as an operator console: monospace type,
dark panel palette, uppercase labels, an UNCLASSIFIED-style banner top and
bottom reinforcing that the content is a notional demonstration.

## Determinism and scenario curation

All engagement randomness is `mulberry32`, keyed off one seed (the
`resetSim(seed)` argument; `CONFIG.SEED` = 20260719, a date, is the default),
in a handful of streams derived from it. The **main engagement stream**
`mulberry32(seed)` supplies, in a fixed order: the EMCON phase offsets, the
emplacement jitter, and then every per-scan draw — uplink and downlink
detection rolls, the Gaussian bearing noise on each intercepted LOB, and the
Gaussian position noise on the enemy-drone track (display-only, but it still
consumes draws). Terrain uses its own derived streams (`seed + 101/202/303`
for the three noise fields, `seed + 404` for clearings and the trail) and the
canopy speckle texture uses `seed + 909`, so re-rendering terrain can never
perturb the engagement. `resetSim(seed)` rebuilds the world and replays
identically. Because the draw *order* on the main stream is part of the
determinism contract, anything that adds, removes, or reorders a draw is a
behavior-changing edit (see `CHANGELOG.md`). The featured-scenario dropdown is
nothing more than seeds whose engagements were observed to produce
instructive outcomes (fast disciplined win, deliberate fix, OPFOR upset,
photo finish). To curate more: hit Random, watch, and if the engagement
teaches something, copy the seed from the **SEED readout in the Controls
section of the sidebar** (Random does not rewrite the URL; only if you
arrived via a dashboard WATCH link is it also in `?seed=`) into the
`<select>`.

## Tuning guide

Everything lives in `CONFIG` with units in the comments. The high-leverage
knobs:

| Knob | Effect |
|---|---|
| `TEAMS.*.uplinkOn/Off, videoOn/Off` | The EMCON story itself; making OPFOR disciplined turns the demo into a coin flip |
| `CUAS.P_DETECT_UL / P_DETECT_DL` | Collection rate; raises/lowers time-to-fix for both sides |
| `CUAS.BRG_SIGMA_DEG` | Bearing quality; drives how small CEP can get and how often terminal search happens |
| `FIX.COMMIT_CEP_M / MIN_LOBS_COMMIT` | Aggressiveness; looser gates mean earlier, riskier commits |
| `DRONE.PUSH_BATT_PCT / PUSH_CEP_M` | Bingo-fuel doctrine; how desperate the final push is allowed to be |
| `DRONE.ENDURANCE_S` | Overall engagement clock pressure |
| `CUAS.MAX_RANGE_M` | Standoff; below ~3000 m the sides struggle to see each other at all |

## Known simplifications

Deliberate scope cuts, in case anyone extends this:

- No jamming, spoofing, or kinetic counter-fire against the drones — the cUAS
  side is **sense-only**; the counter comes from the friendly FPV strike.
- Frequency references (915 MHz, 5.8 GHz) are cosmetic log flavor, not an RF
  link budget; propagation is the geometric attenuation model above.
- One drone per side, one sortie, no reloads or battery swaps.
- DF nodes are omniscient about signal identity (no false correlation between
  the two enemy emitter types, no clutter/ambient emitters).
- Flat-earth geometry within the 4 km box; bearings are planar.
