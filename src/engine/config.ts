/*
 * Simulation configuration, ported from the CONFIG object in fpv-sim
 * index.html. Values and modeling comments are preserved verbatim.
 *
 * Distances in meters, speeds in m/s, times in simulated seconds,
 * angles in degrees true (converted to radians internally).
 *
 * Differences from the browser CONFIG (documented in DESIGN_NOTES.md):
 *  - SEED is a Simulation constructor argument, not a config field.
 *  - DEFAULT_SPEED and COLORS are dropped (playback/rendering only).
 *  - TEAMS[].emconLabel is derived from the duty cycle (videoOff === 0 →
 *    "CONTINUOUS") instead of stored, so labels stay honest under
 *    config_overrides. The derivation reproduces the original labels for
 *    the stock values.
 */

export interface DroneConfig {
  CRUISE_MPS: number;        // Transit / search airspeed (approx 35 kts).
  LOITER_MPS: number;        // Holding-orbit airspeed (approx 23 kts, endurance-optimal).
  DASH_MPS: number;          // Attack-run airspeed.
  TERMINAL_MPS: number;      // Terminal homing airspeed (approx 87 kts).
  TURN_DPS: number;          // Max turn rate, deg/sec.
  ALT_TRANSIT_AGL: number;   // Transit altitude AGL, above canopy.
  ALT_LOITER_AGL: number;    // Holding-orbit altitude AGL.
  ALT_TERMINAL_AGL: number;  // Terminal dive-to altitude AGL.
  CLIMB_MPS: number;         // Altitude change rate.
  ENDURANCE_S: number;       // Battery endurance at cruise, sim seconds.
  LOITER_DRAIN: number;      // Battery drain multiplier while holding (slower speed).
  PUSH_BATT_PCT: number;     // Bingo fuel: commit on best available fix at or below this.
  HOLD_STANDOFF_M: number;   // Holding orbit sits this far forward of own GCS toward the NAI.
  HOLD_RADIUS_M: number;     // Holding-orbit radius.
  ACQ_RANGE_M: number;       // Range at which FPV operator visually IDs the GCS.
  SEARCH_MPS: number;        // Visual-search airspeed over the fix area (slow enough to actually scan).
  SEARCH_RING_M: number;     // Expanding-search ring spacing per revolution; under ACQ_RANGE_M so rings overlap visually.
  SEARCH_CEP_MULT: number;   // Search no farther out than this multiple of the current fix CEP...
  SEARCH_MAX_R_M: number;    // ...and never beyond this radius; a completed no-joy pattern re-sweeps from the center.
  EDGE_MARGIN_M: number;     // Steering targets are confined this far inside the AO edge (turn before the boundary).
  IMPACT_RANGE_M: number;    // Detonation range.
  WPT_RADIUS_M: number;      // Waypoint capture radius.
}

export interface CuasConfig {
  SCAN_S: number;            // DF scan revisit interval.
  MAX_RANGE_M: number;       // Max detection range vs this emitter class.
  BRG_SIGMA_DEG: number;     // 1-sigma bearing error, clean conditions.
  P_DETECT_UL: number;       // Base per-scan detect prob, C2 uplink.
  P_DETECT_DL: number;       // Base per-scan detect prob, FPV video downlink.
  MAX_MEAS: number;          // LOB history cap per collection effort.
  CANOPY_HGT_M: number;      // Canopy top height above ground for masking.
}

export interface FixConfig {
  FIX_CEP_M: number;         // "FIX ESTABLISHED" threshold.
  COMMIT_CEP_M: number;      // Attack-commit threshold.
  PUSH_CEP_M: number;        // Looser fix acceptable on a low-battery final push.
  MIN_LOBS_SOLVE: number;    // Min LOBs (from 2+ nodes) before a cut is attempted.
  MIN_LOBS_2ND: number;      // Min LOBs required from the second collector for a balanced fix.
  MIN_LOBS_FIX: number;      // Min LOBs before FIX can be declared.
  MIN_LOBS_COMMIT: number;   // Min LOBs before attack commit (operator confidence).
  CEP_FLOOR_M: number;       // Sensor-limited best-case CEP.
  GOOD_CUT_DEG: number;      // LOB crossing angle giving full-confidence geometry.
}

