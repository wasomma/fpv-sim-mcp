/*
 * Tunable-parameter metadata: units, defaults, sane ranges, descriptions.
 *
 * This table is the single source for BOTH the zod validator applied to
 * every config_overrides input AND the get_config_schema tool output, so
 * what the server tells an agent it accepts and what it actually accepts
 * cannot drift apart.
 *
 * Deliberately NOT overridable (see engine/config.ts): WORLD_M and SIM_DT
 * (structural — emplacements are absolute coordinates in the 4000 m box and
 * the fixed 0.1 s tick is part of the determinism contract), plus the
 * browser-only DEFAULT_SPEED / COLORS which do not exist in the engine.
 */

import { z } from "zod";
import { DEFAULT_CONFIG } from "../engine/index.js";

export interface ParamMeta {
  default: number | boolean;
  unit: string;
  range: [number, number];   // ignored for boolean parameters
  integer?: boolean;
  boolean?: boolean;
  description: string;
}

type SectionMeta<K extends string> = Record<K, ParamMeta>;

const D = DEFAULT_CONFIG;

export const DRONE_PARAMS: SectionMeta<keyof typeof D.DRONE> = {
  CRUISE_MPS:       { default: D.DRONE.CRUISE_MPS, unit: "m/s", range: [5, 60], description: "Transit / search airspeed (default approx 35 kts)." },
  LOITER_MPS:       { default: D.DRONE.LOITER_MPS, unit: "m/s", range: [4, 40], description: "Holding-orbit airspeed, endurance-optimal." },
  DASH_MPS:         { default: D.DRONE.DASH_MPS, unit: "m/s", range: [10, 80], description: "Attack-run airspeed after commit." },
  TERMINAL_MPS:     { default: D.DRONE.TERMINAL_MPS, unit: "m/s", range: [10, 100], description: "Terminal homing airspeed." },
  TURN_DPS:         { default: D.DRONE.TURN_DPS, unit: "deg/s", range: [20, 180], description: "Maximum turn rate." },
  ALT_TRANSIT_AGL:  { default: D.DRONE.ALT_TRANSIT_AGL, unit: "m AGL", range: [20, 300], description: "Transit altitude, above canopy." },
  ALT_LOITER_AGL:   { default: D.DRONE.ALT_LOITER_AGL, unit: "m AGL", range: [15, 300], description: "Holding-orbit altitude." },
  ALT_TERMINAL_AGL: { default: D.DRONE.ALT_TERMINAL_AGL, unit: "m AGL", range: [3, 60], description: "Terminal dive-to altitude (below canopy)." },
  CLIMB_MPS:        { default: D.DRONE.CLIMB_MPS, unit: "m/s", range: [1, 20], description: "Altitude change rate." },
  ENDURANCE_S:      { default: D.DRONE.ENDURANCE_S, unit: "s", range: [180, 3600], description: "Battery endurance at cruise. The overall engagement clock pressure." },
  LOITER_DRAIN:     { default: D.DRONE.LOITER_DRAIN, unit: "multiplier", range: [0.2, 1.5], description: "Battery drain multiplier while holding (slower speed)." },
  PUSH_BATT_PCT:    { default: D.DRONE.PUSH_BATT_PCT, unit: "%", range: [0, 90], description: "Bingo fuel: commit on best available fix at or below this battery level." },
  HOLD_STANDOFF_M:  { default: D.DRONE.HOLD_STANDOFF_M, unit: "m", range: [100, 1500], description: "Holding orbit sits this far forward of own GCS toward the NAI." },
  HOLD_RADIUS_M:    { default: D.DRONE.HOLD_RADIUS_M, unit: "m", range: [50, 400], description: "Holding-orbit radius." },
  ACQ_RANGE_M:      { default: D.DRONE.ACQ_RANGE_M, unit: "m", range: [50, 600], description: "Range at which the FPV operator visually IDs the GCS in the terminal phase." },
  SEARCH_MPS:       { default: D.DRONE.SEARCH_MPS, unit: "m/s", range: [5, 60], description: "Visual-search airspeed over the fix area when nothing is acquired at the fix point." },
  SEARCH_RING_M:    { default: D.DRONE.SEARCH_RING_M, unit: "m", range: [40, 600], description: "Ring spacing per revolution of the expanding search orbit; keep it under ACQ_RANGE_M so successive rings overlap visually." },
  SEARCH_CEP_MULT:  { default: D.DRONE.SEARCH_CEP_MULT, unit: "multiplier", range: [1, 5], description: "Maximum search radius as a multiple of the current fix CEP (floored at ACQ_RANGE_M)." },
  SEARCH_MAX_R_M:   { default: D.DRONE.SEARCH_MAX_R_M, unit: "m", range: [200, 2000], description: "Absolute cap on the search radius; a completed no-joy pattern re-sweeps from the center." },
  EDGE_MARGIN_M:    { default: D.DRONE.EDGE_MARGIN_M, unit: "m", range: [50, 500], description: "Commanded steering points are confined this far inside the AO edge, so flight turns back ahead of the boundary." },
  IMPACT_RANGE_M:   { default: D.DRONE.IMPACT_RANGE_M, unit: "m", range: [3, 30], description: "Detonation range." },
  WPT_RADIUS_M:     { default: D.DRONE.WPT_RADIUS_M, unit: "m", range: [20, 200], description: "Waypoint capture radius." },
};

