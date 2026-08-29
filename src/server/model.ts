/*
 * describe_model payload: the modeling assumptions an agent needs in order
 * to reason about what conclusions the simulation can and cannot support.
 * Content is drawn from the original sim's DESIGN_NOTES.md and the inline
 * modeling comments preserved in the engine source.
 */

export const MODEL_DESCRIPTION = {
  overview:
    "Force-on-force engagement between two symmetric teams on a 4000 m x 4000 m notional jungle/coastal box " +
    "(AO KATANA). Each team fields one ground control station (GCS, the target), two passive counter-UAS RF " +
    "direction-finding nodes, and armed FPV sUAS. Teams hunt each other's GCS by its RF emissions: LOBs " +
    "accumulate into a geolocation fix, a drone dashes to the fix and strikes. Destroying the enemy GCS severs " +
    "their drones' C2 link (they crash shortly after), which is why the GCS is the win condition. The one " +
    "asymmetry in the default configuration is EMCON posture: BLUFOR keys intermittently, OPFOR nearly " +
    "continuously. Two engagement plans (the tool argument `mode`) share this terrain, sensors, fix math and " +
    "terminal attack run: \"orbit\" (default) — one FPV per side holds a forward orbit while the DF nodes work — " +
    "and \"tactical\" — each side flies a package of one-way strike sorties into a shared objective and a " +
    "reserved hunter-killer launches on the GCS fix (see tactical_mode). All data is notional and unclassified.",

  determinism:
    "All engagement randomness — EMCON phase offsets, emplacement jitter, (tactical mode: the objective jitter " +
    "and each airframe's phase offsets, aim point and launch-spacing jitter), detection rolls, bearing noise, and " +
    "the display-only enemy-drone track noise — draws in a fixed order from one seeded mulberry32 stream; terrain " +
    "uses separate streams derived from the same seed (seed+101/202/303/404), so it can never perturb the " +
    "engagement. Both modes share the stream up to and including the emplacement, so a seed gives the same terrain " +
    "and unit positions in either. Fixed 0.1 s physics ticks; DF scans every 1.5 s. Identical (seed, mode, " +
    "config_overrides) inputs reproduce the identical engagement, tick for tick — verified against the original " +
    "browser implementation by golden-master tests in both modes (see DESIGN_NOTES.md of this project).",

  terrain:
    "Seeded value-noise elevation (three octaves shaped into low jungle hills with a ridge spine, an eastern " +
    "coastline and a northeast bay) plus a separate canopy-density field cut by six clearings and one east-west " +
    "trail. Both are bilinearly sampled 200x200 grids. Terrain affects the engagement only through RF propagation " +
    "and emplacement (units nudge west out of water); drones do not collide with terrain.",

  rf_propagation:
    "pathAtten() samples 13 interior points along the sensor-to-emitter sight line (K = 14 subdivisions). Each " +
    "sample counts toward at most one of two terms: terrain more than 2 m above the line of sight adds heavy but " +
    "not absolute blocking (diffraction is the stated reason blocking saturates rather than going binary); " +
    "otherwise, if the ray is below canopy top (ground + 18 m), the sample accumulates soft vegetation loss " +
    "proportional to canopy density. The result, min(6, block/14 * 4.2 + veg * 0.14), is 0 for a clean line of " +
    "sight and tops out near 3.9 with the whole path blocked (about 1.8 under full canopy) — the nominal cap of 6 " +
    "is never reached. It multiplies detection probability via exp(-att) and inflates bearing error. Frequency " +
    "references in the event log (915 MHz, 5.8 GHz) are cosmetic flavor, not a link budget.",

  df_collection: {
    scan_model:
      "Every SCAN_S seconds each side's two nodes roll independent per-scan detection against every active enemy " +
      "emitter within MAX_RANGE_M. Base probabilities: P_DETECT_UL (0.40) against the C2 uplink, P_DETECT_DL " +
      "(0.65) against the FPV video downlink, both scaled down by range and by exp(-attenuation).",
    bearing_error_model:
      "A successful uplink intercept appends a line of bearing with gaussian noise: sigma = BRG_SIGMA_DEG " +
      "(4.0 deg, 1-sigma) inflated by path attenuation as sigma * (1 + 0.5 * att). LOBs are capped at MAX_MEAS " +
      "(140) FIFO per collection effort.",
    downlink_tracks:
      "Video downlink intercepts do NOT feed the GCS fix; they produce a noisy position track of the enemy air " +
      "vehicle (55 m gaussian noise per axis) — situational awareness that the enemy bird is airborne.",
  },

  fix_estimation: {
    solver:
      "Weighted least squares over all held LOBs. Measurement model: perpendicular offset from each bearing line, " +
      "noise sigma_perp = sigma_bearing * range (range floored at 300 m), weight 1/sigma_perp^2. Two iterations " +
      "(weights depend on range to the answer). Covariance = residual-inflated inverse normal matrix: scaled by " +
      "max(1, chi2/(n-2)) so a " +
      "small-sample geometry cannot report an optimistic ellipse. CEP ~= 0.59*(sigma1+sigma2), floored at " +
      "CEP_FLOOR_M (35 m).",
    quality_gates: [
      "Participation gate: no solve until MIN_LOBS_SOLVE (6) LOBs exist AND the second-strongest collector holds " +
      "MIN_LOBS_2ND (3) of them. Defends against single-sensor solutions whose along-range position slides freely.",
      "Geometry penalty: the crossing angle between the bearings from each of the two strongest collectors TO the " +
      "current estimate (the geometry of the cut at the solution, not an average of measured LOBs) and the balance " +
      "of their LOB counts divide into the CEP — a shallow-cut or lopsided fix reports a proportionally worse CEP.",
      "Jitter penalty: the last 6 solutions are kept; if the estimate is still wandering (RMS scatter), the " +
      "effective CEP cannot be small yet. Effective CEP = max(formal, geometry-penalized, jitter).",
    ],
    thresholds:
      "FIX ESTABLISHED at >= MIN_LOBS_FIX (10) LOBs and CEP < FIX_CEP_M (240 m). Attack commit at >= " +
      "MIN_LOBS_COMMIT (12) LOBs and CEP < COMMIT_CEP_M (120 m), or a bingo-fuel final push at <= PUSH_BATT_PCT " +
      "(45%) battery accepting CEP < PUSH_CEP_M (260 m).",
  },

  drone_behavior:
    "Orbit mode. Finite-state machine: STANDBY -> TRANSIT -> HOLD -> COMMIT -> TERMINAL -> IMPACT, with LINK LOST -> DOWN " +
    "when the team's own GCS dies and DOWN on battery exhaustion. Launch at launchT; fly to a holding point " +
    "HOLD_STANDOFF_M forward of own GCS toward the named area of interest; orbit at LOITER_MPS with a 0.62x " +
    "battery drain while the ground nodes build the fix; dash at DASH_MPS on commit; inside 380 m of the estimate " +
    "descend below canopy at TERMINAL_MPS; visually acquire the real GCS within ACQ_RANGE_M (220 m); if the drone " +
    "reaches the fix point without acquiring, it flies an outward spiral search (radius growing " +
    "TERMINAL_SEARCH_GROW m/s, tangential speed held at TERMINAL_MPS; a steep spiral, not repeated laps) — a " +
    "modest fix error is recovered quickly, a gross one burns the battery. Steering is a turn-rate-limited " +
    "heading controller with rate-limited speed and climb; movement is dead reckoning per 0.1 s tick.",

  emcon_model:
    "Each team's C2 uplink and video downlink follow on/off duty cycles with a per-seed random phase offset. A " +
    "team is only collectable while an emitter is keyed. videoOff = 0 means continuous video downlink (the big " +
    "giveaway: P_DETECT_DL 0.65 vs P_DETECT_UL 0.40). Exception: during COMMIT and TERMINAL the attacker needs " +
    "eyes on, so video forces on regardless of posture — even the disciplined side becomes loud in the endgame. " +
    "In tactical mode the uplink is keyed whenever any linked airframe needs it (each on its own phase of the " +
    "team's duty cycle; continuously for one under manual control), so the GCS emits more the more it flies. " +
    "The teaching point of the default configuration: the side that transmits less is harder to fix.",

  tactical_mode: {
    scenario:
      "mode: \"tactical\". There is a ground fight both sides are supporting: a contested objective, OBJ TANTO " +
      "(a 260 m circle midway between the two GCS, jittered per seed like the emplacements). Each side has a " +
      "strike package of TACTICAL.SORTIES[side] one-way FPV airframes (default 5) plus, with RESERVE_HUNTER on, " +
      "one more held back as the hunter-killer; a GCS has TACTICAL.PILOTS[side] pilot stations (default 2), each " +
      "flying one airframe on one C2 link, so at most that many can be airborne at once. The launch plan is fixed " +
      "at reset: sortie 1 at TEAMS.<side>.launchT, then LAUNCH_INTERVAL_S +/- LAUNCH_JITTER_S apart, each " +
      "airframe with its own EMCON phase offsets and an aim point scattered AIM_SIGMA_M (gaussian) about the " +
      "objective center and clamped inside it. Launches go in plan order when the planned time has come AND a " +
      "pilot station is free — a busy package slips its schedule.",
    strike_sortie:
      "STANDBY -> TRANSIT (autonomous, cruise, above canopy, uplink keyed on the team's duty cycle) -> TERMINAL " +
      "(inside STRIKE_TERMINAL_M of the aim point the pilot takes manual control: terminal speed, below canopy, " +
      "uplink keyed continuously) -> IMPACT on the aim point (one-way; expended; the side's strikes-delivered " +
      "count increments). LINK LOST -> DOWN when own GCS dies, DOWN on battery exhaustion, as in orbit mode. " +
      "Nothing on the objective shoots back — sorties exist to be delivered and, above all, to emit.",
    hunter_killer:
      "Launches when the team's fix on the enemy GCS meets the orbit-mode commit gate (FIX ESTABLISHED, >= " +
      "MIN_LOBS_COMMIT LOBs, CEP < COMMIT_CEP_M) — or, once the strike package is expended (every strike " +
      "airframe launched, none airborne) with no emitter left to draw the enemy's attention, as a final push on " +
      "the best fix held (CEP < PUSH_CEP_M). It is the reserve airframe, or with RESERVE_HUNTER off the next " +
      "unflown strike airframe retasked (then there is no final push once the package is spent). It needs a " +
      "pilot station: if all are flying sorties the commit holds until one frees, and the hunter then takes " +
      "priority over the next strike launch; the hold lapses if the fix loosens again. From launch it runs the " +
      "same COMMIT dash / TERMINAL acquisition / spiral search / impact as the orbit drone, against the live fix.",
    end_states:
      "Win: enemy GCS destroyed (gcs_destroyed) — the enemy package is grounded, its airborne airframes lose link, " +
      "and the winner's still-airborne strikes are held where they are, so strikes delivered is final at the kill. " +
      "STALEMATE (packages_expended): both sides quiet — nothing airborne, no strike airframe unflown, no reserve " +
      "hunter that could still go on a fix under PUSH_CEP_M — so no emitter remains for either DF effort and " +
      "neither fix can improve; the sim declares this itself (\"ENDEX // STALEMATE\"). Phases: EMPLACEMENT -> " +
      "STRIKE SORTIES -> FIX -> ATTACK -> ENDEX. Per team the result carries sorties flown, strikes delivered, " +
      "the hunter's fate and every airframe's end state.",
    character:
      "Over seeds 1-200 with the defaults the disciplined side wins ~27%, the continuous emitter ~15%, and ~58% " +
      "end in stalemate (mean decided fight ~7 min). The higher draw rate against orbit mode is structural — a " +
      "package is spent in about seven minutes, a third of the orbit fight's exposure window; the seeds that " +
      "stall are the ones whose sensor-GCS paths are heavily masked, and those stall in orbit mode too. The EMCON " +
      "edge widens (~1.8:1 vs ~1.4:1): with terminal keying forced on for both sides, the schedule still decides " +
      "who is fixed first, and the intermittent side spends far less time on the air per sortie.",
  },

  outcomes:
    "BLUFOR or OPFOR win by destroying the enemy GCS (reason gcs_destroyed). Orbit-mode headless runs additionally " +
    "end in STALEMATE when both drones are down (no future state change is possible) or at the sim-time cap " +
    "(3600 s); tactical mode declares its own STALEMATE (packages_expended) when both packages are spent and " +
    "neither side can launch a hunter. Roughly 30% of random orbit seeds (and ~58% of tactical ones) are genuine " +
    "stalemates under the honest estimator: disciplined emissions plus imperfect DF geometry legitimately deny a " +
    "fix. That rate is a finding of the original development, not a bug.",

  known_simplifications: [
    "No jamming, spoofing, or kinetic counter-fire against the drones — the cUAS side is sense-only; the counter comes from the friendly FPV strike.",
    "Frequency references (915 MHz, 5.8 GHz) are cosmetic log flavor, not an RF link budget; propagation is the geometric attenuation model above.",
    "Orbit mode: one drone per side, one sortie, no reloads or battery swaps. Tactical mode: a fixed package per side, no reloads; nothing on the objective shoots back, and strikes delivered are tallied, not adjudicated.",
    "DF nodes are omniscient about signal identity (no false correlation between the two enemy emitter types, no clutter/ambient emitters).",
    "Flat-earth geometry within the 4 km box; bearings are planar.",
  ],

  validity_notes:
    "Numbers are plausible-magnitude fiction shaped by doctrine, not measured data. The simulation supports " +
    "qualitative conclusions about the detect-fix-commit-strike timeline and the relative effect of EMCON " +
    "posture, collection rate, and fix-gate aggressiveness. It does not support absolute performance claims " +
    "about any real system.",
} as const;