// EMCON posture per side. Uplink pattern: on/off seconds (duty cycle).
// videoOff = 0 means continuous FPV downlink (poor discipline).
export interface TeamEmconConfig {
  uplinkOn: number;
  uplinkOff: number;
  videoOn: number;
  videoOff: number;
  launchT: number;
}

// TACTICAL mode only (mode === "tactical"; see src/engine/tactical.ts). Each
// side pushes a package of one-way FPV strike sorties into a shared objective
// while its DF nodes hunt the enemy GCS; a reserved hunter-killer launches on
// the fix. ORBIT mode never reads this block.
// TEAMS.<side>.launchT doubles as each side's first strike launch time.
export interface TacticalConfig {
  OBJ_X: number;             // Contested objective (the supported ground fight),
  OBJ_Y: number;             //   midway between the GCS; jittered per seed like the emplacements.
  OBJ_RADIUS_M: number;      // Objective radius; strike aim points are scattered inside it.
  OBJ_NAME: string;
  SORTIES: { BLUFOR: number; OPFOR: number }; // Strike airframes per side (one-way; expended on impact).
  PILOTS: { BLUFOR: number; OPFOR: number };  // Pilot stations per GCS = max FPVs airborne at once, one C2 link each.
  RESERVE_HUNTER: boolean;   // Hold one extra FPV back as the dedicated GCS hunter-killer.
                             //   false: the next unflown strike airframe is retasked when the fix commits.
  LAUNCH_INTERVAL_S: number; // Nominal spacing between strike launches.
  LAUNCH_JITTER_S: number;   // +/- uniform jitter on that spacing, drawn per sortie at reset.
  STRIKE_TERMINAL_M: number; // A strike sortie hands from autonomous transit to manual terminal this far from its aim point.
  AIM_SIGMA_M: number;       // 1-sigma scatter of aim points about the objective center.
}

export interface SimConfig {
  WORLD_M: number;           // Map is WORLD_M x WORLD_M meters.
  SIM_DT: number;            // Physics step, sim seconds.
  DRONE: DroneConfig;
  CUAS: CuasConfig;
  FIX: FixConfig;
  TEAMS: { BLUFOR: TeamEmconConfig; OPFOR: TeamEmconConfig };
  TACTICAL: TacticalConfig;
}

export const DEFAULT_SEED = 20260719; // Deterministic seed. Same seed -> same engagement.