export const CUAS_PARAMS: SectionMeta<keyof typeof D.CUAS> = {
  SCAN_S:        { default: D.CUAS.SCAN_S, unit: "s", range: [0.5, 10], description: "DF scan revisit interval." },
  MAX_RANGE_M:   { default: D.CUAS.MAX_RANGE_M, unit: "m", range: [1000, 6000], description: "Max detection range vs this emitter class. Below ~3000 m the sides struggle to see each other at all." },
  BRG_SIGMA_DEG: { default: D.CUAS.BRG_SIGMA_DEG, unit: "deg (1-sigma)", range: [0.5, 15], description: "Bearing error in clean conditions; path attenuation inflates it further." },
  P_DETECT_UL:   { default: D.CUAS.P_DETECT_UL, unit: "probability/scan", range: [0.02, 1], description: "Base per-scan detection probability against the C2 uplink." },
  P_DETECT_DL:   { default: D.CUAS.P_DETECT_DL, unit: "probability/scan", range: [0.02, 1], description: "Base per-scan detection probability against the FPV video downlink." },
  MAX_MEAS:      { default: D.CUAS.MAX_MEAS, unit: "count", range: [20, 400], integer: true, description: "LOB history cap per collection effort (FIFO)." },
  CANOPY_HGT_M:  { default: D.CUAS.CANOPY_HGT_M, unit: "m", range: [5, 40], description: "Canopy top height above ground used for RF masking." },
};

export const FIX_PARAMS: SectionMeta<keyof typeof D.FIX> = {
  FIX_CEP_M:       { default: D.FIX.FIX_CEP_M, unit: "m", range: [50, 600], description: "Effective CEP required to declare FIX ESTABLISHED." },
  COMMIT_CEP_M:    { default: D.FIX.COMMIT_CEP_M, unit: "m", range: [30, 400], description: "Effective CEP required for attack commit. Looser gates mean earlier, riskier commits." },
  PUSH_CEP_M:      { default: D.FIX.PUSH_CEP_M, unit: "m", range: [50, 800], description: "Looser fix acceptable on a low-battery final push." },
  MIN_LOBS_SOLVE:  { default: D.FIX.MIN_LOBS_SOLVE, unit: "count", range: [3, 30], integer: true, description: "Minimum LOBs (from 2+ nodes) before a cut is attempted." },
  MIN_LOBS_2ND:    { default: D.FIX.MIN_LOBS_2ND, unit: "count", range: [1, 20], integer: true, description: "Minimum LOBs from the second-strongest collector before a fix is trusted (the balanced multi-sensor gate)." },
  MIN_LOBS_FIX:    { default: D.FIX.MIN_LOBS_FIX, unit: "count", range: [4, 40], integer: true, description: "Minimum LOBs before FIX can be declared." },
  MIN_LOBS_COMMIT: { default: D.FIX.MIN_LOBS_COMMIT, unit: "count", range: [4, 60], integer: true, description: "Minimum LOBs before attack commit (operator confidence)." },
  CEP_FLOOR_M:     { default: D.FIX.CEP_FLOOR_M, unit: "m", range: [5, 150], description: "Sensor-limited best-case CEP." },
  GOOD_CUT_DEG:    { default: D.FIX.GOOD_CUT_DEG, unit: "deg", range: [10, 90], description: "LOB crossing angle giving full-confidence geometry." },
};

const TEAM_PARAM_META = (side: "BLUFOR" | "OPFOR"): SectionMeta<keyof typeof D.TEAMS.BLUFOR> => ({
  uplinkOn:  { default: D.TEAMS[side].uplinkOn, unit: "s", range: [0.5, 60], description: "C2 uplink keyed duration per duty cycle." },
  uplinkOff: { default: D.TEAMS[side].uplinkOff, unit: "s", range: [0, 120], description: "C2 uplink silent duration per duty cycle. 0 = continuous uplink." },
  videoOn:   { default: D.TEAMS[side].videoOn, unit: "s", range: [0.5, 60], description: "FPV video downlink keyed duration per duty cycle." },
  videoOff:  { default: D.TEAMS[side].videoOff, unit: "s", range: [0, 120], description: "FPV video downlink silent duration. 0 = continuous video (poor discipline; forces the EMCON label to CONTINUOUS). Video also forces on during COMMIT/TERMINAL regardless." },
  launchT:   { default: D.TEAMS[side].launchT, unit: "s", range: [0, 300], description: "Sim time at which this team's drone launches." },
});

export const TEAM_PARAMS = { BLUFOR: TEAM_PARAM_META("BLUFOR"), OPFOR: TEAM_PARAM_META("OPFOR") };

/* Tactical mode only (mode: "tactical" on the tools). Orbit-mode runs accept
   but ignore these — they mirror CONFIG.TACTICAL, which orbit never reads. */
export const TACTICAL_PARAMS: SectionMeta<"OBJ_X" | "OBJ_Y" | "OBJ_RADIUS_M" | "RESERVE_HUNTER" | "LAUNCH_INTERVAL_S" | "LAUNCH_JITTER_S" | "STRIKE_TERMINAL_M" | "AIM_SIGMA_M"> = {
  OBJ_X:             { default: D.TACTICAL.OBJ_X, unit: "m", range: [400, 3600], description: "Contested objective easting (nominal; jittered per seed like the emplacements)." },
  OBJ_Y:             { default: D.TACTICAL.OBJ_Y, unit: "m", range: [400, 3600], description: "Contested objective northing (nominal; jittered per seed like the emplacements)." },
  OBJ_RADIUS_M:      { default: D.TACTICAL.OBJ_RADIUS_M, unit: "m", range: [60, 800], description: "Objective radius; strike aim points are scattered inside it." },
  RESERVE_HUNTER:    { default: D.TACTICAL.RESERVE_HUNTER, unit: "flag", range: [0, 1], boolean: true, description: "Hold one extra FPV back as the dedicated GCS hunter-killer. false: the next unflown strike airframe is retasked when the fix commits (and there is no final push once the package is expended)." },
  LAUNCH_INTERVAL_S: { default: D.TACTICAL.LAUNCH_INTERVAL_S, unit: "s", range: [10, 600], description: "Nominal spacing between strike launches." },
  LAUNCH_JITTER_S:   { default: D.TACTICAL.LAUNCH_JITTER_S, unit: "s", range: [0, 120], description: "+/- uniform jitter on the launch spacing, drawn per sortie at reset." },
  STRIKE_TERMINAL_M: { default: D.TACTICAL.STRIKE_TERMINAL_M, unit: "m", range: [100, 1500], description: "A strike sortie hands from autonomous transit to manual terminal control this far from its aim point (manual control keys the uplink continuously)." },
  AIM_SIGMA_M:       { default: D.TACTICAL.AIM_SIGMA_M, unit: "m", range: [10, 400], description: "1-sigma scatter of strike aim points about the objective center." },
};

const TACTICAL_SIDE_PARAM = (name: "SORTIES" | "PILOTS", side: "BLUFOR" | "OPFOR"): ParamMeta =>
  name === "SORTIES"
    ? { default: D.TACTICAL.SORTIES[side], unit: "count", range: [1, 12], integer: true, description: "Strike airframes in this side's package (one-way; expended on impact)." }
    : { default: D.TACTICAL.PILOTS[side], unit: "count", range: [1, 6], integer: true, description: "Pilot stations at this side's GCS = max FPVs airborne at once, one C2 link each (floored at 1 by the engine)." };

export const TACTICAL_SIDE_PARAMS = {
  SORTIES: { BLUFOR: TACTICAL_SIDE_PARAM("SORTIES", "BLUFOR"), OPFOR: TACTICAL_SIDE_PARAM("SORTIES", "OPFOR") },
  PILOTS: { BLUFOR: TACTICAL_SIDE_PARAM("PILOTS", "BLUFOR"), OPFOR: TACTICAL_SIDE_PARAM("PILOTS", "OPFOR") },
};

/* ------------------- zod schema built from the table ------------------- */

function zodFromMeta(m: ParamMeta): z.ZodTypeAny {
  if (m.boolean) {
    return z.boolean().describe(`${m.description} Boolean. Default ${m.default}.`);
  }
  let n = z.number().min(m.range[0]).max(m.range[1]);
  if (m.integer) n = n.int();
  return n.describe(`${m.description} Unit: ${m.unit}. Default ${m.default}, range [${m.range[0]}, ${m.range[1]}].`);
}