export const DEFAULT_CONFIG: SimConfig = {
  WORLD_M: 4000,
  SIM_DT: 0.1,

  DRONE: {
    CRUISE_MPS: 18,
    LOITER_MPS: 12,
    DASH_MPS: 36,
    TERMINAL_MPS: 45,
    TURN_DPS: 70,
    ALT_TRANSIT_AGL: 70,
    ALT_LOITER_AGL: 55,
    ALT_TERMINAL_AGL: 12,
    CLIMB_MPS: 8,
    ENDURANCE_S: 1200,
    LOITER_DRAIN: 0.62,
    PUSH_BATT_PCT: 45,
    HOLD_STANDOFF_M: 600,
    HOLD_RADIUS_M: 130,
    ACQ_RANGE_M: 220,
    SEARCH_MPS: 24,
    SEARCH_RING_M: 170,
    SEARCH_CEP_MULT: 2,
    SEARCH_MAX_R_M: 650,
    EDGE_MARGIN_M: 150,
    IMPACT_RANGE_M: 9,
    WPT_RADIUS_M: 70,
  },

  CUAS: {
    SCAN_S: 1.5,
    MAX_RANGE_M: 3600,
    BRG_SIGMA_DEG: 4.0,
    P_DETECT_UL: 0.40,
    P_DETECT_DL: 0.65,
    MAX_MEAS: 140,
    CANOPY_HGT_M: 18,
  },

  FIX: {
    FIX_CEP_M: 240,
    COMMIT_CEP_M: 120,
    PUSH_CEP_M: 260,
    MIN_LOBS_SOLVE: 6,
    MIN_LOBS_2ND: 3,
    MIN_LOBS_FIX: 10,
    MIN_LOBS_COMMIT: 12,
    CEP_FLOOR_M: 35,
    GOOD_CUT_DEG: 35,
  },

  TEAMS: {
    BLUFOR: { uplinkOn: 4, uplinkOff: 13, videoOn: 3, videoOff: 7, launchT: 20 },
    OPFOR: { uplinkOn: 10, uplinkOff: 4, videoOn: 1, videoOff: 0, launchT: 26 },
  },

  TACTICAL: {
    OBJ_X: 1830, OBJ_Y: 1975,
    OBJ_RADIUS_M: 260,
    OBJ_NAME: "OBJ TANTO",
    SORTIES: { BLUFOR: 5, OPFOR: 5 },
    PILOTS: { BLUFOR: 2, OPFOR: 2 },
    RESERVE_HUNTER: true,
    LAUNCH_INTERVAL_S: 90,
    LAUNCH_JITTER_S: 20,
    STRIKE_TERMINAL_M: 380,
    AIM_SIGMA_M: 90,
  },
};

export type EmconLabel = "INTERMITTENT" | "CONTINUOUS";

// videoOff = 0 means continuous FPV downlink (poor discipline). The label is
// derived rather than stored so it stays truthful under overrides.
export const emconLabel = (team: TeamEmconConfig): EmconLabel =>
  team.videoOff === 0 ? "CONTINUOUS" : "INTERMITTENT";

/*
 * Deep-partial override shape accepted by every MCP tool. Structural
 * parameters (WORLD_M, SIM_DT) are deliberately NOT overridable: unit
 * emplacements are absolute coordinates tuned to the 4000 m box, and the
 * fixed 0.1 s tick is part of the determinism contract.
 */
export interface TacticalOverrides extends Partial<Omit<TacticalConfig, "SORTIES" | "PILOTS">> {
  SORTIES?: { BLUFOR?: number; OPFOR?: number };
  PILOTS?: { BLUFOR?: number; OPFOR?: number };
}

export interface ConfigOverrides {
  DRONE?: Partial<DroneConfig>;
  CUAS?: Partial<CuasConfig>;
  FIX?: Partial<FixConfig>;
  TEAMS?: { BLUFOR?: Partial<TeamEmconConfig>; OPFOR?: Partial<TeamEmconConfig> };
  TACTICAL?: TacticalOverrides;
}

export function mergeConfig(overrides?: ConfigOverrides): SimConfig {
  const d = DEFAULT_CONFIG;
  return {
    WORLD_M: d.WORLD_M,
    SIM_DT: d.SIM_DT,
    DRONE: { ...d.DRONE, ...overrides?.DRONE },
    CUAS: { ...d.CUAS, ...overrides?.CUAS },
    FIX: { ...d.FIX, ...overrides?.FIX },
    TEAMS: {
      BLUFOR: { ...d.TEAMS.BLUFOR, ...overrides?.TEAMS?.BLUFOR },
      OPFOR: { ...d.TEAMS.OPFOR, ...overrides?.TEAMS?.OPFOR },
    },
    TACTICAL: {
      ...d.TACTICAL,
      ...overrides?.TACTICAL,
      SORTIES: { ...d.TACTICAL.SORTIES, ...overrides?.TACTICAL?.SORTIES },
      PILOTS: { ...d.TACTICAL.PILOTS, ...overrides?.TACTICAL?.PILOTS },
    },
  };
}