function sectionSchema<K extends string>(metas: SectionMeta<K>): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, meta] of Object.entries<ParamMeta>(metas)) shape[key] = zodFromMeta(meta).optional();
  return z.object(shape).strict();
}

const tacticalShape: Record<string, z.ZodTypeAny> = {};
for (const [key, meta] of Object.entries<ParamMeta>(TACTICAL_PARAMS)) tacticalShape[key] = zodFromMeta(meta).optional();
tacticalShape.SORTIES = z.object({
  BLUFOR: zodFromMeta(TACTICAL_SIDE_PARAMS.SORTIES.BLUFOR).optional(),
  OPFOR: zodFromMeta(TACTICAL_SIDE_PARAMS.SORTIES.OPFOR).optional(),
}).strict().optional();
tacticalShape.PILOTS = z.object({
  BLUFOR: zodFromMeta(TACTICAL_SIDE_PARAMS.PILOTS.BLUFOR).optional(),
  OPFOR: zodFromMeta(TACTICAL_SIDE_PARAMS.PILOTS.OPFOR).optional(),
}).strict().optional();

export const configOverridesSchema = z.object({
  DRONE: sectionSchema(DRONE_PARAMS).optional(),
  CUAS: sectionSchema(CUAS_PARAMS).optional(),
  FIX: sectionSchema(FIX_PARAMS).optional(),
  TEAMS: z.object({
    BLUFOR: sectionSchema(TEAM_PARAMS.BLUFOR).optional(),
    OPFOR: sectionSchema(TEAM_PARAMS.OPFOR).optional(),
  }).strict().optional(),
  TACTICAL: z.object(tacticalShape).strict().optional(),
}).strict()
  .describe("Partial overrides of the simulation CONFIG. Unknown keys and out-of-range values are rejected. Get the full parameter table from get_config_schema. The TACTICAL section only affects mode: \"tactical\" runs.");

/* ---------------- get_config_schema tool payload ----------------------- */

interface FlatParam {
  path: string;
  default: number | boolean;
  unit: string;
  range: [number, number] | null;   // null for boolean parameters
  integer: boolean;
  boolean?: boolean;
  description: string;
}

function flatten(prefix: string, metas: Record<string, ParamMeta>): FlatParam[] {
  return Object.entries(metas).map(([key, m]) => ({
    path: `${prefix}.${key}`,
    default: m.default,
    unit: m.unit,
    range: m.boolean ? null : m.range,
    integer: m.integer ?? false,
    ...(m.boolean ? { boolean: true } : {}),
    description: m.description,
  }));
}

export function buildConfigSchemaPayload() {
  return {
    description:
      "Tunable simulation parameters accepted in config_overrides, as a nested object mirroring these paths " +
      '(e.g. {"TEAMS": {"OPFOR": {"videoOff": 7}}}). All values are numbers except the flagged booleans ' +
      "(TACTICAL.RESERVE_HUNTER). Out-of-range values are rejected with the offending path and allowed range. " +
      'The TACTICAL.* section only affects runs with mode: "tactical".',
    parameters: [
      ...flatten("DRONE", DRONE_PARAMS),
      ...flatten("CUAS", CUAS_PARAMS),
      ...flatten("FIX", FIX_PARAMS),
      ...flatten("TEAMS.BLUFOR", TEAM_PARAMS.BLUFOR),
      ...flatten("TEAMS.OPFOR", TEAM_PARAMS.OPFOR),
      ...flatten("TACTICAL", TACTICAL_PARAMS),
      ...flatten("TACTICAL.SORTIES", TACTICAL_SIDE_PARAMS.SORTIES),
      ...flatten("TACTICAL.PILOTS", TACTICAL_SIDE_PARAMS.PILOTS),
    ],
    not_overridable: [
      { path: "WORLD_M", reason: "Structural: unit emplacements are absolute coordinates tuned to the 4000 m box." },
      { path: "SIM_DT", reason: "Structural: the fixed 0.1 s tick is part of the determinism contract." },
      { path: "SEED", reason: "Pass the seed as a tool argument instead." },
      { path: "TEAMS.*.emconLabel", reason: "Derived: videoOff === 0 reports CONTINUOUS, anything else INTERMITTENT." },
      { path: "TACTICAL.OBJ_NAME", reason: "Cosmetic label in the event log; not a number, not a behavior knob." },
    ],
    determinism_note:
      "Identical (seed, config_overrides) inputs always produce identical results — overrides change the engagement, not the reproducibility.",
  };
}
